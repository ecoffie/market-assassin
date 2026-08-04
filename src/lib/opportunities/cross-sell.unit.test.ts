/**
 * Guard for the bidirectional cross-sell match engine ("Ways to win this") + its drawer wiring.
 *
 * Pins the load-bearing behavior of both directions:
 *   - NAICS + STATE scope is applied INSIDE the fetch, BEFORE the order+limit (rank-then-filter safe);
 *   - self is excluded;
 *   - results are capped at CROSS_SELL_LIMIT;
 *   - the multi-award-IDIQ echo is deduped (open→awarded);
 *   - open bids match place-of-performance OR buying-office state (SAM pop_state is sparse);
 *   - an invalid/half-replaced NAICS or missing state → [] (never the wrong market);
 *   - a query error → [] (fail-soft, so the drawer renders the GOS #10 empty state);
 *   - the drawer renders the empty-state section (header + "none found"), never vanishing;
 *   - PURE SUPABASE — the lib imports no BigQuery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A chainable fake Supabase query builder that records the filters applied and resolves to a
// preset { data, error }. Terminal await resolves via .then (PostgREST builders are thenable).
type Preset = { data: unknown[] | null; error: { message: string } | null };
function makeBuilder(preset: Preset) {
  const calls: Record<string, unknown[]> = {};
  const rec = (name: string, args: unknown[]) => { (calls[name] ||= []).push(args); };
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'gt', 'or', 'order', 'neq', 'limit', 'like', 'in']) {
    builder[m] = (...a: unknown[]) => { rec(m, a); return builder; };
  }
  builder.then = (resolve: (p: Preset) => unknown) => Promise.resolve(preset).then(resolve);
  builder.__calls = calls;
  return builder as Record<string, (...a: unknown[]) => unknown> & { __calls: typeof calls };
}

let lastBuilder: ReturnType<typeof makeBuilder>;
let lastPreset: Preset;
vi.mock('@/lib/supabase/server-clients', () => ({
  getReadClient: () => ({ from: () => (lastBuilder = makeBuilder(lastPreset)) }),
}));

import { findSubcontractTargets, findOpenBidTargets, normalizeCrossSellKey, CROSS_SELL_LIMIT } from './cross-sell';

function setRows(rows: unknown[] | null, error: Preset['error'] = null) { lastPreset = { data: rows, error }; }

describe('normalizeCrossSellKey', () => {
  it('accepts a 6-digit NAICS + a 2-letter state, normalizing a full state name', () => {
    expect(normalizeCrossSellKey('541512', 'Florida')).toEqual({ naics: '541512', state: 'FL' });
    expect(normalizeCrossSellKey('541512', 'fl')).toEqual({ naics: '541512', state: 'FL' });
  });
  it('rejects an invalid/half-replaced NAICS or a missing state (never guesses a market)', () => {
    expect(normalizeCrossSellKey('5415', 'FL')).toBeNull();   // too short
    expect(normalizeCrossSellKey('541512', '')).toBeNull();    // no state
    expect(normalizeCrossSellKey('', 'FL')).toBeNull();        // no naics
    expect(normalizeCrossSellKey('541512', 'Nowhere')).toBeNull(); // not a real state
  });
});

describe('findSubcontractTargets (OPEN → awarded)', () => {
  beforeEach(() => { setRows([]); });

  it('filters by NAICS + place-of-performance state, excludes self, orders by value desc', async () => {
    // Return a tier-1 hit so the tiered fetch STOPS at the exact-match tier — otherwise every tier
    // runs and lastBuilder reflects the LAST (widened) tier, not the exact-NAICS+state query we test.
    setRows([{ contract_id: 'A1', incumbent_name: 'ACME', potential_total_value: 500, awarding_agency: 'GSA', period_of_performance_current_end: '2027-01-01', naics_code: '541512', place_of_performance_state: 'FL' }]);
    await findSubcontractTargets('541512', 'FL', 'CONT_SELF');
    const c = lastBuilder.__calls;
    expect(c.eq).toContainEqual(['naics_code', '541512']);      // tier 1 = EXACT NAICS
    expect(c.eq).toContainEqual(['place_of_performance_state', 'FL']); // + EXACT state
    expect(c.is).toContainEqual(['quality_flag', null]);        // excludes grouped_synthetic
    expect(c.neq).toContainEqual(['contract_id', 'CONT_SELF']); // self excluded
    expect(c.order?.[0]?.[0]).toBe('potential_total_value');    // ranked by $ desc
    expect((c.order?.[0]?.[1] as { ascending: boolean }).ascending).toBe(false);
    // ⚠️ scope (eq naics + eq state) is applied BEFORE the limit — rank-then-filter safe.
    expect(c.limit).toBeTruthy();
  });

  it('dedupes the multi-award-IDIQ echo (same incumbent + same value = one card) and caps at limit', async () => {
    // Peraton appears twice (rollup + base PIID); three distinct primes follow.
    setRows([
      { contract_id: 'A1', incumbent_name: 'PERATON INC.', potential_total_value: 800, awarding_agency: 'GSA', period_of_performance_current_end: '2027-05-16', naics_code: '541512' },
      { contract_id: 'A2', incumbent_name: 'PERATON INC.', potential_total_value: 800, awarding_agency: 'GSA', period_of_performance_current_end: '2027-05-16', naics_code: '541512' },
      { contract_id: 'B1', incumbent_name: 'GDIT', potential_total_value: 300, awarding_agency: 'GSA', period_of_performance_current_end: '2027-02-04', naics_code: '541512' },
      { contract_id: 'C1', incumbent_name: 'MANTECH', potential_total_value: 150, awarding_agency: 'DOD', period_of_performance_current_end: '2026-12-31', naics_code: '541512' },
    ]);
    const out = await findSubcontractTargets('541512', 'FL', null);
    expect(out.map((t) => t.incumbent)).toEqual(['PERATON INC.', 'GDIT', 'MANTECH']); // Peraton once
    expect(out[0]).toMatchObject({ id: 'A1', value: 800, agency: 'GSA', state: 'FL' });
  });

  it('caps at CROSS_SELL_LIMIT even with many distinct primes', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      contract_id: 'X' + i, incumbent_name: 'FIRM ' + i, potential_total_value: 1000 - i,
      awarding_agency: 'GSA', period_of_performance_current_end: '2027-01-01', naics_code: '541512',
    }));
    setRows(rows);
    const out = await findSubcontractTargets('541512', 'VA', null);
    expect(out.length).toBe(CROSS_SELL_LIMIT);
  });

  it('returns [] for an invalid key (never queries the wrong market)', async () => {
    const out = await findSubcontractTargets('5415', 'FL', null);
    expect(out).toEqual([]);
  });

  it('fails soft — a query error yields [] (not a throw)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setRows(null, { message: 'boom' });
    const out = await findSubcontractTargets('541512', 'FL', null);
    expect(out).toEqual([]);
    errSpy.mockRestore();
  });
});

describe('findOpenBidTargets (AWARDED → open)', () => {
  beforeEach(() => { setRows([]); });

  it('filters by NAICS + active + open deadline + (pop_state OR office state), orders by deadline asc', async () => {
    setRows([]);
    await findOpenBidTargets('541611', 'VA', 'NID_SELF');
    const c = lastBuilder.__calls;
    expect(c.eq).toContainEqual(['naics_code', '541611']);
    expect(c.eq).toContainEqual(['active', true]);
    expect(c.gt?.[0]?.[0]).toBe('response_deadline'); // only not-yet-closed
    // State matches place-of-performance OR the buying-office state (SAM pop_state ~36% filled).
    expect(c.or?.[0]?.[0]).toBe("pop_state.eq.VA,office_address->>state.eq.VA");
    expect(c.neq).toContainEqual(['notice_id', 'NID_SELF']); // self excluded
    expect(c.order?.[0]?.[0]).toBe('response_deadline');
    expect((c.order?.[0]?.[1] as { ascending: boolean }).ascending).toBe(true);
    expect(c.limit).toBeTruthy();
  });

  it('shapes cards (title/agency/set-aside/deadline) and caps at limit', async () => {
    setRows([
      { notice_id: 'N1', title: 'IT Support', department: 'DOD', set_aside_description: 'Total Small Business Set-Aside (FAR 19.5)', set_aside_code: 'SBA', response_deadline: '2026-08-01T00:00:00Z', naics_code: '541611' },
      { notice_id: 'N2', title: 'Sole source', department: 'DOD', set_aside_description: 'No Set aside used', set_aside_code: 'NONE', response_deadline: '2026-08-02T00:00:00Z', naics_code: '541611' },
    ]);
    const out = await findOpenBidTargets('541611', 'VA', null);
    expect(out[0]).toMatchObject({ id: 'N1', title: 'IT Support', agency: 'DOD', state: 'VA' });
    expect(out[0].setAside).toContain('Small Business');
    expect(out[1].setAside).toBeNull(); // "No set aside used" / NONE → null (Open at render)
  });

  it('returns [] for a missing state (never queries the wrong market)', async () => {
    const out = await findOpenBidTargets('541611', '', null);
    expect(out).toEqual([]);
  });

  it('fails soft — a query error yields [] (not a throw)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setRows(null, { message: 'boom' });
    const out = await findOpenBidTargets('541611', 'VA', null);
    expect(out).toEqual([]);
    errSpy.mockRestore();
  });
});

describe('cross-sell drawer wiring + GOS #10 empty state', () => {
  const routeSrc = readFileSync(join(__dirname, '../../app/opportunity-map/route.ts'), 'utf8');
  const libSrc = readFileSync(join(__dirname, 'cross-sell.ts'), 'utf8');

  it('is PURE SUPABASE — the lib imports/calls no BigQuery (quota is exhausted)', () => {
    // No BQ module import and none of the BQ-backed ranked-fetch helpers.
    expect(/from ['"][^'"]*bigquery/i.test(libSrc)).toBe(false);
    expect(/\b(queryCached|searchRecipients|findCapableSmallBusinesses)\s*\(/.test(libSrc)).toBe(false);
    expect(libSrc).toContain("from '@/lib/supabase/server-clients'");
  });

  it('OPEN drawer renders the subcontract-targets section + fetches related-awards', () => {
    expect(routeSrc).toContain('xsellSub');
    expect(routeSrc).toContain('/api/app/related-awards?naics=');
    expect(routeSrc).toContain('subcontractSec');
    expect(routeSrc).toContain('loadCrossSellAwards');
  });

  it('AWARDED drawer renders the open-bids section + fetches related-opps', () => {
    expect(routeSrc).toContain('xsellOpen');
    expect(routeSrc).toContain('/api/app/related-opps?naics=');
    expect(routeSrc).toContain('openBidsSec');
    expect(routeSrc).toContain('loadCrossSellOpen(o)');
  });

  it('GOS #10 — each section renders header + a "none found" placeholder when empty (never vanishes)', () => {
    // Subcontract empty state now explains the real reason (grant-funded work, not contracts) after
    // the tiered widen finds nothing — an honest miss, not a dead "no primes" line (Eric 2026-07-27).
    expect(routeSrc).toContain('No prime <b>contracts</b>');
    expect(routeSrc).toContain('grants');
    expect(routeSrc).toContain('No open opportunities found');
  });

  it('subcontract + open-bids share the single TEAMING tab (buildTabs 9-question groups)', () => {
    // 2026-08-03 (Eric): buildTabs became the 9-question decision flow — one tab per question, not
    // one per section. subtargets + openbids are both members of the "Teaming" group (question 7:
    // "who should I partner with?"); the resolver shows one Teaming tab targeting whichever is present.
    expect(routeSrc).toContain("[['subtargets','openbids'],'Teaming']");
  });

  it('subcontract cards open the awarded drawer from card data (row not in the loaded map set)', () => {
    expect(routeSrc).toContain('openRecompeteFromData');
    expect(routeSrc).toContain('data-xsell="award"');
  });

  it('open-bid cards open the opp drawer with force=true (works from recompete map mode)', () => {
    expect(routeSrc).toContain("openOppDrawer(\\'"); // onclick opener present
    expect(routeSrc).toContain("',true)"); // force flag
  });
});

// PSC-aware cross-sell (Eric 2026-08-03: Teaming showed healthcare-IT/fuel primes and Related showed
// zebrafish/lab opps for a BOP RADIO buy — both ranked over the broad NAICS 541519, not the work).
describe('cross-sell is PSC-aware (same PSC = same work, off the broad NAICS)', () => {
  const src = readFileSync(join(__dirname, 'cross-sell.ts'), 'utf8');
  const route = readFileSync(join(__dirname, '../../app/opportunity-map/route.ts'), 'utf8');

  it('Related opps runs a PSC-FIRST query (sam_opportunities.psc_code is well-populated), falling back to NAICS', () => {
    expect(src).toContain('q.like(\'psc_code\', `${String(psc).toUpperCase().slice(0, 4)}%`) : q.eq(\'naics_code\', key.naics)');
    // PSC tier only accepted when it has real depth (≥2) so a rare PSC doesn't render a dead section
    expect(src).toContain('(r.data || []).length >= 2');
  });
  it('Teaming SOFT-promotes same-PSC primes (recompete psc_code is ~7% filled → additive, never a hard filter)', () => {
    // pulls a wider superset then re-orders PSC-matched first; NEVER a .eq(psc) that would zero the section
    expect(src).toContain('const pscPrefix = opts.psc ? String(opts.psc).toUpperCase().slice(0, 4)');
    expect(src).toMatch(/rows\.sort\(\(a, b\) =>[\s\S]{0,200}startsWith\(pscPrefix\)/);
    expect(src).not.toMatch(/recompete[\s\S]{0,400}\.eq\('psc_code'/); // no hard PSC filter on the sparse table
  });
  it('both drawer fetches send &psc=; both routes read it', () => {
    expect(route).toContain('/api/app/related-awards?naics=');
    expect(route).toContain("'&psc='+encodeURIComponent(psc||'')");   // teaming fetch
    expect(route).toContain("'&psc='+encodeURIComponent(o.psc||'')"); // related fetch
    const awardsRoute = readFileSync(join(__dirname, '../../app/api/app/related-awards/route.ts'), 'utf8');
    const oppsRoute = readFileSync(join(__dirname, '../../app/api/app/related-opps/route.ts'), 'utf8');
    expect(awardsRoute).toContain("p.get('psc')");
    expect(oppsRoute).toContain("p.get('psc')");
  });
});
