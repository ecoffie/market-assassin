/** Prioritized contractor warming (2026-11-13): scoring + the bounded, checkpointed hourly drain. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  z: new Map<string, number>(), set: new Set<string>(), kv: new Map<string, unknown>(),
  profiles: new Map<string, { total_obligated: number; award_count: number }>(),
  failOn: new Set<string>(), warmed: [] as string[],
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
