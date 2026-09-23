/**
 * IMI FIND — company-anchored FIND (A1) + DIRECT_MATCH semantics (A2). HERMETIC.
 *
 * Every row comes from frozen fixtures in __fixtures__/imi-find/ (captured read-only by
 * scripts/capture-imi-find-fixtures.ts; each file carries its table, query and capture time).
 * No network, no Supabase, no SAM — closing dates cannot make this nondeterministic.
 *
 * Acceptance client: Industrial Mechanical Inc. (IMI), UEI M66AH329AJM6, Watkinsville GA.
 */
import { describe, it, expect } from 'vitest';
import entityFx from './__fixtures__/imi-find/imi-entity.json';
import noticesFx from './__fixtures__/imi-find/imi-notices.json';
import tyonekFx from './__fixtures__/imi-find/tyonek-recompete.json';
import buysideFx from './__fixtures__/imi-find/ga-buyside-recompete.json';
import { transformEntity } from '@/lib/sam/entity-api';
import { buildDiscoveryPlan, matchesText, MCP_POLICY, type DiscoveryPlan } from '@/lib/discovery';
import { stateOrExpr } from '@/lib/opportunities/map-filters';
import { interpretMarket, classifyRecord, interpretCapability } from './market-interpretation';
import {
  anchorFromSamEntity,
  resolveCompanyAnchor,
  companyRecallBasis,
  companyCodeRecall,
  type CompanyAnchor,
} from './company-anchor';
import { evaluateEligibility, evaluateRecompeteEligibility } from './company-eligibility';
import { classifyComingBackEvidence } from './match-evidence';
import {
  findOpportunities,
  labelOpenRow,
  mcpDiscoveryInput,
  mcpDiscoveryPolicy,
  HOST_RULES_FIND_FIRST_VALUE,
  HOST_RULES_COMPANY_ANCHORED,
  type FindOpportunitiesInput,
} from './find-opportunities';
import type { SamEntityResult } from '@/mcp/tools/sam-entity';

type Row = Record<string, unknown>;
const IMI_UEI = 'M66AH329AJM6';
/** The IMI run's FIND eligibility: ALL(steel, fabrication, industrial) OR machining OR piping OR rigging. */
const Q_IMI = 'industrial steel fabrication, machining, piping, rigging';

const entity = transformEntity(entityFx.data as Row);
const IMI: CompanyAnchor = anchorFromSamEntity(entity, { source: 'sam_entity_api' });

/** One version per solicitation: the ACTIVE notice, else the latest posted. */
function currentNotice(sol: string): Row {
  const rows = (noticesFx.data as Row[]).filter((r) => r.solicitation_number === sol);
  const active = rows.filter((r) => r.active === true);
  const pool = active.length ? active : rows;
  return [...pool].sort((a, b) => String(b.posted_date).localeCompare(String(a.posted_date)))[0];
}
const SHAW = currentNotice('FA480326B0006');
const OKUMA = currentNotice('W911KF-26-S-0023');
const SHOTBLAST = currentNotice('W911KF-26-S-0024');
const KC135 = currentNotice('FA8517-27-R-0056');
const KNOWN_FIT = [OKUMA, SHOTBLAST, KC135, SHAW];

/**
 * The IMI run reported "7 Tyonek orders under FA8571-23-D-0004". The frozen table holds 8 Tyonek rows:
 * 6 task orders under that vehicle + FA857925P0024 (PO, PSC 6625) + FA830725CB007 (NAICS 334290).
 * None of the 8 has machining/fabrication on the buy side; all 8 are asserted.
 */
const TYONEK_ALL = tyonekFx.data as Row[];
const TYONEK_VEHICLE_ORDERS = TYONEK_ALL.filter((r) => String(r.contract_id).includes('FA857123D0004'));

function plan(query: string, opts: { state?: string | null; company?: CompanyAnchor | null } = {}): DiscoveryPlan {
  const input: FindOpportunitiesInput = { query, location: opts.state ?? null };
  return buildDiscoveryPlan(mcpDiscoveryInput(input, opts.company ?? null), mcpDiscoveryPolicy(input));
}

