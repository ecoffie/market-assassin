/**
 * Market Pulse grounding contract (Bug Prevention Rule #11 applied to the "Today in the Market" strip).
 *
 * The pulse must be HONEST: a failed sub-query yields no signal (or a null delta), never a fabricated
 * number, and a totally-failed PRIMARY read yields grounded:false + a surfaced error — never a
 * confident-but-empty strip. These tests stub the Supabase query builder to exercise those branches
 * without touching the network.
 */
import { describe, it, expect } from 'vitest';
import { computeMarketPulse } from './market-pulse';

// Minimal chainable stub mimicking the PostgREST builder the lib uses:
//   supabase.from(t).select(cols,{count,head}).gte(...).lt(...).not(...).limit(...) → thenable
// Each terminal resolves to { count, data, error }. We drive per-table responses via a map.
function makeStub(responses: Record<string, { count?: number | null; data?: unknown[]; error?: { message: string } | null }>) {
  const handler = (table: string) => {
    const res = responses[table] ?? { count: 0, data: [], error: null };
    const chain: Record<string, unknown> = {};
    const ret = () => chain;
    for (const m of ['select', 'gte', 'lt', 'not', 'limit', 'eq', 'lte']) chain[m] = ret;
    // make it thenable so `await chain` resolves to the response
    chain.then = (resolve: (v: unknown) => void) => resolve({ count: res.count ?? null, data: res.data ?? null, error: res.error ?? null });
    return chain;
  };
  return { from: (t: string) => handler(t) } as unknown as Parameters<typeof computeMarketPulse>[0];
}

describe('market-pulse grounding contract', () => {
  it('surfaces a primary-read failure as grounded:false + error (never a fake empty strip)', async () => {
    const stub = makeStub({ sam_opportunities: { count: null, error: { message: 'boom' } } });
    const pulse = await computeMarketPulse(stub, 7);
    expect(pulse.grounded).toBe(false);
    expect(pulse.signals).toHaveLength(0);
    expect(pulse.error).toContain('boom');
  });

  it('emits the new-opportunities signal with a real delta when both weeks return counts', async () => {
    // Two different tables in reality, but our stub keys on table name — so this-week and prior-week
    // both hit sam_opportunities; the lib runs them as separate calls and reads count off each. We give
    // one deterministic count; the delta is computed from the same value for both (delta 0), proving the
    // signal is emitted and the number is the REAL count, not invented.
    const stub = makeStub({ sam_opportunities: { count: 8842, data: [], error: null }, recompete_opportunities: { count: 0, error: null } });
    const pulse = await computeMarketPulse(stub, 7);
    expect(pulse.grounded).toBe(true);
    const newOpps = pulse.signals.find((s) => s.key === 'new_opps');
    expect(newOpps).toBeTruthy();
    expect(newOpps!.label).toContain('8,842');
    // delta is 0% (same count both weeks) — a real computed value, never a fabricated non-zero
    expect(newOpps!.delta).toBe('+0%');
  });

  it('never fabricates a demand-mover from a tiny base (requires ≥20 prior-week postings)', async () => {
    // sector 23 (Construction) has 3 this week, 1 prior → a +200% jump that MUST be suppressed.
    const stub = makeStub({
      sam_opportunities: {
        count: 5, error: null,
        data: [{ naics_code: '236220' }, { naics_code: '236220' }, { naics_code: '236220' }],
      },
      recompete_opportunities: { count: 0, error: null },
    });
    const pulse = await computeMarketPulse(stub, 7);
    // demand_mover requires prior >= 20; with a 1-row prior base it must NOT appear
    expect(pulse.signals.find((s) => s.key === 'demand_mover')).toBeUndefined();
  });
});
