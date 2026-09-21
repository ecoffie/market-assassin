/**
 * Morehouse Ascend — the whole production tool, 32 companies, one pass.
 *
 * This runs `capabilityMarketMatch` itself, not the anchor picker underneath it, because
 * the failures this work exists to stop (a confident TAM on an ungrounded anchor, a
 * competitor that only matched a name substring) live in the ORCHESTRATION, not in any
 * one atomic step. SAM/award evidence, keyword coverage and contractor search are mocked
 * with SYNTHETIC fixtures so the matrix is repeatable and costs no credits — see
 * `fixtures/morehouse-ascend/EVIDENCE-CALL-GRAPH.md` for where each mock intercepts.
 *
 * Two verdicts are reported per row and they are deliberately independent:
 *   exact_anchor    — did the anchor land on the capability the cohort labels require
 *   grounding_safe  — did the tool withhold everything it could not defend
 * A row can be safe and still wrong, and that is the distinction the old single-column
 * matrix hid.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { pickLegacyLeadAnchor } from '@/lib/market/capability-anchor';
import { isWellFormedUei } from '@/lib/sam/resolve-uei';
import { mockCoverageForAnchor } from './fixtures/morehouse-ascend/mock-coverage';
import {
  participants,
  caseById,
  keywordsFor,
  FAKE_COMPETITORS,
  matchesExpectedCapability,
  isCapabilityPhrase,
  type CaseSpec,
} from './fixtures/morehouse-ascend/harness';
import type { RecipientSearchRow } from '@/lib/bigquery/recipients';

vi.mock('@/lib/market/embeddings', () => ({
  embedText: vi.fn().mockRejectedValue(new Error('lexical-only e2e')),
  cosineSimilarity: vi.fn(),
}));

vi.mock('@/lib/market/keyword-coverage', () => ({
  keywordCoverage: vi.fn(async (lead: string) => mockCoverageForAnchor(lead)),
}));

vi.mock('@/lib/market/capability-anchor-evidence', async () => {
  const { evidenceFor: forName } = await import('./fixtures/morehouse-ascend/harness');
  return { loadAnchorEvidence: vi.fn(async (clientName: string | undefined) => forName(clientName)) };
});

const searchContractorsCalls: Array<{ naics?: string; keyword?: string }> = [];

vi.mock('@/mcp/tools/search-contractors', () => ({
  searchContractors: vi.fn(async (input: { naics?: string; keyword?: string }) => {
    searchContractorsCalls.push({ naics: input.naics, keyword: input.keyword });
    const rows = input.naics ? FAKE_COMPETITORS : [];
    return {
      queried: { naics: input.naics, sort_by: 'total_obligated' as const },
      contractors: rows,
      _meta: { grounded: rows.length > 0, degraded: false, count: rows.length },
    };
  }),
}));

vi.mock('@/lib/market/vocabulary', () => ({ getVocabulary: vi.fn(async () => [{ term: 'stub-vocab' }]) }));
vi.mock('@/mcp/tools/forecasts', () => ({ agencyForecasts: vi.fn(async () => ({ forecasts: [], _meta: { count: 0 } })) }));
vi.mock('@/mcp/tools/expiring-contracts', () => ({ expiringContracts: vi.fn(async () => ({ contracts: [], _meta: { count: 0 } })) }));
vi.mock('@/lib/usaspending/psc-recipients', () => ({ topRecipientsByPsc: vi.fn(async () => []) }));

/**
 * Outcome vocabulary, per the acceptance definitions:
 *   corrected              — previously wrong, now materially correct AND defensible
 *   preserved              — one of the eight exact cases, still materially correct
 *   deliberately_unverified— safely withheld (no market asserted)
 *   unresolved             — still wrong, generic, or contradicting required behavior
 */
type OutcomeClass = 'corrected' | 'preserved' | 'deliberately_unverified' | 'unresolved';

interface MatrixRow {
  company: string;
  level: CaseSpec['expectation_level'];
  expected_capability: string;
  previous_anchor: string;
  new_anchor: string | null;
  confidence: string;
  grounded: boolean;
  identity: string;
  identity_uei: string | null;
  evidence_kind: 'synthetic';
  evidence_naics: string[];
  lead_naics: string | null;
  naics_status: string;
  tam: number | null;
  competitors: number;
  competitor_derivation: string;
  exact_anchor: 'pass' | 'fail' | 'n/a';
  grounding_safe: 'pass' | 'fail';
  safety_note: string;
  outcome: OutcomeClass;
}