/**
 * JS mirror of the plan's Open admission over a frozen notice (the SQL is applyOpenPlan):
 * active · state = pop OR office (map-filters stateOrExpr) · text ∪ taxonomy ∪ company codes.
 * Fixture limit: sow_text is not captured, so a sow-only admission would be missed here.
 */
function admitsOpen(p: DiscoveryPlan, row: Row, company: CompanyAnchor | null): boolean {
  if (row.active !== true) return false;
  if (p.states.length) {
    const office = (row.office_address as { state?: string } | null)?.state;
    if (!p.states.includes(String(row.pop_state || '')) && !p.states.includes(String(office || ''))) return false;
  }
  const text = matchesText(p.matcher, [row.title as string, row.description as string, row.department as string, row.solicitation_number as string]);
  const tax = (p.expansion.direct.naics.includes(String(row.naics_code)) || p.expansion.direct.psc.includes(String(row.psc_code)));
  const comp = p.company ? !!companyRecallBasis(row, company) : false;
  return text || tax || comp;
}

// ── The company anchor is a projection of lookup_sam_entity's record ─────────────────────────
describe('CompanyAnchor — projected from the canonical SAM entity record', () => {
  it('carries registered NAICS, PSC, per-NAICS size, certs and location', () => {
    expect(IMI.uei).toBe(IMI_UEI);
    expect(IMI.legal_name).toBe('INDUSTRIAL MECHANICAL INC');
    expect(IMI.naics).toHaveLength(20);
    expect(IMI.psc).toEqual(expect.arrayContaining(['J034', 'J036']));
    expect(IMI.size_by_naics['236220']).toBe('N');
    expect(IMI.size_by_naics['332312']).toBe('Y');
    expect(IMI.size_by_naics['238990']).toBe('E');
    expect(IMI.size_source).toBe('sam_entity_api');
    expect(IMI.location).toMatchObject({ city: 'WATKINSVILLE', state: 'GA' });
    expect(IMI.certifications.sba_8a).toBe(false);
    expect(IMI.certifications.self_identified).toContain('VOSB');
  });

  it('never infers company-wide "small": the map is per NAICS, verbatim', () => {
    expect(Object.values(IMI.size_by_naics).filter((v) => v === 'Y')).toHaveLength(9);
    expect(Object.values(IMI.size_by_naics).filter((v) => v === 'N')).toHaveLength(10);
    expect((IMI as unknown as Record<string, unknown>).is_small).toBeUndefined();
  });

  it('resolves through lookup_sam_entity (injected) and never calls a failure "unregistered"', async () => {
    const found = { entity, matches: [], queried: { uei: IMI_UEI }, _meta: { grounded: true, degraded: false, match_count: 1, mode: 'uei', source: 'sam_live', lookup_status: 'found' } } as unknown as SamEntityResult;
    const ok = await resolveCompanyAnchor(IMI_UEI.toLowerCase(), async ({ uei }) => { expect(uei).toBe(IMI_UEI); return found; });
    expect(ok.status).toBe('resolved');
    expect(ok.anchor?.psc).toContain('J034');

    const failed = await resolveCompanyAnchor(IMI_UEI, async () => { throw new Error('all SAM keys 429'); });
    expect(failed.status).toBe('lookup_failed');
    expect(failed.note).toMatch(/not evidence the company is unregistered/);

    const miss = await resolveCompanyAnchor(IMI_UEI, async () => ({ ...found, entity: null, _meta: { ...found._meta, lookup_status: 'not_found', grounded: false } }) as SamEntityResult);
    expect(miss.status).toBe('not_found');

    expect((await resolveCompanyAnchor('M66AH', async () => found)).status).toBe('invalid_uei');
  });

  it('a local-mirror record has no per-NAICS size → size_source unavailable (unknown, not "not small")', () => {
    const mirror = anchorFromSamEntity({ ...entity, certifications: { sbaBusinessTypes: [] }, pscList: [] }, { source: 'local_registry', as_of: '2026-08-25' });
    expect(mirror.size_source).toBe('unavailable');
    expect(mirror.certifications.sba_list_authoritative).toBe(false);
    expect(evaluateEligibility(SHAW, mirror).status).toBe('UNKNOWN');
  });
});

