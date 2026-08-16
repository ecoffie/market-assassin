/**
 * Competition Health grounding contract (buyer-side mirror).
 *
 * The lib must be HONEST: a failed primary read surfaces the error (never a fake empty market);
 * set-aside % is computed from EXACT head-counts over the WHOLE set (never a sampled ratio — the
 * 1000-row-cap trap); and the priorities cite the real computed numbers. Stubs the Supabase builder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * FLAKE FIX (2026-08-16): these tests reached the REAL USASpending API.
 * computeCompetitionHealth → computeCompetitionDepth issues live fetches to
 * api.usaspending.gov, so the suite passed when that API was fast and timed out
 * at 10s when it was slow — blocking the pre-push gate for changes that never
 * touched this file. A unit test must not depend on a third party being quick.
 *
 * Stub fetch to a deterministic empty result: competition depth is not what these
 * tests assert (they cover set-aside head-counts, grounding, and priorities), and
 * the lib already degrades honestly when depth is unavailable.
 */
import { computeCompetitionHealth, buildCompetitionPriorities } from './competition-health';

const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

// Chainable stub keyed by table; each terminal resolves to { count, data, error }.
function makeStub(byTable: Record<string, { count?: number | null; data?: unknown[]; error?: { message: string } | null }>) {
  const build = (table: string) => {
    // sam_opportunities is hit 3x (active head-count, set-aside head-count, sample rows); we serve the
    // SAME configured response for all — the test drives count vs data via the table's config, and the
    // lib reads count off the head-counts and data off the sample.
    const res = byTable[table] ?? { count: 0, data: [], error: null };
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    for (const m of ['select', 'eq', 'neq', 'not', 'ilike', 'limit', 'gte', 'lt']) chain[m] = ret;
    chain.then = (resolve: (v: unknown) => void) => resolve({ count: res.count ?? null, data: res.data ?? null, error: res.error ?? null });
    return chain;
  };
  return { from: (t: string) => build(t) } as unknown as Parameters<typeof computeCompetitionHealth>[0];
}

describe('competition-health grounding contract', () => {
  it('surfaces a primary-read failure as an error (never a fake empty market)', async () => {
    const stub = makeStub({ sam_opportunities: { count: null, error: { message: 'db down' } } });
    const h = await computeCompetitionHealth(stub, 'TEST AGENCY');
    expect(h.error).toContain('db down');
    expect(h.grounded).toBe(false);
  });

  it('computes set-aside % from EXACT head-counts (not a sampled ratio)', async () => {
    // active head-count = 2882, set-aside head-count = 1252 → 43.4% over the WHOLE set.
    // Both head-counts hit sam_opportunities; the stub returns the SAME count for each call, so to
    // exercise the ratio we assert the shape holds when active==setaside (100%) — proving it reads the
    // real count, and the sample rows drive the mix.
    const stub = makeStub({
      sam_opportunities: { count: 2882, data: [{ set_aside_code: 'SDVOSBC', naics_code: '236220' }, { set_aside_code: 'NONE', naics_code: '541512' }], error: null },
      recompete_opportunities: { data: [{ set_aside_enriched: 'Full & Open' }], error: null },
    });
    const h = await computeCompetitionHealth(stub, 'VETERANS AFFAIRS, DEPARTMENT OF');
    expect(h.grounded).toBe(true);
    expect(h.smallBizParticipation.activeOpps).toBe(2882);
    expect(h.smallBizParticipation.withSetAside).toBe(2882); // both head-counts return the stub count
    expect(h.smallBizParticipation.pct).toBe(100);
    // mix from the sample: SDVOSBC → 'SDVOSB' counted, 'NONE' excluded (full & open)
    expect(h.setAsideMix.find((m) => m.label === 'SDVOSB')?.count).toBe(1);
    expect(h.setAsideMix.find((m) => m.label === 'NONE')).toBeUndefined();
    // awarded mix from recompete
    expect(h.awardedSetAsideMix.find((m) => m.label === 'Full & Open')?.count).toBe(1);
  });

  it('priorities cite the real computed participation number', async () => {
    const stub = makeStub({
      sam_opportunities: { count: 1000, data: [{ set_aside_code: 'SBA', naics_code: '236220' }], error: null },
      recompete_opportunities: { data: [], error: null },
    });
    const h = await computeCompetitionHealth(stub, 'X');
    const pr = buildCompetitionPriorities(h);
    expect(pr.length).toBeGreaterThan(0);
    // 1000/1000 = 100% → healthy, and the body must contain the real number
    expect(pr[0].level).toBe('go');
    expect(pr[0].body).toContain('100%');
  });

  it('never fabricates the deferred metrics — they stay null + disclosed', async () => {
    const stub = makeStub({ sam_opportunities: { count: 10, data: [], error: null }, recompete_opportunities: { data: [], error: null } });
    const h = await computeCompetitionHealth(stub, 'X');
    expect(h.supplierReach).toBeNull();
    // competition depth is best-effort via USASpending; in unit (no network) it stays grounded:false
    // with a null avg — never a fabricated number.
    expect(h.competitionDepth.avgBidders).toBeNull();
    expect(h.competitionDepth.grounded).toBe(false);
    // avg-bidders is now its own (competitionDepth) metric, so only supplier reach remains deferred → 1.
    expect(h.notYetMeasurable.length).toBe(1);
    expect(h.notYetMeasurable.some((m) => m.metric.startsWith('First-time'))).toBe(false);
    expect(h.notYetMeasurable.some((m) => m.metric.toLowerCase().includes('average bidders'))).toBe(false);
  });

  it('ranks winners by $ + computes concentration from the award record', async () => {
    // sam_opportunities data serves BOTH the mix sample AND the award-notice pull (same table stub).
    // Award rows: two winners, one big. concentration = top-3 share of $ = 100% (only 2 firms).
    const stub = makeStub({
      sam_opportunities: {
        count: 100,
        data: [
          { set_aside_code: 'SBA', naics_code: '236220', awardee_name: 'BIG CORP', award_amount: '9000000' },
          { set_aside_code: 'NONE', naics_code: '541512', awardee_name: 'SMALL LLC', award_amount: '1000000' },
        ],
        error: null,
      },
      recompete_opportunities: { data: [], error: null },
    });
    const h = await computeCompetitionHealth(stub, 'X');
    expect(h.winners.distinctWinners).toBe(2);
    // BIG CORP ($9M) ranks above SMALL LLC ($1M)
    expect(h.winners.topWinners[0].name).toBe('BIG CORP');
    expect(h.winners.topWinners[0].total).toBe(9_000_000);
    // top-3 share of $ = (9M+1M)/(10M) = 100%
    expect(h.winners.concentrationPct).toBe(100);
    // amounts are real from the data — never invented
    expect(h.winners.topWinners.reduce((s, w) => s + w.total, 0)).toBe(10_000_000);
  });
});
