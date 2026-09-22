/**
 * POTETO — Credit Integrity (2026-09-22).
 *
 *   INPUT → VALIDATE → METER → EXECUTE → OUTCOME → CHARGE
 *
 * Gold masters (production, eric@govcongiants.com, 2026-09-22):
 *   1. build_pursuit_dossier called with `solicitation=` (not a schema key). The SDK
 *      stripped it, the tool returned an empty miss in 1 ms, and the ledger recorded
 *      -100 (17:04:56.985, balance 42,403 → 42,303), call log status `success`.
 *   2. generate_market_report `publication_state="measurement_failure"` with ≥1
 *      optional section grounded → `_meta.grounded=true` → DEFECT-7 did not apply →
 *      charged for a report Mindy refused to publish.
 *
 * The REAL tools produce each terminal state here (upstreams injected), and the REAL
 * runMeteredTool decides the charge against a ledger that mirrors mcp_debit_credits
 * (debit only when balance ≥ amount; one row per debit). The same invariants run
 * against the real Postgres ledger in credit-integrity.live.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory ledger with the RPC's semantics ────────────────────────────────
const ledger = vi.hoisted(() => ({
  balance: 0,
  rows: [] as { delta: number; tool: string }[],
  calls: [] as { toolName: string; status: string; creditsCharged: number }[],
}));
vi.mock('./credits', () => ({
  getBalance: vi.fn(async () => ledger.balance),
  debitCredits: vi.fn(async (_e: string, amount: number, meta: { toolName: string }) => {
    if (ledger.balance < amount) return { ok: false, newBalance: ledger.balance };
    ledger.balance -= amount;
    ledger.rows.push({ delta: -amount, tool: meta.toolName });
    return { ok: true, newBalance: ledger.balance };
  }),
  logCall: vi.fn(async (e: { toolName: string; status: string; creditsCharged: number }) => {
    ledger.calls.push({ toolName: e.toolName, status: e.status, creditsCharged: e.creditsCharged });
  }),
}));
vi.mock('./payer', () => ({
  resolvePayer: vi.fn(async () => ({ kind: 'personal' })),
  isChargeable: () => true,
  getPoolBalance: vi.fn(),
  debitResolvedPayer: vi.fn(async (email: string, amount: number, meta: unknown) => {
    const { debitCredits } = await import('./credits');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...(await (debitCredits as any)(email, amount, meta)), payer: 'personal' };
  }),
}));
vi.mock('./paywall', () => ({
  recordPaywallAttempt: vi.fn(async () => null),
  paywallMessage: vi.fn(() => 'top up'),
  RESUME_BASE: 'https://getmindy.ai/mcp/continue',
}));
vi.mock('@/lib/search-history', () => ({ recordSearchAxes: vi.fn() }));

// The registry dispatches to the REAL tool functions below; only price/lookup are real too.
const run = vi.hoisted(() => ({ next: null as null | (() => Promise<Record<string, unknown>>) }));
vi.mock('./tool-registry', async (orig) => {
  const actual = await orig<typeof import('./tool-registry')>();
  return {
    ...actual,
    runMcpTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'build_pursuit_dossier') {
        const { buildPursuitDossier } = await import('@/mcp/tools/pursuit-dossier');
        return { result: await buildPursuitDossier(args) };
      }
      if (name === 'generate_market_report') {
        const { generateMarketReport } = await import('@/mcp/tools/market-report');
        return { result: await generateMarketReport({ ...args, userEmail: 'u@x.com' }) };
      }
      return { result: await run.next!() };
    }),
  };
});

// ── Upstream injection for the two real tools ────────────────────────────────
const up = vi.hoisted(() => ({
  coverage: 'ok' as 'ok' | 'thin' | 'fail',
  anchor: 'found' as 'found' | 'missing' | 'throws',
}));

vi.mock('@/lib/market/keyword-coverage', () => ({
  keywordCoverage: vi.fn(async (k: string) => {
    if (up.coverage === 'fail') throw new Error('deadline_exceeded'); // required measurement did not complete
    if (up.coverage === 'thin') return null; // completed, established no market
    return {
      keyword: k, totalMarket: 242_700_000, naicsCount: 42,
      allNaics: [{ code: '336411', name: 'AIRCRAFT MANUFACTURING', amount: 68_900_000, pct: 0.284 }],
      coverageCodes: ['336411'], coveragePct: 0.9, topCodePct: 0.284, leadCodePct: 0.284,
      topPsc: { code: '1550', name: 'UNMANNED AIRCRAFT' }, topPscList: [],
      windowLabel: 'FY2025', identityResolvedVia: [],
    };
  }),
  codeMarketSize: vi.fn(async () => null),
  marketKeywords: vi.fn((k: string) => [k]),
}));
vi.mock('@/lib/market/undercount-signal', () => ({ detectUndercount: vi.fn(async () => null) }));
vi.mock('@/lib/market/spend-query', () => ({
  resolveMarketScope: vi.fn(async () => ({
    basis: 'keyword', marketFilter: { keywords: ['drones'], mode: 'keyword', rankingLabel: '' },
    naicsCodes: [], coverage: null, rankedByDominantNaics: false, label: 'keyword "drones"',
  })),
  filtersForScope: vi.fn(() => ({ keywords: ['drones'] })),
  buildSpendingFilters: vi.fn(() => ({})),
  fetchSpendingCategory: vi.fn(async () => [
    { name: 'DEPARTMENT OF DEFENSE', amount: 150_000_000 },
    { name: 'DEPARTMENT OF THE INTERIOR', amount: 40_000_000 },
  ]),
}));
vi.mock('@/mcp/tools/expiring-contracts', () => ({
  // An OPTIONAL section that grounds even when the required measurement fails —
  // this is what made `_meta.grounded=true` and slipped past DEFECT-7.
  expiringContracts: vi.fn(async () => ({
    contracts: [{
      contract_id: 'A', piid: 'FA500425F0093', incumbent_name: 'X', awarding_agency: 'DoD',
      awarding_sub_agency: 'USAF', naics_code: '336411', description: 'UAS', potential_total_value: 5e5,
      period_of_performance_current_end: '2027-09-23', estimated_recompete_date: '2027-03-23',
      lead_time_months: 12, recompete_likelihood: 'medium',
    }],
    _meta: { grounded: true, degraded: false, count: 1, total: 1 },
  })),
}));
vi.mock('@/mcp/tools/forecasts', () => ({
  agencyForecasts: vi.fn(async () => ({ queried: {}, forecasts: [], _meta: { grounded: false, degraded: false, count: 0, total: 0 } })),
}));
vi.mock('@/lib/gov-contacts/contact-roster', () => ({ queryFederalContacts: vi.fn(async () => ({ contacts: [], total: 0 })) }));
vi.mock('@/mcp/tools/agency-spending-detail', () => ({ getAgencySpendingDetailTool: vi.fn(async () => null) }));
vi.mock('@/mcp/tools/sba-goaling', () => ({ getSbaGoalingShare: vi.fn(async () => null) }));
const store = vi.hoisted(() => ({ saved: 0 }));
vi.mock('@/lib/market/report-store', () => ({
  saveMarketReport: vi.fn(async () => { store.saved += 1; return `rep${store.saved}`; }),
}));

// Pursuit dossier upstreams.
vi.mock('@/mcp/tools/solicitation-incumbent', () => ({
  getSolicitationIncumbent: vi.fn(async () => {
    if (up.anchor === 'throws') throw new Error('upstream 503');
    if (up.anchor === 'missing') return { notice: null, incumbent: null, _meta: { grounded_incumbent: false } };
    return {
      notice: { notice_id: 'n1', naics: '561720', agency: 'VETERANS AFFAIRS, DEPARTMENT OF' },
      incumbent: null,
      _meta: { grounded_incumbent: false },
    };
  }),
}));
vi.mock('@/mcp/tools/solicitation-documents', () => ({ solicitationDocuments: vi.fn(async () => ({ description: 'Janitorial', documents: [] })) }));
vi.mock('@/mcp/tools/market-depth', () => ({ assessMarketDepth: vi.fn(async () => ({ businesses: [], _meta: {} })) }));
vi.mock('@/mcp/tools/pricing-intel', () => ({ getPricingIntel: vi.fn(async () => null) }));
vi.mock('@/mcp/tools/federal-contacts', () => ({ searchFederalContacts: vi.fn(async () => ({ contacts: [] })) }));
vi.mock('@/mcp/tools/incumbent-financials', () => ({ getIncumbentFinancials: vi.fn(async () => null) }));

import { runMeteredTool } from './metered';
import { classifyBillingOutcome, preflightPaidInput, REQUIRED_ONE_OF } from './credit-integrity';
import { creditsFor, runMcpTool } from './tool-registry';

const ctx = { userEmail: 'u@x.com', apiKeyId: 'k1' };
const START = 1_000;
const DOSSIER = 'build_pursuit_dossier';
const REPORT = 'generate_market_report';

beforeEach(() => {
  ledger.balance = START;
  ledger.rows = [];
  ledger.calls = [];
  store.saved = 0;
  up.coverage = 'ok';
  up.anchor = 'found';
  vi.mocked(runMcpTool).mockClear();
});

const pub = (r: Awaited<ReturnType<typeof runMeteredTool>>) =>
  r.ok ? (r.result._meta as { publication_state?: string }).publication_state : undefined;

describe('prices are unchanged (this Poteto does not touch pricing)', () => {
  it('dossier and market report both cost 100', () => {
    expect(creditsFor(DOSSIER)).toBe(100);
    expect(creditsFor(REPORT)).toBe(100);
  });
});

describe('INVALID INPUT — build_pursuit_dossier without a recognized identity', () => {
  it('1–4: the gold-master `solicitation=` call never runs, costs 0, and names the missing input', async () => {
    // The SDK strips unknown keys, so this is what the handler actually receives —
    // but the raw form must be refused too (the preflight never reads `solicitation`).
    for (const args of [{}, { solicitation: '36C24226Q0857' }, { solicitation_number: '   ' }]) {
      const r = await runMeteredTool(DOSSIER, args, ctx);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.code).toBe('invalid_input');
      expect(!r.ok && r.error.message).toMatch(/solicitation_number, notice_id/);
      expect(!r.ok && r.error.message).toMatch(/nothing was charged/i);
      expect(r.creditsCharged).toBe(0);
    }
    expect(runMcpTool).not.toHaveBeenCalled(); // no empty dossier is produced at all
    expect(ledger.balance).toBe(START);
    expect(ledger.rows).toHaveLength(0);
    expect(ledger.calls.every((c) => c.status === 'rejected_invalid_input' && c.creditsCharged === 0)).toBe(true);
  });

  it('defense in depth: the tool itself marks a no-identity miss non-billable', async () => {
    const { buildPursuitDossier } = await import('@/mcp/tools/pursuit-dossier');
    const r = await buildPursuitDossier({});
    expect(r._meta.billing_outcome).toBe('nonbillable_invalid_input');
    expect(classifyBillingOutcome(r)).toBe('nonbillable_invalid_input');
  });

  it('the rule is the declared identity set, not a special case for the word "solicitation"', () => {
    expect(REQUIRED_ONE_OF[DOSSIER]).toEqual(['solicitation_number', 'notice_id']);
    expect(preflightPaidInput(DOSSIER, { notice_id: 'abc' })).toBeNull();
    expect(preflightPaidInput(REPORT, {})).toBeNull(); // undeclared tools are untouched
  });
});

describe('VALID PURSUIT DOSSIER', () => {
  it('5–7: solicitation_number=36C24226Q0857 runs and charges the existing 100', async () => {
    const r = await runMeteredTool(DOSSIER, { solicitation_number: '36C24226Q0857' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.creditsCharged).toBe(100);
    expect(r.ok && (r.result._meta as { grounded: boolean }).grounded).toBe(true);
    expect(r.ok && (r.result._meta as { billing_outcome?: string }).billing_outcome).toBeUndefined();
    expect(ledger.balance).toBe(START - 100);
  });

  it('a valid lookup that finds no stored notice is a paid research answer', async () => {
    up.anchor = 'missing';
    const r = await runMeteredTool(DOSSIER, { solicitation_number: 'ZZZ000' }, ctx);
    expect(r.creditsCharged).toBe(100);
    expect(r.ok && (r.result._meta as { grounded: boolean }).grounded).toBe(false);
  });

  it('a lookup whose required anchor THREW is a Mindy failure, not "no such notice" → 0', async () => {
    up.anchor = 'throws';
    const r = await runMeteredTool(DOSSIER, { solicitation_number: '36C24226Q0857' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.creditsCharged).toBe(0);
    const meta = r.ok ? (r.result._meta as { degraded: boolean; billing_outcome?: string }) : null;
    expect(meta?.degraded).toBe(true);
    expect(meta?.billing_outcome).toBe('nonbillable_system_failure');
    expect(ledger.balance).toBe(START);
  });
});

describe('MARKET REPORT — the three publication states', () => {
  it('8–9: publish is billable and mints the deliverable', async () => {
    const r = await runMeteredTool(REPORT, { keyword: 'drones' }, ctx);
    expect(pub(r)).toBe('publish');
    expect(r.creditsCharged).toBe(100);
    expect(r.ok && (r.result.deliverable as { url: string | null }).url).toMatch(/\/reports\/rep1$/);
  });

  it('10–11: insufficient_evidence is completed research and stays billable', async () => {
    up.coverage = 'thin';
    const r = await runMeteredTool(REPORT, { keyword: 'obscure widget' }, ctx);
    expect(pub(r)).toBe('insufficient_evidence');
    expect(r.creditsCharged).toBe(100);
    expect(store.saved).toBe(0);
  });

  it('12–13: injected measurement_failure costs 0 even though an optional section grounded', async () => {
    up.coverage = 'fail';
    const r = await runMeteredTool(REPORT, { keyword: 'drones' }, ctx);
    expect(pub(r)).toBe('measurement_failure');
    const meta = r.ok ? (r.result._meta as { grounded: boolean; billing_outcome?: string }) : null;
    // The exact shape production charged for: grounded on optional evidence.
    expect(meta?.grounded).toBe(true);
    expect(meta?.billing_outcome).toBe('nonbillable_system_failure');
    expect(r.creditsCharged).toBe(0);
    expect(r.ok && (r.result.deliverable as { url: string | null }).url).toBeNull();
    expect(store.saved).toBe(0); // no share URL minted
    // P2's explanation survives: UNKNOWN, not zero.
    expect(r.ok && (r.result._meta as { deliverable_withheld_reason: string }).deliverable_withheld_reason).toMatch(/UNKNOWN/);
  });

  it('14: retry/replay of a failure never charges and never credits', async () => {
    up.coverage = 'fail';
    for (let i = 0; i < 3; i++) await runMeteredTool(REPORT, { keyword: 'drones' }, ctx);
    expect(ledger.balance).toBe(START);
    expect(ledger.rows).toHaveLength(0); // no debit, and no compensating row exists to repeat
  });
});

describe('LEDGER — final balance reconciles with terminal outcomes', () => {
  it('15–16: a mixed session charges exactly the billable outcomes', async () => {
    const plan: [string, Record<string, unknown>, () => void, number][] = [
      [DOSSIER, { solicitation: '36C24226Q0857' }, () => {}, 0],
      [DOSSIER, { solicitation_number: '36C24226Q0857' }, () => { up.anchor = 'found'; }, 100],
      [REPORT, { keyword: 'drones' }, () => { up.coverage = 'ok'; }, 100],
      [REPORT, { keyword: 'obscure widget' }, () => { up.coverage = 'thin'; }, 100],
      [REPORT, { keyword: 'drones' }, () => { up.coverage = 'fail'; }, 0],
    ];
    let expected = 0;
    for (const [tool, args, setup, cost] of plan) {
      setup();
      const r = await runMeteredTool(tool, args, ctx);
      expect(r.creditsCharged).toBe(cost);
      expected += cost;
    }
    expect(START - ledger.balance).toBe(expected); // 300
    expect(ledger.rows.reduce((s, x) => s + x.delta, 0)).toBe(-expected);
    expect(ledger.rows.every((x) => x.delta < 0)).toBe(true); // metering never credits
    expect(ledger.calls.map((c) => c.status)).toEqual([
      'rejected_invalid_input', 'success', 'success', 'success', 'uncharged',
    ]);
  });
});

describe('classifier contract', () => {
  it('zero rows is not a failure; degraded+ungrounded (DEFECT-7) still is', () => {
    expect(classifyBillingOutcome({ _meta: { grounded: false, degraded: false } })).toBe('billable_no_result');
    expect(classifyBillingOutcome({ _meta: { grounded: true, degraded: true } })).toBe('billable_success');
    expect(classifyBillingOutcome({ _meta: { grounded: false, degraded: true } })).toBe('nonbillable_system_failure');
    expect(classifyBillingOutcome({})).toBe('billable_success');
    // An unknown explicit value is ignored rather than trusted.
    expect(classifyBillingOutcome({ _meta: { grounded: true, billing_outcome: 'free please' } })).toBe('billable_success');
  });
});