// ── (1) SIZE SCREEN ───────────────────────────────────────────────────────────────────────────
describe('(1) SIZE SCREEN — eligibility is separate from relevance', () => {
  it('Shaw FY27 MACC FA480326B0006 → NOT_ELIGIBLE: small-business set-aside under 236220, IMI not small there', () => {
    expect(SHAW.naics_code).toBe('236220');
    expect(SHAW.set_aside_code).toBe('SBA');
    const v = evaluateEligibility(SHAW, IMI);
    expect(v.status).toBe('NOT_ELIGIBLE');
    expect(v.reason).toMatch(/small-business set-aside under NAICS 236220/);
    expect(v.reason).toMatch(/does not represent itself as small under 236220/);
    expect(v.basis).toMatchObject({ naics: '236220', company_size_under_naics: 'N', set_aside_kind: 'sb', record: 'notice' });
  });

  it('size is judged under the NOTICE NAICS — the same set-aside under a NAICS where IMI is small is ELIGIBLE', () => {
    expect(evaluateEligibility({ ...SHAW, naics_code: '332312' }, IMI).status).toBe('ELIGIBLE');
  });

  it('a notice that SAYS "No Set aside used" is ELIGIBLE on size grounds (Anniston RFIs)', () => {
    expect(OKUMA.set_aside_code).toBe('NONE');
    expect(evaluateEligibility(OKUMA, IMI).status).toBe('ELIGIBLE');
    expect(evaluateEligibility(SHOTBLAST, IMI).status).toBe('ELIGIBLE');
  });

  it('absent ≠ unrestricted: FA8517-27-R-0056 states no set-aside at all → UNKNOWN', () => {
    expect(KC135.set_aside_code).toBeNull();
    const v = evaluateEligibility(KC135, IMI);
    expect(v.status).toBe('UNKNOWN');
    expect(v.reason).toMatch(/not the same as unrestricted/);
  });

  it('SAM "E" (exception-dependent) and an unrepresented NAICS stay UNKNOWN', () => {
    expect(evaluateEligibility({ set_aside_code: 'SBA', naics_code: '238990' }, IMI).status).toBe('UNKNOWN');
    expect(evaluateEligibility({ set_aside_code: 'SBA', naics_code: '541512' }, IMI).status).toBe('UNKNOWN');
    expect(evaluateEligibility({ set_aside_code: 'SBA', naics_code: null }, IMI).status).toBe('UNKNOWN');
  });

  it('programme set-asides: 8(a) negative only from an authoritative SBA list; SDVOSB/VOSB self-id is never enough', () => {
    expect(evaluateEligibility({ set_aside_code: '8A', naics_code: '332312' }, IMI).status).toBe('NOT_ELIGIBLE');
    expect(evaluateEligibility({ set_aside_code: 'SDVOSBC', naics_code: '332312' }, IMI).status).toBe('UNKNOWN');
    expect(evaluateEligibility({ set_aside_description: 'Veteran-Owned Small Business Set-Aside', naics_code: '332312' }, IMI).status).toBe('UNKNOWN');
    // …but size still rules a small-business programme out.
    expect(evaluateEligibility({ set_aside_code: 'SDVOSBC', naics_code: '236220' }, IMI).status).toBe('NOT_ELIGIBLE');
  });

  it('a recompete is not a live solicitation → UNKNOWN, with prior set-aside + size as context', () => {
    const v = evaluateRecompeteEligibility({ set_aside_type: 'SMALL BUSINESS SET ASIDE - TOTAL', naics_code: '236220' }, IMI);
    expect(v.status).toBe('UNKNOWN');
    expect(v.reason).toMatch(/Not a live solicitation/);
    expect(v.reason).toMatch(/does not represent itself as small under the prior NAICS 236220/);
  });
});

