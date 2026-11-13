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
const app = (email: string) => ({ name: 'Ann Lee', email, company: '', role: 'Coach', audienceSize: '500–2,000', audience: 'contractors in Ohio', why: 'I teach this every week', promotePlan: 'workshops and LinkedIn' });

beforeEach(() => { mem.clear(); sets.clear(); store.clearAmbassadorCache(); });

describe('ambassador store (KV)', () => {
  it('saves a pending application and lists it', async () => {
    await store.saveApplication(app('Ann@Example.com'));
    const rows = await store.listAmbassadors();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'ann@example.com', status: 'pending', audience: '[500–2,000] contractors in Ohio' });
    expect(await store.listAmbassadors('approved')).toHaveLength(0);
  });

  it('approval turns on unlimited use; removal turns it off', async () => {
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

  it('builds the shared referral link to /pricing', () => {
    expect(store.ambassadorReferralLink('a b')).toBe('https://getmindy.ai/pricing?ref=a%20b');
  });
});
