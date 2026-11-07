import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * DIBBS is FAIL-CLOSED (2026-11-02).
 *
 * The old "cost guard" routed large pulls to the free direct fetcher and, when that
 * path failed, re-ran the same 2,500-item request on the pay-per-item Apify actor
 * ("cost control must never become data loss"). From Vercel the DLA WAF blocks the
 * direct path on every run, so the actor billed $12-$36/day and hit the monthly cap
 * four cycles running ($500.00, $321.96, $415.81, $299.99). These pin the replacement:
 * a free-source failure STOPS the run; spending requires an explicit allowApify.
 */

const sb = { from: () => ({ upsert: async () => ({ error: null }) }) } as never;
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ solicitationNumber: `SPE-${i}` }));

vi.mock('./direct', () => ({ fetchDibbsDirect: vi.fn() }));

describe('DIBBS fail-closed spend policy', () => {
  beforeEach(() => { vi.resetModules(); process.env.APIFY_TOKEN = 't'; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('THE INCIDENT: direct blocked by the WAF → the actor is NOT called, nothing is spent', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockRejectedValue(new Error('WAF blocked all 2 index file(s)'));
    const apify = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => rows(2500) } as never);
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 2500, daysBack: 2 });
    expect(apify).not.toHaveBeenCalled();
    expect(r.fetched).toBe(0);
    expect(r.source).toBeNull();
    expect(r.estimatedCostUsd).toBe(0);
    expect(r.costGuard).toMatch(/fail-closed/);
    expect(r.attempts.map((a) => `${a.path}:${a.outcome}`)).toEqual(['direct:threw', 'apify:skipped']);
  });

  it('direct returning EMPTY also stops — empty is not a licence to spend', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockResolvedValue([] as never);
    const apify = vi.spyOn(globalThis, 'fetch');
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 2500, daysBack: 2 });
    expect(apify).not.toHaveBeenCalled();
    expect(r.attempts.map((a) => `${a.path}:${a.outcome}`)).toEqual(['direct:empty', 'apify:skipped']);
  });

  it('SMALL requests no longer go to the actor first (the old <800-item primary path is gone)', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockResolvedValue(rows(300) as never);
    const apify = vi.spyOn(globalThis, 'fetch');
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 500, daysBack: 2 });
    expect(r.source).toBe('direct');
    expect(apify).not.toHaveBeenCalled();
  });

  it('forceApify WITHOUT allowApify is ignored — it cannot spend on its own', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockResolvedValue([] as never);
    const apify = vi.spyOn(globalThis, 'fetch');
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 2500, forceApify: true });
    expect(apify).not.toHaveBeenCalled();
    expect(fetchDibbsDirect).toHaveBeenCalled();
    expect(r.estimatedCostUsd).toBe(0);
  });

  it('an EXPLICIT allowApify still reaches the actor, and its cost uses the measured rate', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockResolvedValue([] as never);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => rows(228) } as never);
    const { ingestDibbs, APIFY_USD_PER_ITEM } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 500, daysBack: 3, allowApify: true });
    expect(r.source).toBe('apify');
    // 228 items actually billed $3.27 on 2026-08-02
    expect(r.estimatedCostUsd).toBeCloseTo(228 * APIFY_USD_PER_ITEM, 2);
    expect(r.estimatedCostUsd).toBeCloseTo(3.27, 1);
  });

  it('forceApify + allowApify skips the free path for a deliberate operator pull', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => rows(10) } as never);
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 10, forceApify: true, allowApify: true });
    expect(r.source).toBe('apify');
    expect(fetchDibbsDirect).not.toHaveBeenCalled();
  });
});