// ── (6) DIRECT_MATCH needs buy-side evidence ───────────────────────────────────────────────────
describe('(6) Tyonek — the holder NAME never makes an acquisition a DIRECT_MATCH', () => {
  it('fixture: 6 orders under FA8571-23-D-0004 (NAICS 334515, PSC 4920) + 2 other Tyonek awards — "machining" only in the holder name', () => {
    expect(TYONEK_VEHICLE_ORDERS).toHaveLength(6);
    expect(TYONEK_ALL).toHaveLength(8);
    for (const r of TYONEK_VEHICLE_ORDERS) {
      expect(r.naics_code).toBe('334515');
      expect(r.psc_code).toBe('4920');
    }
    for (const r of TYONEK_ALL) {
      expect(String(r.incumbent_name)).toMatch(/MACHINING AND FABRICATION/);
      expect(String(r.description)).not.toMatch(/machin|fabricat|steel|piping|rigging/i);
      expect(String(r.psc_description)).not.toMatch(/machin|fabricat|steel|piping|rigging/i);
    }
  });

  for (const q of [Q_IMI, 'industrial steel fabrication', 'machining']) {
    it(`"${q}", GA → no Tyonek order is DIRECT_MATCH`, () => {
      const p = plan(q, { state: 'GA' });
      const cap = interpretMarket(p.intent.residual, null).capability;
      for (const r of TYONEK_ALL) {
        const ev = classifyComingBackEvidence(r, p, cap);
        expect(ev.cls).not.toBe('DIRECT_MATCH');
        if (ev.cls) {
          expect(ev.cls).toBe('HOLDER_SIGNAL');
          expect(ev.basis[0]).toBe('holder_name');
        }
      }
    });
  }

  it('the IMI query labels all 8 Tyonek rows HOLDER_SIGNAL (the lead survives, honestly labelled)', () => {
    const p = plan(Q_IMI, { state: 'GA' });
    const cap = interpretMarket(p.intent.residual, null).capability;
    expect(TYONEK_ALL.map((r) => classifyComingBackEvidence(r, p, cap).cls)).toEqual(Array(8).fill('HOLDER_SIGNAL'));
  });

  it('buy-side positive controls: every GA row whose DESCRIPTION satisfies the query is DIRECT_MATCH', () => {
    const p = plan(Q_IMI, { state: 'GA' });
    const cap = interpretMarket(p.intent.residual, null).capability;
    const rows = buysideFx.data as Row[];
    const admitted = rows.filter((r) => matchesText(p.matcher, [r.description as string, r.psc_description as string]));
    // piping ×2 (CODE STEEL, TIMEBUILT) + machining (FAIRMOUNT). "OVEN AREA ENCLOSURE FABRICATION" does not satisfy
    // ALL(steel, fabrication, industrial) and IMI's own "FABRICATE … STEEL" row fails the `fabrication` inflection.
    expect(admitted.map((r) => r.piid).sort()).toEqual(['1232SA26P0533', 'FA857123P0014', 'FA857126P0057']);
    for (const r of admitted) {
      const ev = classifyComingBackEvidence(r, p, cap);
      expect(ev.cls, String(r.description)).toBe('DIRECT_MATCH');
      expect(ev.basis[0]).toBe('buy_side_text');
    }
  });

  it('holder evidence is independent — support in the description/PSC/NAICS DOES make a direct match', () => {
    const p = plan('machining', { state: 'GA' });
    const cap = interpretMarket('machining', null).capability;
    const withBuySide = { ...TYONEK_VEHICLE_ORDERS[0], description: 'CNC MACHINING OF TEST FIXTURE BRACKETS' };
    expect(classifyComingBackEvidence(withBuySide, p, cap).cls).toBe('DIRECT_MATCH');
  });

  it('legacy classifyRecord: holder name is out of the evidence blob; no unconditional DIRECT', () => {
    const lit = interpretCapability('machining');
    const t = TYONEK_VEHICLE_ORDERS[0];
    expect(classifyRecord({ title: String(t.piid), description: String(t.description), naics_code: '334515', incumbent_name: String(t.incumbent_name) }, lit)).toBeNull();
    const cyber = interpretCapability('cybersecurity');
    expect(classifyRecord({ title: 'X', description: 'janitorial services', naics_code: '561720', incumbent_name: 'CYBERCORE TECHNOLOGIES' }, cyber)).toBeNull();
  });

  it('a match only in the BUYING AGENCY name is a related-market candidate, not DIRECT', () => {
    const p = plan('forces', { state: 'GA' });
    const cap = interpretMarket('forces', null).capability;
    const row = { ...TYONEK_VEHICLE_ORDERS[0], incumbent_name: 'ACME LLC', awarding_sub_agency: 'U.S. Special Operations Command (Forces)' };
    const ev = classifyComingBackEvidence(row, p, cap);
    expect(ev.cls).toBe('RELATED_MARKET_CANDIDATE');
    expect(ev.basis[0]).toBe('buyer_name');
  });
});

