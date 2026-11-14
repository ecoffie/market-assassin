import { describe, it, expect } from 'vitest';
import { findOpportunities } from './find-opportunities';
import { openEvidenceSummary, evidenceMarket, evidenceCapability } from './evidence-group-map';
import { buildDiscoveryPlan } from '@/lib/discovery/plan';
import { MCP_POLICY } from '@/lib/discovery/policy';
import { interpretMarket } from './market-interpretation';
import type { OpenRelevanceClass } from './open-relevance';

/**
 * C2 slice 2 (Agent 3, 2026-11-14; approved by Eric, reviewed by Agent 1). find_opportunities open_now gains:
 *   evidence_counts_scope — evidence_counts covers the classified WINDOW (rows, deadline order, DIRECT + RELATED only)
 *   evidence_totals       — full-result direct / related / other ONLY when that window IS the whole result; otherwise
 *                           null groups with a reason. Unknown is never 0. No extra query.
 */
const D = 'DIRECT_MATCH', R = 'RELATED_MARKET_CANDIDATE', W = 'WEAK_NON_MARKET';
const many = (n: number, c: OpenRelevanceClass) => Array.from({ length: n }, () => c);

describe('openEvidenceSummary — when the window is the whole result', () => {
  it('complete: direct + related + other === total === matched_count', () => {
    const { scope, totals } = openEvidenceSummary({ classes: [D, D, R, W, W, W], matchedCount: 6, windowLimit: 500, companyUnion: false });
    expect(scope.covers_full_result).toBe(true);
    expect(totals).toEqual({ complete: true, unit: 'rows', total: 6, direct: 2, related: 1, other: 3 });
  });
  it('"other" is counted (evidence_counts never counts it)', () => {
    const { totals } = openEvidenceSummary({ classes: many(4, W), matchedCount: 4, windowLimit: 500, companyUnion: false });
    expect(totals.complete && totals.other).toBe(4);
  });
  it('a zero-result search is complete with zeros (zero is known here, not guessed)', () => {
    const { totals } = openEvidenceSummary({ classes: [], matchedCount: 0, windowLimit: 500, companyUnion: false });
    expect(totals).toEqual({ complete: true, unit: 'rows', total: 0, direct: 0, related: 0, other: 0 });
  });
});

describe('openEvidenceSummary — never claims a total it did not classify', () => {
  it('more matches than the window: null groups, reason not_computed_over_window, total kept', () => {
    const { scope, totals } = openEvidenceSummary({ classes: many(500, D), matchedCount: 1279, windowLimit: 500, companyUnion: false });
    expect(scope).toMatchObject({ covers_full_result: false, rows_classified: 500, window_limit: 500 });
    expect(totals).toEqual({ complete: false, unit: 'rows', total: 1279, direct: null, related: null, other: null, reason: 'not_computed_over_window' });
  });
  it('exactly 500 rows with matched_count UNKNOWN is not complete (Agent 1 case)', () => {
    const { scope, totals } = openEvidenceSummary({ classes: many(500, D), matchedCount: null, windowLimit: 500, companyUnion: false });
    expect(scope.covers_full_result).toBe(false);
    expect(totals).toMatchObject({ complete: false, total: null, direct: null, reason: 'total_unknown' });
  });
  it('a company-anchored union of two plans is never "the whole result"', () => {
    const { totals } = openEvidenceSummary({ classes: [D, R], matchedCount: 2, windowLimit: 500, companyUnion: true });
    expect(totals).toMatchObject({ complete: false, total: 2, direct: null, reason: 'company_union' });
  });
});

describe('one derivation of the labeller capability', () => {
  it('evidenceMarket equals the previous interpretQuery derivation (keyword residual + primary buyer)', () => {
    const plan = buildDiscoveryPlan({ query: 'janitorial services', agency: 'Navy' }, MCP_POLICY);
    expect(evidenceMarket(plan, 'Navy')).toEqual(interpretMarket('janitorial services', 'Navy'));
    expect(evidenceCapability(plan)).toEqual(interpretMarket('janitorial services', plan.buyers[0]?.requested ?? null).capability);
  });
});

// ── End to end through find_opportunities (hermetic fake client; count can differ from the rows returned) ──────────
type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>, counts: Record<string, number | null> = {}) {
  const make = (table: string) => {
    let head = false;
    const rows = tables[table] || [];
    const count = table in counts ? counts[table] : rows.length;
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'or', 'eq', 'is', 'gt', 'lt', 'gte', 'lte', 'ilike', 'like', 'in', 'not', 'order', 'limit', 'range', 'neq', 'filter', 'contains', 'overlaps', 'match', 'textSearch', 'maybeSingle', 'single']) {
      b[m] = (...args: unknown[]) => { if (m === 'select' && (args[1] as { head?: boolean } | undefined)?.head) head = true; return b; };
    }
    b.then = (resolve: (v: unknown) => unknown) => resolve(head ? { data: null, count, error: null } : { data: rows, count, error: null });
    return b;
  };
  return { from: (t: string) => make(t), rpc: () => Promise.resolve({ data: null, error: null }) } as never;
}
const notice = (o: Row): Row => ({
  notice_id: String(Math.random()), title: '', description: '', department: 'DEPT OF DEFENSE', sub_tier: '', solicitation_number: 'X',
  naics_code: '', psc_code: '', response_deadline: new Date(Date.now() + 20 * 864e5).toISOString(), active: true, notice_type: 'Solicitation',
  map_lat: 1, map_lng: 1, office_address: null, ...o,
});
const OPEN = [
  notice({ title: 'Recurring Janitorial Services, Key West', naics_code: '561720' }),
  notice({ title: 'Bombing Range Operation', naics_code: '561210' }),
  notice({ title: 'Aircraft test stand', naics_code: '334515', description: 'janitorial services incidental' }),
];

describe('find_opportunities open_now carries the scope and the totals', () => {
  it('small result: totals complete and sum to matched_count; evidence_counts unchanged', async () => {
    const res = await findOpportunities({ query: 'janitorial services' }, { client: fakeClient({ sam_opportunities: OPEN, recompete_opportunities: [], agency_forecasts: [] }) });
    const o = res.horizons.open_now;
    expect(o.evidence_counts_scope?.covers_full_result).toBe(true);
    const t = o.evidence_totals!;
    expect(t.complete).toBe(true);
    if (t.complete) {
      expect(t.direct + t.related + t.other).toBe(o.matched_count);
      expect(t.direct).toBe(o.evidence_counts!.DIRECT_MATCH);
      expect(t.related).toBe(o.evidence_counts!.RELATED_MARKET_CANDIDATE);
    }
  });
  it('matched_count larger than the rows classified: groups null, reason not_computed_over_window', async () => {
    const res = await findOpportunities({ query: 'janitorial services' }, { client: fakeClient({ sam_opportunities: OPEN, recompete_opportunities: [], agency_forecasts: [] }, { sam_opportunities: 1279 }) });
    const o = res.horizons.open_now;
    expect(o.evidence_counts_scope?.covers_full_result).toBe(false);
    expect(o.evidence_totals).toMatchObject({ complete: false, total: 1279, direct: null, related: null, other: null, reason: 'not_computed_over_window' });
  });
  it('matched_count unknown: groups null, reason total_unknown, never 0', async () => {
    const res = await findOpportunities({ query: 'janitorial services' }, { client: fakeClient({ sam_opportunities: OPEN, recompete_opportunities: [], agency_forecasts: [] }, { sam_opportunities: null }) });
    expect(res.horizons.open_now.evidence_totals).toMatchObject({ complete: false, total: null, direct: null, reason: 'total_unknown' });
  });
});
