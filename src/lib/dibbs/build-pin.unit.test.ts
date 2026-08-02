import { describe, it, expect, vi, afterEach } from 'vitest';

const okRes = (items: unknown[]) => ({ ok: true, status: 200, json: async () => items }) as unknown as Response;

describe('DIBBS actor build pin', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); delete process.env.APIFY_DIBBS_BUILD; });

  it('pins the known-good build in the Apify request URL', async () => {
    process.env.APIFY_TOKEN = 'test-token';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRes([{ solicitationNumber: 'SPE-1' }]));
    const { fetchDibbsRfqs } = await import('./ingest');
    await fetchDibbsRfqs({ maxItems: 5, daysBack: 2 });
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain('build=1.0.40');
    // the broken vendor build must never be what we request by default
    expect(url).not.toContain('build=1.0.41');
  });

  it('honors APIFY_DIBBS_BUILD override so a newer build can be tested without a deploy', async () => {
    process.env.APIFY_TOKEN = 'test-token';
    process.env.APIFY_DIBBS_BUILD = '1.0.42';
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okRes([{ solicitationNumber: 'SPE-2' }]));
    const { fetchDibbsRfqs } = await import('./ingest');
    await fetchDibbsRfqs({ maxItems: 5 });
    expect(String(spy.mock.calls[0][0])).toContain('build=1.0.42');
  });
});