/** Materially correct = expresses the capability the cohort label requires. */
function materiallyCorrect(spec: CaseSpec, anchor: string | null): boolean {
  if (spec.expectation_level === 'exact_expected' && spec.expected_capability) {
    return matchesExpectedCapability(spec.expected_capability, anchor);
  }
  if (!isCapabilityPhrase(spec, anchor)) return false;
  const signals = spec.required_capability_signals ?? [];
  if (!signals.length) return true;
  return signals.some((s) => anchor!.toLowerCase().includes(s.toLowerCase()));
}

/**
 * The withholding contract. A low/unverified row must assert NOTHING: no lead NAICS, no
 * TAM, no competitors — and any tentative code must arrive labelled `candidate_naics`.
 */
function checkGroundingSafety(row: Omit<MatrixRow, 'exact_anchor' | 'grounding_safe' | 'safety_note' | 'outcome'>): string[] {
  const failures: string[] = [];
  const withheld = row.confidence === 'low' || row.confidence === 'unverified';

  if (withheld) {
    if (row.lead_naics !== null) failures.push('lead_naics leaked');
    if (row.tam !== null) failures.push('TAM asserted without evidence');
    if (row.competitors > 0) failures.push('competitors returned');
    if (row.naics_status !== 'unverified' && row.naics_status !== 'none') {
      failures.push(`naics_status=${row.naics_status}`);
    }
  }
  // Confidence may only be elevated by a uniquely resolved entity.
  if ((row.confidence === 'high' || row.confidence === 'medium') && row.identity !== 'unique') {
    failures.push(`confidence ${row.confidence} on identity=${row.identity}`);
  }
  if (row.grounded && row.identity !== 'unique') failures.push('grounded without unique identity');
  return failures;
}

function classifyOutcome(
  spec: CaseSpec,
  row: Pick<MatrixRow, 'new_anchor' | 'grounded' | 'lead_naics'>,
  safe: boolean,
): OutcomeClass {
  if (!safe) return 'unresolved';
  const correct = materiallyCorrect(spec, row.new_anchor);

  // `preserved` is reserved for the eight exact cases, per the acceptance definitions.
  if (spec.expectation_level === 'exact_expected') return correct ? 'preserved' : 'unresolved';

  if (!row.new_anchor) return spec.allow_no_anchor ? 'deliberately_unverified' : 'unresolved';
  if (!correct) return 'unresolved';

  // A better PHRASE that the tool still cannot defend is WITHHELD, not corrected.
  // `corrected` is an ALGORITHM outcome on the regression scenario under synthetic
  // evidence — not a claim that a live firm's SAM identity was verified.
  return row.grounded && row.lead_naics !== null ? 'corrected' : 'deliberately_unverified';
}

let matrix: MatrixRow[] = [];

beforeAll(async () => {
  const { capabilityMarketMatch } = await import('@/mcp/tools/capability-market-match');
  matrix = [];

  for (const p of participants) {
    const spec = caseById.get(p.id)!;
    const previous = pickLegacyLeadAnchor(await keywordsFor(p));

    searchContractorsCalls.length = 0;
    const result = await capabilityMarketMatch({ description: p.description, client_name: p.company_name });

    const base = {
      company: p.company_name,
      level: spec.expectation_level,
      expected_capability:
        spec.expected_capability ?? ((spec.required_capability_signals ?? []).join('/') || '(behavioral)'),
      previous_anchor: previous,
      new_anchor: result._meta.selected_anchor ?? null,
      confidence: result._meta.anchor_confidence ?? 'unverified',
      grounded: result._meta.grounded,
      identity: result._meta.evidence?.identity ?? 'none',
      identity_uei: result._meta.evidence?.identity_uei ?? null,
      evidence_kind: 'synthetic' as const,
      evidence_naics: [...(result._meta.evidence?.sam_naics ?? []), ...(result._meta.evidence?.award_naics ?? [])],
      lead_naics: result._meta.lead_naics,
      naics_status: result.market?.naics_status ?? 'none',
      tam: result.market?.total_market ?? null,
      competitors: (result.competitors as RecipientSearchRow[]).length,
      competitor_derivation: result._meta.competitor_derivation ?? 'none_no_naics',
    };

    const safetyFailures = checkGroundingSafety(base);
    const safe = safetyFailures.length === 0;

    matrix.push({
      ...base,
      exact_anchor:
        spec.expectation_level === 'exact_expected' ? (materiallyCorrect(spec, base.new_anchor) ? 'pass' : 'fail') : 'n/a',
      grounding_safe: safe ? 'pass' : 'fail',
      safety_note: safetyFailures.join('; ') || '-',
      outcome: classifyOutcome(spec, base, safe),
    });
  }
}, 120_000);