// ── (A1) company codes widen recall, labelled, never DIRECT ────────────────────────────────────
describe('A1 — registered PSC/NAICS expand recall; the basis is labelled; never DIRECT_MATCH', () => {
  it('the plan unions the company codes into the Open text/taxonomy OR (and only with a text concept)', () => {
    const without = plan(Q_IMI, { state: 'AL' });
    const withCo = plan(Q_IMI, { state: 'AL', company: IMI });
    expect(JSON.stringify(without.horizons.open.ops)).not.toContain('psc_code.eq.J034');
    expect(JSON.stringify(withCo.horizons.open.ops)).toContain('psc_code.eq.J034');
    expect(JSON.stringify(withCo.horizons.recompete.ops)).toContain('naics_code.eq.332312');
    expect(withCo.company?.psc).toContain('J036');
    expect(without.company).toBeUndefined();
    // Structured-only plan: the scope already admits everything — codes are not applied.
    expect(plan('Alabama', { company: IMI }).company).toBeUndefined();
  });

  it('companyCodeRecall hands the plan exact codes', () => {
    expect(companyCodeRecall(IMI)?.psc).toContain('J034');
    expect(companyCodeRecall(null)).toBeNull();
  });

  it('Okuma RFI recalled by PSC J034 is labelled company_registered_psc, ranked after related-market, NOT DIRECT', () => {
    const p = plan(Q_IMI, { state: 'AL', company: IMI });
    const cap = interpretMarket(p.intent.residual, null).capability;
    const label = labelOpenRow(OKUMA, p, cap, IMI);
    expect(label.cls).not.toBe('DIRECT_MATCH');
    expect(label.basis).toContain('company_registered_psc');
    expect(label.tier).toBe(1.5);
  });

  it('Shaw MACC recalled by registered NAICS 236220 — and screened NOT_ELIGIBLE (relevance ≠ eligibility)', () => {
    const p = plan(Q_IMI, { state: 'SC', company: IMI });
    const cap = interpretMarket(p.intent.residual, null).capability;
    const label = labelOpenRow(SHAW, p, cap, IMI);
    expect(label.basis).toContain('company_registered_naics');
    expect(label.cls).not.toBe('DIRECT_MATCH');
    expect(evaluateEligibility(SHAW, IMI).status).toBe('NOT_ELIGIBLE');
  });
});

