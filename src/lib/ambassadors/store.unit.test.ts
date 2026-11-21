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
    incrby: vi.fn(async (k: string, n: number) => { const v = Number(mem.get(k) ?? 0) + n; mem.set(k, v); return v; }),
    expire: vi.fn(async () => 1),
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
    await store.setDecision('ann@example.com', 'approved', 'admin', null);
    expect(await store.isApprovedAmbassador('ANN@example.com')).toBe(true);
    expect((await store.getAmbassador('ann@example.com'))?.referral_code).toBeNull();
    await store.setDecision('ann@example.com', 'removed', 'admin', 'left');
    expect(await store.isApprovedAmbassador('ann@example.com')).toBe(false);
  });

  it('re-applying never downgrades an approved ambassador', async () => {
    await store.saveApplication(app('ann@example.com'));
    await store.setDecision('ann@example.com', 'approved', 'admin', null);
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

  it('an ended term stops the free calls', async () => {
    await store.saveApplication(app('ann@example.com'));
    await store.setDecision('ann@example.com', 'approved', 'admin', null);
    await store.setDecision('ann@example.com', 'ended', 'job', 'Twelve-month term ended');
    expect(await store.isApprovedAmbassador('ann@example.com')).toBe(false);
  });
});

describe('monthly cap (5,000 credits)', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const approve = async () => {
    await store.saveApplication(app('ann@example.com'));
    await store.setDecision('ann@example.com', 'approved', 'admin', null);
  };

  it('defaults to 5,000', () => {
    expect(store.AMBASSADOR_MONTHLY_CREDIT_CAP).toBe(5000);
  });

  it('covers calls until the next one would pass the cap, then bills', async () => {
    await approve();
    await store.recordAmbassadorUsage('ann@example.com', 4950, now);
    expect(await store.ambassadorCoversCall('ann@example.com', 50, now)).toBe(true);   // lands exactly on 5,000
    await store.recordAmbassadorUsage('ann@example.com', 50, now);
    expect(await store.ambassadorMonthUsage('ann@example.com', now)).toBe(5000);
    expect(await store.ambassadorCoversCall('ann@example.com', 1, now)).toBe(false);
  });

  it('starts fresh each UTC month', async () => {
    await approve();
    await store.recordAmbassadorUsage('ann@example.com', 5000, now);
    expect(await store.ambassadorCoversCall('ann@example.com', 10, new Date('2026-12-01T00:00:01Z'))).toBe(true);
  });

  it('never covers someone who is not approved', async () => {
    await store.saveApplication(app('ann@example.com'));
    expect(await store.ambassadorCoversCall('ann@example.com', 10, now)).toBe(false);
  });

  it('a usage read error bills normally', async () => {
    await approve();
    await store.isApprovedAmbassador('ann@example.com'); // warm the approval cache
    const { kv } = await import('@vercel/kv');
    vi.mocked(kv.get).mockRejectedValueOnce(new Error('quota'));
    expect(await store.ambassadorCoversCall('ann@example.com', 10, now)).toBe(false);
  });
});

describe('twelve-month term', () => {
  const start = '2026-01-01T00:00:00Z';
  const at = (days: number) => new Date(Date.parse(start) + days * 86_400_000);

  it('nothing due before day 335', () => {
    expect(store.termStatus(start, at(334))?.due).toBe('none');
  });
  it('notice from day 335', () => {
    expect(store.termStatus(start, at(335))?.due).toBe('notice');
    expect(store.termStatus(start, at(364))?.due).toBe('notice');
  });
  it('ends at day 365, on the anniversary', () => {
    const t = store.termStatus(start, at(365));
    expect(t?.due).toBe('end');
    expect(t?.endsAt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it('no approval date means no term', () => {
    expect(store.termStatus(null)).toBeNull();
  });
  it('re-approval clears the old term notice', async () => {
    await store.saveApplication(app('ann@example.com'));
    await store.setDecision('ann@example.com', 'approved', 'admin', null);
    await store.markTermNoticeSent('ann@example.com');
    expect((await store.getAmbassador('ann@example.com'))?.term_notice_sent_at).toBeTruthy();
    await store.setDecision('ann@example.com', 'ended', 'job', null);
    await store.setDecision('ann@example.com', 'approved', 'admin', null);
    expect((await store.getAmbassador('ann@example.com'))?.term_notice_sent_at).toBeNull();
  });
});
