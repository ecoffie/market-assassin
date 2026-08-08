import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression: the DIBBS response lied about which path executed (2026-08-08).
 *
 * `source` was initialized to 'apify' and only reassigned when a path RETURNED
 * ROWS. So when the cost guard routed to the direct fetcher and direct returned
 * 0, `source` stayed 'apify' — naming a vendor call that never happened.
 *
 * A live investigation burned hours on "the Apify actor is degraded / WAF-blocked"
 * against a run whose own response said `source:"apify"` while `costGuard` said it
 * had used the free direct fetcher instead. These pin the fix so the execution
 * path can never silently misreport again.
 *
 * `fetchDibbsRfqs` lives inside ingest.ts (not a separate module), so the Apify
 * leg is driven by stubbing global fetch — the same approach cost-guard.unit.test
 * uses.
 */

const sb = { from: () => ({ upsert: async () => ({ error: null }) }) } as never;

vi.mock('./direct', () => ({ fetchDibbsDirect: vi.fn() }));

/**
 * fetchDibbsRfqs POSTs once to `run-sync-get-dataset-items`, which returns the
 * dataset items array directly (no separate run→dataset handshake).
 */
function stubApify(items: unknown[]) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(items), { status: 200 }) as never);
}

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ solicitationNumber: `SPE1C126Q${1000 + i}` }));

beforeEach(() => {
  vi.resetModules();
  process.env.APIFY_TOKEN = 't';
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DIBBS_DISABLE_DIRECT_FALLBACK;
});

describe('execution truth — the path actually taken', () => {
  it('THE BUG: cost guard routes to direct, direct returns 0 → source must NOT claim apify', async () => {
    // The exact 2026-08-08 shape: over the guard threshold, direct reachable but
    // empty, apify also empty. The old code returned source:'apify' — a path that
    // in the guard case had never been the one selected.
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockResolvedValue([] as never);
    stubApify([]);

    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 2500, daysBack: 2 });

    expect(r.fetched).toBe(0);
    expect(r.source).toBeNull(); // was 'apify' — the lie

    // THREE attempts, because the code correctly re-tries direct after Apify
    // also came back empty (cost control must not become data loss). The old
    // single `source` field collapsed all of this into the word "apify".
    expect(r.attempts.map((a) => `${a.path}:${a.outcome}`)).toEqual([
      'direct:empty', // cost guard routed here first
      'apify:empty', // direct produced nothing → try the vendor
      'direct:empty', // vendor produced nothing → final fallback
    ]);
    expect(r.attempts.every((a) => a.records === 0)).toBe(true);
    expect(r.costGuard).toContain('exceeds');
  });

  it('names direct as the producer when the cost-guard path succeeds', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockResolvedValue(rows(228) as never);
    const f = vi.spyOn(globalThis, 'fetch');

    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 2500, daysBack: 2 });

    expect(r.source).toBe('direct');
    expect(r.fetched).toBe(228);
    expect(f).not.toHaveBeenCalled(); // the guard exists to avoid the spend
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]).toMatchObject({ path: 'direct', outcome: 'rows', records: 228 });
  });

  it('forceApify bypasses the guard and reports apify honestly', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    stubApify(rows(800));

    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 800, forceApify: true });

    expect(r.source).toBe('apify');
    expect(vi.mocked(fetchDibbsDirect)).not.toHaveBeenCalled();
    expect(r.attempts[0]).toMatchObject({ path: 'apify', outcome: 'rows' });
    expect(r.costGuard).toBeUndefined();
  });

  it('records a THROWN path instead of swallowing it', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockRejectedValue(
      new Error('Could not reach DIBBS — proxy/upstream unreachable') as never,
    );
    stubApify(rows(5));

    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 2500 });

    const threw = r.attempts.find((a) => a.outcome === 'threw');
    expect(threw?.path).toBe('direct');
    expect(threw?.error).toContain('unreachable');
    // Cost control must never become data loss.
    expect(r.source).toBe('apify');
    expect(r.fetched).toBe(5);
  });

  it('orders attempts and records WHY each ran', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockResolvedValue([] as never);
    stubApify(rows(12));

    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 2500 });

    expect(r.attempts[0].reason).toMatch(/cost guard/i);
    expect(r.attempts[1].reason).toMatch(/direct produced nothing/i);
    expect(r.source).toBe('apify');
  });
});

describe('commercial truth — cost follows the ATTEMPT, not the winner', () => {
  it('does not bill for apify when apify emitted nothing', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockResolvedValue(rows(100) as never);

    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 2500 });

    expect(r.source).toBe('direct');
    expect(r.estimatedCostUsd).toBe(0);
  });

  it('charges for a real apify run', async () => {
    stubApify(rows(800));
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 800, forceApify: true });

    // PAY_PER_EVENT — 800 emitted items must be visible BEFORE the invoice.
    expect(r.estimatedCostUsd).toBeGreaterThan(0);
  });
});