// ── Frozen before/after recall — same denominator (4 known-fit notices) ─────────────────────────
describe('frozen IMI acceptance — Open recall before/after, same denominator', () => {
  const measure = (state: string | null, company: CompanyAnchor | null) => {
    const p = plan(Q_IMI, { state, company });
    const recalled = KNOWN_FIT.filter((r) => admitsOpen(p, r, company));
    const verdicts = recalled.map((r) => evaluateEligibility(r, IMI).status);
    return {
      recalled: recalled.map((r) => String(r.solicitation_number)).sort(),
      eligible: verdicts.filter((s) => s === 'ELIGIBLE').length,
      not_eligible_screened: verdicts.filter((s) => s === 'NOT_ELIGIBLE').length,
      unknown: verdicts.filter((s) => s === 'UNKNOWN').length,
    };
  };

  it('the fixture set is the 4 known-fit notices, all active', () => {
    expect(KNOWN_FIT.map((r) => r.solicitation_number)).toEqual(['W911KF-26-S-0023', 'W911KF-26-S-0024', 'FA8517-27-R-0056', 'FA480326B0006']);
    expect(KNOWN_FIT.every((r) => r.active === true)).toBe(true);
    expect(stateOrExpr(['GA'])).toContain('office_address->>state.eq.GA');
  });

  it('IMI\'s original call (location GA): 0/4 before, 0/4 after — the misses are geographic (AL/SC); needs multi-state (Workstream C)', () => {
    expect(measure('GA', null).recalled).toEqual([]);
    expect(measure('GA', IMI).recalled).toEqual([]);
  });

  it('location AL: 0/4 → 2/4 (both Anniston RFIs by registered PSC J034/J036), both ELIGIBLE', () => {
    expect(measure('AL', null)).toEqual({ recalled: [], eligible: 0, not_eligible_screened: 0, unknown: 0 });
    expect(measure('AL', IMI)).toEqual({ recalled: ['W911KF-26-S-0023', 'W911KF-26-S-0024'], eligible: 2, not_eligible_screened: 0, unknown: 0 });
  });

  it('no location: 0/4 → 3/4 (2 Anniston RFIs ELIGIBLE + Shaw MACC recalled-but-screened NOT_ELIGIBLE)', () => {
    expect(measure(null, null).recalled).toEqual([]);
    expect(measure(null, IMI)).toEqual({
      recalled: ['FA480326B0006', 'W911KF-26-S-0023', 'W911KF-26-S-0024'],
      eligible: 2,
      not_eligible_screened: 1,
      unknown: 0,
    });
  });

  it('FA8517-27-R-0056 (KC-135 fixture, NAICS 488190, no PSC) is NOT recalled by A — vocabulary gap, not a company-code gap', () => {
    expect(measure(null, IMI).recalled).not.toContain('FA8517-27-R-0056');
    expect(IMI.naics).not.toContain('488190');
  });
});

// ── End-to-end over a fake client (fixtures in, labelled items out) ─────────────────────────────
function fakeClient(tables: Record<string, Row[]>) {
  const make = (table: string) => {
    let head = false;
    const rows = tables[table] || [];
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['select', 'or', 'eq', 'is', 'gt', 'lt', 'gte', 'lte', 'ilike', 'like', 'in', 'not', 'order', 'limit', 'range', 'neq', 'filter', 'contains', 'overlaps', 'match', 'textSearch']) {
      builder[m] = (...args: unknown[]) => {
        if (m === 'select' && (args[1] as { head?: boolean } | undefined)?.head) head = true;
        return chain();
      };
    }
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(head ? { data: null, count: 0, error: null } : { data: rows, count: rows.length, error: null });
    return builder;
  };
  return { from: (t: string) => make(t) } as never;
}

const foundLookup = async () => ({ entity, matches: [], queried: { uei: IMI_UEI }, _meta: { grounded: true, degraded: false, match_count: 1, mode: 'uei', source: 'sam_live', lookup_status: 'found' } }) as unknown as SamEntityResult;