describe('Morehouse Ascend — full-tool e2e matrix', () => {
  it('runs all 32 companies through capabilityMarketMatch', () => {
    expect(matrix).toHaveLength(32);
  });

  it('prints the 32-row matrix with exact-anchor and grounding verdicts separated', () => {
    const cols = [
      'company', 'level', 'expected_capability', 'previous', 'new_anchor', 'confidence',
      'identity', 'identity_uei', 'evidence_kind', 'evidence_naics', 'grounded', 'lead_naics',
      'naics_status', 'tam', 'competitors', 'competitor_derivation', 'exact_anchor',
      'grounding_safe', 'safety_note', 'outcome',
    ].join('|');
    const lines = matrix.map((r) =>
      [
        r.company, r.level, r.expected_capability, r.previous_anchor, r.new_anchor ?? '(none)',
        r.confidence, r.identity, r.identity_uei ?? '-', r.evidence_kind,
        r.evidence_naics.join('+') || '-', r.grounded,
        r.lead_naics ?? 'null', r.naics_status, r.tam ?? 'null', r.competitors,
        r.competitor_derivation, r.exact_anchor, r.grounding_safe, r.safety_note, r.outcome,
      ].join('|'),
    );
    console.log('\n=== MOREHOUSE ASCEND 32-ROW MATRIX (synthetic identity/SAM/award evidence) ===\n' + [cols, ...lines].join('\n'));
    expect(lines).toHaveLength(32);
  });

  it('summary counts, exact-anchor pass/fail separate from grounding safety', () => {
    const outcomes = { corrected: 0, preserved: 0, deliberately_unverified: 0, unresolved: 0 };
    for (const r of matrix) outcomes[r.outcome]++;
    const exact = matrix.filter((r) => r.exact_anchor !== 'n/a');
    console.log('\n=== OUTCOME COUNTS ===', outcomes);
    console.log('=== EXACT ANCHOR ===', {
      pass: exact.filter((r) => r.exact_anchor === 'pass').length,
      fail: exact.filter((r) => r.exact_anchor === 'fail').length,
    });
    console.log('=== GROUNDING SAFETY ===', {
      pass: matrix.filter((r) => r.grounding_safe === 'pass').length,
      fail: matrix.filter((r) => r.grounding_safe === 'fail').length,
    });
    expect(Object.values(outcomes).reduce((a, b) => a + b, 0)).toBe(32);
  });

  it('every one of the eight exact cases lands on its required capability', () => {
    const fails = matrix.filter((r) => r.exact_anchor === 'fail');
    expect(matrix.filter((r) => r.exact_anchor !== 'n/a')).toHaveLength(8);
    expect(fails.map((f) => `${f.company}: ${f.new_anchor}`)).toEqual([]);
  });

  it('no row asserts a market it cannot defend', () => {
    const unsafe = matrix.filter((r) => r.grounding_safe === 'fail');
    expect(unsafe.map((r) => `${r.company}: ${r.safety_note}`)).toEqual([]);
  });

  it('nothing is counted corrected without being defensibly resolved', () => {
    for (const r of matrix.filter((x) => x.outcome === 'corrected')) {
      expect(r.grounded, `${r.company} corrected but ungrounded`).toBe(true);
      expect(r.lead_naics, `${r.company} corrected without a lead NAICS`).not.toBeNull();
      expect(r.identity, `${r.company} corrected without unique identity`).toBe('unique');
      expect(r.evidence_kind, `${r.company} corrected without synthetic label`).toBe('synthetic');
      expect(isWellFormedUei(r.identity_uei), `${r.company} corrected on malformed UEI ${r.identity_uei}`).toBe(true);
    }
  });

  for (const p of participants) {
    const spec = caseById.get(p.id)!;
    it(`${p.company_name} — e2e contract`, () => {
      const row = matrix.find((r) => r.company === p.company_name)!;
      expect(row).toBeDefined();

      for (const bad of spec.forbidden_anchors ?? []) {
        expect(row.new_anchor?.toLowerCase()).not.toBe(bad.toLowerCase());
      }
      if (spec.expectation_level === 'exact_expected') expect(row.exact_anchor).toBe('pass');
      expect(row.grounding_safe).toBe('pass');
    });
  }
});

describe('mission language is never a capability', () => {
  it('BMA does not anchor on a mission adjective, and claims no market from one', () => {
    const row = matrix.find((r) => /Business Management Associates/i.test(r.company))!;
    expect(row.new_anchor).not.toMatch(/mission|people[\s-]?always|purpose[\s-]?driven/i);
    expect(row.evidence_kind).toBe('synthetic');
    if (row.outcome === 'corrected') {
      expect(row.identity_uei).toBe('SYNTH0BMA001');
      expect(isWellFormedUei(row.identity_uei)).toBe(true);
    }
    if (!row.grounded) {
      expect(row.tam).toBeNull();
      expect(row.lead_naics).toBeNull();
      expect(row.competitors).toBe(0);
    }
  });

  it('no company in the cohort anchors on mission language', () => {
    const offenders = matrix.filter((r) => /mission[\s-]?(first|driven|focused)|people[\s-]?always/i.test(r.new_anchor ?? ''));
    expect(offenders.map((o) => o.company)).toEqual([]);
  });
});

