import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for Vercel KV.
const mem = new Map<string, unknown>();
const sets = new Map<string, Set<string>>();
vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(async (k: string) => mem.get(k) ?? null),
    set: vi.fn(async (k: string, v: unknown) => { mem.set(k, JSON.parse(JSON.stringify(v))); return 'OK'; }),
    sadd: vi.fn(async (k: string, v: string) => { if (!sets.has(k)) sets.set(k, new Set()); sets.get(k)!.add(v); return 1; }),
    smembers: vi.fn(async (k: string) => [...(sets.get(k) ?? [])]),
    mget: vi.fn(async (...ks: string[]) => ks.map((k) => mem.get(k) ?? null)),
  },
}));

const store = await import('./store');
const app = (email: string) => ({
  name: 'Ann Lee', email, postUrl: 'https://linkedin.com/in/ann', company: 'Lee Federal LLC', uei: 'ABC123DEF456',
  lastEvent: 'Fort Bragg Industry Day', pursuit: 'Sources sought response to Army MICC janitorial', wantToFind: 'Who holds the current janitorial contract', attested: true as const,
});

beforeEach(() => { mem.clear(); sets.clear(); store.clearAmbassadorCache(); });

describe('ambassador store (KV)', () => {
  it('saves a pending application and lists it', async () => {
    await store.saveApplication(app('Ann@Example.com'));
    const rows = await store.listAmbassadors();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'ann@example.com', status: 'pending', uei: 'ABC123DEF456', post_url: 'https://linkedin.com/in/ann', last_event: 'Fort Bragg Industry Day' });
    expect(rows[0].attested_at).toBeTruthy();
    expect(await store.listAmbassadors('approved')).toHaveLength(0);
  });

  it('approval makes MCP calls free; removal turns it off', async () => {
    await store.saveApplication(app('ann@example.com'));
    expect(await store.isApprovedAmbassador('ann@example.com')).toBe(false);
    await store.setDecision('ann@example.com', 'approved', 'admin', null, 'abc123');
    expect(await store.isApprovedAmbassador('ANN@example.com')).toBe(true);
    expect((await store.getAmbassador('ann@example.com'))?.referral_code).toBe('abc123');
    await store.setDecision('ann@example.com', 'removed', 'admin', 'left');
    expect(await store.isApprovedAmbassador('ann@example.com')).toBe(false);
  });

  it('re-applying never downgrades an approved ambassador', async () => {
    await store.saveApplication(app('ann@example.com'));
    await store.setDecision('ann@example.com', 'approved', 'admin', null, 'abc123');
    expect(await store.saveApplication(app('ann@example.com'))).toEqual({ status: 'already_ambassador' });
    expect((await store.getAmbassador('ann@example.com'))?.status).toBe('approved');
  });

  it('a KV read failure bills normally (not an ambassador)', async () => {
    const { kv } = await import('@vercel/kv');
    vi.mocked(kv.get).mockRejectedValueOnce(new Error('quota'));
    expect(await store.isApprovedAmbassador('someone@example.com')).toBe(false);
  });

  it('still reads a row saved by the first-version form', async () => {
    mem.set('ambassador:app:old@example.com', { email: 'old@example.com', name: 'Old', company: null, role: 'Coach', linkedin_url: null, website_url: null, audience: '[500–2,000] Ohio', why: 'because', promote_plan: null, status: 'approved', referral_code: 'x', decided_at: null, decided_by: null, decision_note: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z' });
    sets.set('ambassador:index', new Set(['old@example.com']));
    expect(await store.listAmbassadors('approved')).toHaveLength(1);
    expect(await store.isApprovedAmbassador('old@example.com')).toBe(true);
  });

  it('builds the shared referral link to /pricing', () => {
    expect(store.ambassadorReferralLink('a b')).toBe('https://getmindy.ai/pricing?ref=a%20b');
  });
});
