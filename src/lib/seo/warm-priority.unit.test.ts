/** Prioritized contractor warming (2026-11-13): scoring + the bounded, checkpointed hourly drain. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  z: new Map<string, number>(), set: new Set<string>(), kv: new Map<string, unknown>(),
  profiles: new Map<string, { total_obligated: number; award_count: number }>(),
  failOn: new Set<string>(), warmed: [] as string[],
  /** /contracts page-1 state per rollup UEI: what a cache-only read sees, and what a live read returns. */
  pages: new Map<string, { cache: 'ok' | 'unavailable' | 'failed'; live: 'ok' | 'unavailable' | 'failed' }>(),
  pageReads: [] as Array<{ uei: string; live: boolean }>,
}));
vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(async (k: string) => m.kv.get(k) ?? null),
    set: vi.fn(async (k: string, v: unknown) => { m.kv.set(k, v); return 'OK'; }),
    incrby: vi.fn(async (k: string, n: number) => { const v = (Number(m.kv.get(k)) || 0) + n; m.kv.set(k, v); return v; }),
    expire: vi.fn(async () => 1),
    zpopmax: vi.fn(async (_k: string, n: number) => {
      const top = [...m.z.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
      top.forEach(([s]) => m.z.delete(s));
      return top.flatMap(([s, sc]) => [s, sc]);
    }),
    zadd: vi.fn(async (_k: string, ...items: Array<{ score: number; member: string }>) => { items.forEach((i) => m.z.set(i.member, i.score)); return items.length; }),
    zcard: vi.fn(async () => m.z.size),
    srem: vi.fn(async (_k: string, s: string) => m.set.delete(s)),
    spop: vi.fn(async () => []),
    sadd: vi.fn(async (_k: string, s: string) => m.set.add(s)),
    scard: vi.fn(async () => m.set.size),
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/bigquery/recipients', () => ({
  getTopRecipientsForSitemap: vi.fn(async () => [{ recipient_name: 'X', total_obligated: 1e9, award_count: 9 }]),
  getRollupOrSingleBySlug: vi.fn(async (slug: string) => {
    const p = m.profiles.get(slug);
    return p ? { ...p, child_ueis: [slug], rollup_uei: slug } : null;
  }),
  getYearlyTotalsForRecipient: vi.fn(async () => []),
  getYearlyByAgencyForRecipient: vi.fn(async () => []),
  getTopAgenciesForRecipient: vi.fn(async () => []),
  getTopNaicsForRecipient: vi.fn(async () => []),
  getRecentAwardsForRecipient: vi.fn(async (_u: string[], uei: string) => { m.warmed.push(uei); return []; }),
  getExecutivesForRecipient: vi.fn(async () => []),
  getPaginatedAwardsForRecipient: vi.fn(async (_u: string[], uei: string, _p: number, _s: number, liveBq = false) => {
    m.pageReads.push({ uei, live: liveBq });
    const p = m.pages.get(uei) ?? { cache: 'ok', live: 'ok' };
    const state = liveBq ? p.live : p.cache;
    return { rows: [], total: 0, available: state === 'ok', state };
  }),
  recipientSlug: (n: string) => n.toLowerCase(),
  seoCacheKeys: { recentAwards: (uei: string) => `recent:${uei}` },
}));
vi.mock('@/lib/bigquery/cache', () => ({
  bqResultState: (key: string) => (m.failOn.has(key.replace('recent:', '')) ? 'failed' : 'empty'),
}));

import { warmScore, WARM_PRIORITY_KEY, warmDailyKey, WARM_PRIORITY_DAILY_CAP } from './warm-priority';
import { GET } from '@/app/api/cron/warm-contractor-pages/route';

const req = (headers: Record<string, string> = { authorization: 'Bearer s3cret' }) =>
  new NextRequest('https://getmindy.ai/api/cron/warm-contractor-pages', { headers });

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret';
  m.z.clear(); m.set.clear(); m.kv.clear(); m.profiles.clear(); m.failOn.clear(); m.warmed = [];
  m.pages.clear(); m.pageReads = [];
  m.kv.set('cron:warm-contractor-pages:cursor', 0);
});

describe('warmScore', () => {
  it('orders search history above value above request count, and excludes thin contractors', () => {
    const clicked = warmScore({ gscClicks: 1, gscImpressions: 5, totalObligated: 50_000, awardCount: 3 })!;
    const impressed = warmScore({ gscImpressions: 12, totalObligated: 50_000, awardCount: 3 })!;
    const big = warmScore({ totalObligated: 5e8, awardCount: 40 })!;
    const small = warmScore({ totalObligated: 60_000, awardCount: 3, requests: 5 })!;
    expect(clicked).toBeGreaterThan(impressed);
    expect(impressed).toBeGreaterThan(big);
    expect(big).toBeGreaterThan(small);
    expect(warmScore({ totalObligated: 10_000, awardCount: 1, gscClicks: 3 })).toBeNull();
  });
});

