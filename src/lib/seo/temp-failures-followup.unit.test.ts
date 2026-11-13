/**
 * Follow-up to SEO recovery Phases 1-2 (2026-11-12): award pages, the /awards landing and
 * /forecasts must never answer a TEMPORARY data gap with a 200 noindex or an empty 200, and the
 * award lookup must spend one budget unit per request, not two.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const m = vi.hoisted(() => ({
  queryCached: vi.fn(),
  unavailable: vi.fn(),
  allowCold: vi.fn(),
  kvSet: vi.fn(),
}));
vi.mock('@/lib/bigquery/cache', async (orig) => ({
  ...(await orig<typeof import('@/lib/bigquery/cache')>()),
  queryCached: m.queryCached,
  bqUnavailable: m.unavailable,
}));
vi.mock('@/lib/seo/award-cold-budget', () => ({ allowAwardColdLookup: m.allowCold }));
vi.mock('@/lib/seo/live-bq', () => ({ seoLiveBqEnabled: () => false }));
vi.mock('@vercel/kv', () => ({ kv: { set: m.kvSet, get: vi.fn() } }));

import { getAwardLookup } from '@/lib/bigquery/awards';
import { buildForecastSummary } from './forecast-summary-builder';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (p: string) => read(p).replace(/^\s*(\/\/|\*).*$/gm, '');

beforeEach(() => {
  m.queryCached.mockReset();
  m.unavailable.mockReset();
  m.allowCold.mockReset();
});

describe('award lookup: one budget unit per request (metadata + body share it)', () => {
  it('concurrent lookups for the same award run once and take one unit', async () => {
    // cache-only read: cold (unknown). live read: hit.
    m.queryCached.mockImplementation(async (o: { cacheOnly: boolean }) => (o.cacheOnly ? [] : [{ award_id: 'CONT_AWD_A1' }]));
    m.unavailable.mockReturnValue(true);
    m.allowCold.mockResolvedValue(true);
    const [a, b] = await Promise.all([getAwardLookup('CONT_AWD_A1'), getAwardLookup('CONT_AWD_A1')]);
    expect(a).toEqual({ state: 'hit', award: { award_id: 'CONT_AWD_A1' } });
    expect(b).toBe(a);
    expect(m.allowCold).toHaveBeenCalledTimes(1);
  });

  it('budget spent → unavailable (the page throws a 5xx), never "missing"', async () => {
    m.queryCached.mockResolvedValue([]);
    m.unavailable.mockReturnValue(true);
    m.allowCold.mockResolvedValue(false);
    expect(await getAwardLookup('CONT_AWD_B2')).toEqual({ state: 'unavailable', award: null });
  });

  it('OG-image lookups (allowCold:false) are a separate entry and never take budget', async () => {
    m.queryCached.mockResolvedValue([]);
    m.unavailable.mockReturnValue(true);
    expect((await getAwardLookup('CONT_AWD_C3', false)).state).toBe('unavailable');
    expect(m.allowCold).not.toHaveBeenCalled();
  });
});

describe('no temporary state renders as a 200 noindex or an empty 200', () => {
  it('/awards/[id]: unavailable throws; no noindex; placeholder removed', () => {
    const src = code('src/app/awards/[id]/page.tsx');
    expect(src).toMatch(/lookup\.state === 'unavailable'\) \{\s*throw new SeoTemporarilyUnavailableError/);
    expect(src).not.toMatch(/unavailable'\)[^\n]*index: false/);
    expect(src).not.toContain('AwardTemporarilyUnavailable');
  });
  it('/forecasts: an unavailable summary throws instead of noindexing', () => {
    const src = code('src/app/forecasts/page.tsx');
    expect(src).toMatch(/if \(!s\.available\) \{\s*throw new SeoTemporarilyUnavailableError/);
    expect(src).not.toMatch(/robots:\s*s\.available/);
    // Prerendering + throwing would fail every `next build` while the summary is absent.
    expect(src).toContain("export const dynamic = 'force-dynamic'");
    expect(src).not.toMatch(/export const revalidate/);
  });
  it('/awards landing: both lists unknown throws instead of rendering empty tables', () => {
    const src = code('src/app/awards/page.tsx');
    expect(src).toContain("bqUnavailable(awardListKey('latest', 50), latest.length)");
    expect(src).toContain("throw new SeoTemporarilyUnavailableError('awards landing");
  });
  it('the 10-17 GB award-list scans are reachable live only from the materializer', () => {
    for (const f of ['src/app/awards/page.tsx', 'src/app/awards/[id]/page.tsx']) {
      expect(code(f), f).not.toMatch(/liveBq:\s*true/);
    }
    expect(code('src/app/api/cron/seo-materialize/route.ts')).toContain('liveBq: true, forceRefresh: true');
  });
});

describe('forecast summary builder', () => {
  function fakeDb(total: number, pages: Array<{ data: unknown[] | null; error: { message: string } | null }>) {
    const calls: string[] = [];
    const db = {
      from: () => ({
        select: (_c: string, opts?: { head?: boolean }) => {
          if (opts?.head) return Promise.resolve({ count: total, error: null });
          const q = {
            order: (col: string) => { calls.push(`order:${col}`); return q; },
            range: () => Promise.resolve(pages.shift() ?? { data: [], error: null }),
          };
          return q;
        },
      }),
    };
    return { db: db as never, calls };
  }
  const row = (agency: string) => ({ source_agency: agency, bureau: null, naics_code: '541512', naics_description: 'CSD', fiscal_year: '2027', set_aside_type: null, source_type: 'agency', last_synced_at: '2026-11-01T00:00:00Z' });

  it('pages in a STABLE order (by id) and builds an untruncated summary when every row is read', async () => {
    const { db, calls } = fakeDb(3, [{ data: [row('DOD'), row('DOD'), row('VA')], error: null }]);
    const s = await buildForecastSummary(db);
    expect(s.truncated).toBe(false);
    expect(s.total).toBe(3);
    expect(s.agencies[0]).toEqual({ key: 'DOD', label: 'DOD', count: 2 });
    expect(calls).toEqual(['order:id']);
  });

  it('marks truncated when rows read ≠ the authoritative count or a page errors', async () => {
    expect((await buildForecastSummary(fakeDb(5, [{ data: [row('DOD')], error: null }]).db)).truncated).toBe(true);
    expect((await buildForecastSummary(fakeDb(5, [{ data: null, error: { message: 'timeout' } }]).db)).truncated).toBe(true);
  });
});
