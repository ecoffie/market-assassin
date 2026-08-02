import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sb = { from: () => ({ upsert: async () => ({ error: null }) }) } as never;
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ solicitationNumber: `SPE-${i}` }));

vi.mock('./direct', () => ({ fetchDibbsDirect: vi.fn() }));

describe('DIBBS cost guard', () => {
  beforeEach(() => { vi.resetModules(); process.env.APIFY_TOKEN = 't'; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.DIBBS_DISABLE_DIRECT_FALLBACK; });

  it('routes a LARGE request to the free direct path, never billing Apify', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockResolvedValue(rows(2500) as never);
    const apify = vi.spyOn(globalThis, 'fetch');
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 2500, daysBack: 4 });
    expect(r.source).toBe('direct');
    expect(r.estimatedCostUsd).toBe(0);          // free path => no spend
    expect(r.costGuard).toContain('exceeds');
    expect(apify).not.toHaveBeenCalled();        // Apify never touched
  });

  it('leaves the cheap daily delta on Apify (guard must not disrupt the cron)', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => rows(300) } as never);
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 500, daysBack: 2 });
    expect(r.source).toBe('apify');
    expect(r.costGuard).toBeUndefined();
    expect(fetchDibbsDirect).not.toHaveBeenCalled();
  });

  it('estimates cost from the MEASURED per-item rate', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => rows(228) } as never);
    const { ingestDibbs, APIFY_USD_PER_ITEM } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 500, daysBack: 3 });
    // 228 items actually billed $3.27 on 2026-08-02
    expect(r.estimatedCostUsd).toBeCloseTo(228 * APIFY_USD_PER_ITEM, 2);
    expect(r.estimatedCostUsd).toBeCloseTo(3.27, 1);
  });

  it('forceApify=true bypasses the guard for a deliberate large pull', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => rows(2500) } as never);
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 2500, forceApify: true });
    expect(r.source).toBe('apify');
    expect(fetchDibbsDirect).not.toHaveBeenCalled();
    expect(r.estimatedCostUsd).toBeGreaterThan(30);
  });

  it('COST CONTROL MUST NOT CAUSE DATA LOSS: direct failure falls through to Apify', async () => {
    const { fetchDibbsDirect } = await import('./direct');
    vi.mocked(fetchDibbsDirect).mockRejectedValue(new Error('WAF blocked'));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => rows(2500) } as never);
    const { ingestDibbs } = await import('./ingest');
    const r = await ingestDibbs(sb, { maxItems: 2500, daysBack: 4 });
    expect(r.source).toBe('apify');               // data still arrives
    expect(r.fetched).toBe(2500);
    expect(r.costGuard).toContain('direct failed');
  });
});