describe('findOpportunities end-to-end (fake client, frozen rows)', () => {
  const tables = {
    sam_opportunities: [OKUMA, SHOTBLAST, SHAW],
    recompete_opportunities: [...TYONEK_VEHICLE_ORDERS, ...(buysideFx.data as Row[])],
    agency_forecasts: [],
  };

  it('company-anchored: every item carries eligibility; Tyonek is HOLDER_SIGNAL; Shaw NOT_ELIGIBLE', async () => {
    const res = await findOpportunities({ query: Q_IMI, uei: IMI_UEI, limit_per_horizon: 25 }, { client: fakeClient(tables), entityLookup: foundLookup });
    expect(res.company?.status).toBe('resolved');
    expect(res.company?.recall_codes?.psc).toContain('J034');
    expect(res.horizons.open_now.status).toBe('grounded');
    expect(res.horizons.coming_back.status).toBe('grounded');
    const open = res.horizons.open_now.items;
    expect(open).toHaveLength(3);
    expect(open.every((i) => i.eligibility)).toBe(true);
    const shaw = open.find((i) => i.solicitation_number === 'FA480326B0006');
    expect(shaw?.eligibility?.status).toBe('NOT_ELIGIBLE');
    expect(open.find((i) => i.solicitation_number === 'W911KF-26-S-0023')?.match_basis).toContain('company_registered_psc');
    expect(open.some((i) => i.evidence_class === 'DIRECT_MATCH' && (i.match_basis || []).every((b) => String(b).startsWith('company_')))).toBe(false);
    const back = res.horizons.coming_back.items;
    expect(back.every((i) => i.eligibility?.status === 'UNKNOWN')).toBe(true);
    const ty = back.filter((i) => /TYONEK/.test(String(i.incumbent_name)));
    expect(ty).toHaveLength(6);
    expect(ty.every((i) => i.evidence_class === 'HOLDER_SIGNAL')).toBe(true);
    expect(res.summary.coming_back.holder_signal).toBe(6);
    // The fake client returns every fixture row; only the 3 buy-side rows are DIRECT, IMI's own award is
    // recalled by its registered NAICS 332999 (company code, no class), the oven row carries no evidence.
    expect(res.summary.coming_back.direct_match).toBe(3);
    expect(back.filter((i) => i.evidence_class === 'DIRECT_MATCH').every((i) => (i.match_basis || [])[0] === 'buy_side_text')).toBe(true);
    expect(res.horizons.open_now.eligibility_counts).toMatchObject({ NOT_ELIGIBLE: 1 });
    expect(res.presentation.host_rules).toEqual([...HOST_RULES_FIND_FIRST_VALUE, ...HOST_RULES_COMPANY_ANCHORED]);
  });

  it('no uei → beginner flow unchanged: no company block, no eligibility, P2 host_rules only', async () => {
    const res = await findOpportunities({ query: Q_IMI, limit_per_horizon: 25 }, { client: fakeClient(tables) });
    expect(res.horizons.open_now.status).toBe('grounded');
    expect(res.company).toBeUndefined();
    expect(Object.values(res.horizons).every((h) => h.items.every((i) => i.eligibility === undefined))).toBe(true);
    expect(res.presentation.host_rules).toEqual([...HOST_RULES_FIND_FIRST_VALUE]);
    // …but the holder-name fix applies to everyone.
    expect(res.horizons.coming_back.items.filter((i) => /TYONEK/.test(String(i.incumbent_name))).every((i) => i.evidence_class === 'HOLDER_SIGNAL')).toBe(true);
  });

  it('a failed company lookup never blocks FIND: items say UNKNOWN with the reason', async () => {
    const res = await findOpportunities({ query: Q_IMI, uei: IMI_UEI }, { client: fakeClient(tables), entityLookup: async () => { throw new Error('SAM down'); } });
    expect(res.company?.status).toBe('lookup_failed');
    expect(res.horizons.open_now.items.length).toBeGreaterThan(0);
    expect(res.horizons.open_now.items.every((i) => i.eligibility?.status === 'UNKNOWN')).toBe(true);
    expect(res._meta.grounded).toBe(true);
  });

  it('MCP_POLICY is the governing default', () => {
    expect(mcpDiscoveryPolicy({ query: 'x' }).surface).toBe(MCP_POLICY.surface);
  });
});
