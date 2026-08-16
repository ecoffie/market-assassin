import { describe, it, expect, vi, beforeEach } from 'vitest';

const kvGet = vi.fn();
const kvSet = vi.fn();
vi.mock('@vercel/kv', () => ({ kv: { get: (...a: unknown[]) => kvGet(...a), set: (...a: unknown[]) => kvSet(...a) } }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

async function fresh() {
  vi.resetModules();
  return import('./psc-catalog-live');
}

beforeEach(() => { kvGet.mockReset(); kvSet.mockReset(); fetchMock.mockReset(); });

describe('shared PSC catalog — one source for recommender and validator', () => {
  it('serves the KV catalog UNIONED with the shipped floor', async () => {
    kvGet.mockResolvedValue({ codes: { ZZ99: 'A CODE ONLY THE LIVE TREE KNOWS' }, fetchedAt: 'x' });
    const { getPscCatalog } = await fresh();
    const c = await getPscCatalog();
    expect(c.source).toBe('kv');
    expect(c.codes.ZZ99).toBeTruthy();       // from live
    expect(c.codes.D314).toBeTruthy();       // from the shipped floor
  });

  /**
   * THE INVERSE FAILURE. A customer's saved code must never become "unknown"
   * because a refresh returned a catalog that happens to omit it. Union, not
   * replace — a refresh can only ADD knowledge.
   */
  it('a live refresh can never revoke a code the shipped floor knows', async () => {
    kvGet.mockResolvedValue({ codes: { AAAA1: 'only this' }, fetchedAt: 'x' });
    const { getPscCatalog } = await fresh();
    const c = await getPscCatalog();
    expect(c.codes.D314).toBeTruthy();  // still there despite a thin live payload
    expect(c.codes.R425).toBeTruthy();
  });

  it('falls back to the shipped floor when KV is down — never throws at a validator', async () => {
    kvGet.mockRejectedValue(new Error('kv unreachable'));
    const { getPscCatalog } = await fresh();
    const c = await getPscCatalog();
    expect(c.source).toBe('shipped');
    expect(Object.keys(c.codes).length).toBeGreaterThan(2000);
  });

  it('fetches live and caches it when KV is cold', async () => {
    kvGet.mockResolvedValue(null);
    // 4-char ids are what walk() collects as leaves. 1600 unique ones clears
    // the >=1500 sanity floor.
    const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const many: Record<string, string> = {};
    for (let i = 0; many && Object.keys(many).length < 1600; i++) {
      const id = `${L[i % 26]}${String(i % 1000).padStart(3, '0')}`;
      many[id + ''] = `T${i}`;
      if (i > 50000) break;
    }
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/psc/')
        ? Promise.resolve({ ok: true, json: async () => ({ results: [{ id: 'Service' }] }) })
        : Promise.resolve({ ok: true, json: async () => ({ results: Object.entries(many).map(([id, description]) => ({ id, description })) }) }));
    const { getPscCatalog } = await fresh();
    const c = await getPscCatalog();
    expect(c.source).toBe('live');
    expect(kvSet).toHaveBeenCalled();
  });

  it('REJECTS a truncated live response rather than caching a worse catalog', async () => {
    // A partial upstream read must not overwrite good data — that would
    // manufacture the exact "unknown code" bug from the other direction.
    kvGet.mockResolvedValue(null);
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('/psc/')
        ? Promise.resolve({ ok: true, json: async () => ({ results: [{ id: 'Service' }] }) })
        : Promise.resolve({ ok: true, json: async () => ({ results: [{ id: 'D314', description: 'ONE CODE' }] }) }));
    const { getPscCatalog } = await fresh();
    const c = await getPscCatalog();
    expect(c.source).toBe('shipped');
    expect(kvSet).not.toHaveBeenCalled();
  });

  it('refreshPscCatalog reports failure instead of caching junk', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const { refreshPscCatalog } = await fresh();
    const r = await refreshPscCatalog();
    expect(r.ok).toBe(false);
    expect(kvSet).not.toHaveBeenCalled();
  });
});