describe('hourly priority drain', () => {
  it('rejects the spoofable x-vercel-cron header', async () => {
    expect((await GET(req({ 'x-vercel-cron': '1' }))).status).toBe(401);
  });

  it('warms highest score first, skips thin sections, and checkpoints by removal', async () => {
    m.profiles.set('hi', { total_obligated: 5e8, award_count: 30 });
    m.profiles.set('lo', { total_obligated: 2e6, award_count: 5 });
    m.profiles.set('thin', { total_obligated: 9_000, award_count: 1 });
    m.z.set('lo', 600); m.z.set('hi', 1_010_000); m.z.set('thin', 700);
    m.set.add('hi'); m.set.add('lo'); m.set.add('thin');
    const body = await (await GET(req())).json();
    expect(m.warmed.slice(0, 2)).toEqual(['hi', 'lo']); // priority order; thin never section-warmed
    expect(body.priority).toMatchObject({ drained: 3, warmed: 2, thin: 1, stoppedBy: null, depthAfter: 0 });
    expect(m.set.size).toBe(0);
    expect(m.kv.get(warmDailyKey())).toBe(2);
  });

  it('stops at the first BigQuery failure and puts the rest back at their scores', async () => {
    for (const [s, sc] of [['a', 900], ['b', 800], ['c', 700]] as const) { m.profiles.set(s, { total_obligated: 5e6, award_count: 9 }); m.z.set(s, sc); }
    m.failOn.add('b');
    const body = await (await GET(req())).json();
    expect(body.priority.stoppedBy).toMatch(/BigQuery failure at b/);
    expect([...m.z.entries()].sort()).toEqual([['b', 800], ['c', 700]]);
  });

  it('respects the daily cap', async () => {
    m.kv.set(warmDailyKey(), WARM_PRIORITY_DAILY_CAP);
    m.z.set('a', 900); m.profiles.set('a', { total_obligated: 5e6, award_count: 9 });
    const body = await (await GET(req())).json();
    expect(body.priority.stoppedBy).toBe('daily cap reached');
    expect(m.z.get('a')).toBe(900);
  });
});

it('the priority key is namespaced apart from the legacy set', () => {
  expect(WARM_PRIORITY_KEY).not.toBe('seo:warm:queue:contractor-slugs');
});

/**
 * /contracts page 1 (2026-11-14): 77 contract pages answered 5xx in the Search Console re-run
 * because only the profile sections were warmed. The warmer now fills page 1 too.
 */
describe('/contracts page 1 in the warm drain', () => {
  const contractor = (s: string, score: number, award_count = 9) => {
    m.profiles.set(s, { total_obligated: 5e6, award_count });
    m.z.set(s, score);
  };

  it('cold contract page ⇒ warmed by one live read after the cache-only miss', async () => {
    contractor('cold', 900);
    m.pages.set('cold', { cache: 'unavailable', live: 'ok' });
    const body = await (await GET(req())).json();
    expect(m.pageReads).toEqual([{ uei: 'cold', live: false }, { uei: 'cold', live: true }]);
    expect(body.priority).toMatchObject({ warmed: 1, stoppedBy: null });
    expect(body.contractsPage1).toMatchObject({ warmed: 1, failed: 0 });
  });

  it('cache reuse: page already served ⇒ no live read; profile + page warmed together read page 1 once', async () => {
    contractor('warm', 900);
    m.pages.set('warm', { cache: 'ok', live: 'ok' });
    const body = await (await GET(req())).json();
    expect(m.pageReads.filter((r) => r.uei === 'warm')).toEqual([{ uei: 'warm', live: false }]);
    expect(body.contractsPage1).toMatchObject({ cached: 1, warmed: 0 });
  });

  it('failed page warm ⇒ contractor stays queued at its score, drain stops, daily count not charged', async () => {
    contractor('a', 900); contractor('b', 800); contractor('c', 700);
    m.pages.set('b', { cache: 'unavailable', live: 'failed' });
    const body = await (await GET(req())).json();
    expect(body.priority.stoppedBy).toMatch(/BigQuery failure at b/);
    expect([...m.z.entries()].sort()).toEqual([['b', 800], ['c', 700]]);
    expect(m.kv.get(warmDailyKey())).toBe(1); // only 'a'
    expect(m.pageReads.some((r) => r.uei === 'c')).toBe(false);
  });

  it('BigQuery budget exhausted (live read unanswered) ⇒ treated as a failed warm, not a success', async () => {
    contractor('q', 900);
    m.pages.set('q', { cache: 'unavailable', live: 'unavailable' });
    const body = await (await GET(req())).json();
    expect(body.priority.stoppedBy).toMatch(/BigQuery failure at q/);
    expect(m.z.get('q')).toBe(900);
    expect(body.contractsPage1).toMatchObject({ failed: 1 });
  });

  it('daily warm cap reached ⇒ no contract page is read', async () => {
    m.kv.set(warmDailyKey(), WARM_PRIORITY_DAILY_CAP);
    contractor('a', 900);
    m.pages.set('a', { cache: 'unavailable', live: 'ok' });
    await GET(req());
    expect(m.pageReads.some((r) => r.uei === 'a')).toBe(false);
  });

  it('contractor with no awards ⇒ its contract page is never read', async () => {
    // Queue drains stop at the thin gate first; warmContractsPage1 also refuses award_count 0
    // (contracts-page-warm.unit.test.ts), so no path reads an empty contractor's page.
    contractor('none', 900, 0);
    const body = await (await GET(req())).json();
    expect(body.priority.thin).toBe(1);
    expect(m.pageReads.some((r) => r.uei === 'none')).toBe(false);
  });
});