describe('withholding contract — low/unverified rows assert nothing', () => {
  it('every withheld row has null lead_naics, null TAM and zero competitors', () => {
    const withheld = matrix.filter((r) => r.confidence === 'low' || r.confidence === 'unverified');
    expect(withheld.length).toBeGreaterThan(0);
    for (const r of withheld) {
      expect(r.lead_naics, r.company).toBeNull();
      expect(r.tam, r.company).toBeNull();
      expect(r.competitors, r.company).toBe(0);
    }
  });

  it('a tentative code is returned as candidate_naics, never as a selected market', async () => {
    const { capabilityMarketMatch } = await import('@/mcp/tools/capability-market-match');
    const p = participants.find((x) => x.id === 'business-management-associates-inc')!;
    const r = await capabilityMarketMatch({ description: p.description, client_name: p.company_name });
    if (r._meta.anchor_confidence === 'low' || r._meta.anchor_confidence === 'unverified') {
      expect(r.market?.naics_status).toBe('unverified');
      expect(r.market?.top_naics ?? []).toHaveLength(0);
      expect(r._meta.lead_naics).toBeNull();
    }
  });

  /**
   * 541611 is the coverage fallback, so it is the code most likely to be presented as a
   * market nobody chose. It is legitimate ONLY when the company's own evidence record
   * carries it. BMA's fixture NAICS 541611/541612 are SYNTHETIC (SYNTH0BMA001) — not a
   * verified SAM/USASpending read of the live firm.
   */
  it('541611 only appears as a selected market when the evidence carries it', () => {
    const leaked = matrix.filter((r) => r.lead_naics === '541611' && !r.evidence_naics.includes('541611'));
    expect(leaked.map((l) => `${l.company} (evidence: ${l.evidence_naics.join('+') || 'none'})`)).toEqual([]);
  });

  it('no selected lead NAICS is unsupported by the company evidence', () => {
    const unsupported = matrix.filter(
      (r) => r.lead_naics !== null && r.evidence_naics.length > 0 && !r.evidence_naics.includes(r.lead_naics),
    );
    expect(unsupported.map((u) => `${u.company}: ${u.lead_naics} not in ${u.evidence_naics.join('+')}`)).toEqual([]);
  });
});

describe('competitor sourcing — production path proof', () => {
  it('searchContractors is never called with a keyword', async () => {
    searchContractorsCalls.length = 0;
    const { capabilityMarketMatch } = await import('@/mcp/tools/capability-market-match');
    for (const p of participants.slice(0, 8)) {
      await capabilityMarketMatch({ description: p.description, client_name: p.company_name });
    }
    expect(searchContractorsCalls.every((c) => !c.keyword)).toBe(true);
  });

  for (const [label, id, forbidden] of [
    ['Anadria', 'anadria-consulting-llc', /outcomes/i],
    ['TPJ', 'tpj-solutions-inc', /customized/i],
  ] as const) {
    it(`${label}: no name-substring competitor survives the filter`, async () => {
      const { capabilityMarketMatch } = await import('@/mcp/tools/capability-market-match');
      const p = participants.find((x) => x.id === id)!;
      const r = await capabilityMarketMatch({ description: p.description, client_name: p.company_name });
      const names = (r.competitors as RecipientSearchRow[]).map((c) => c.recipient_name);
      expect(names.filter((n) => forbidden.test(n))).toEqual([]);
    });
  }
});

describe('TAM sanity — production path', () => {
  it('an ungrounded anchor never carries a confident TAM', () => {
    for (const r of matrix) {
      if (!r.grounded) expect(r.tam, r.company).toBeNull();
    }
  });

  it('CapitolHill does not anchor on the conjunction, and claims no $650B market', async () => {
    const { capabilityMarketMatch } = await import('@/mcp/tools/capability-market-match');
    const p = participants.find((x) => x.id === 'capitolhill-consortium-for-counseling-consultation-llc')!;
    const r = await capabilityMarketMatch({ description: p.description, client_name: p.company_name });
    expect(r._meta.selected_anchor?.toLowerCase()).not.toBe('and');
    if (r._meta.tam_verified === false) expect(r.market?.total_market ?? null).toBeNull();
  });
});
