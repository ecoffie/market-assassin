/**
 * DoD branch of searchSbir: live DSIP first; empty cache after a failed feed
 * is unavailable, never a genuine zero.
 *
 * Proven by injection: restoring "empty cache = not degraded" fails a test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dsipMock = vi.hoisted(() => ({
  searchDsipTopics: vi.fn(),
}));

const cacheState = vi.hoisted(() => ({
  data: [] as Array<Record<string, unknown>>,
  error: null as { message: string } | null,
}));

vi.mock('./dsip', () => ({
  searchDsipTopics: dsipMock.searchDsipTopics,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.order = self;
    q.limit = self;
    q.or = self;
    q.eq = self;
    q.ilike = self;
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve({ data: cacheState.data, error: cacheState.error }));
    return { from: () => q };
  },
}));

import { resolveDodSbirFromFeeds, searchSbir } from './search';

const LIVE_ROW = {
  id: 'dod-sbir:OSW26BZ06-NV028',
  title: 'OSW26BZ06-NV028 — 5G Signature Tracking Mitigation via Cyber Deception',
  agency: 'DOD / OSD',
  phase: 'SBIR',
  startDate: '2026-09-23',
  endDate: '2026-10-21',
  description: 'DoW SBIR 2026 BAA · closes 2026-10-21',
  source: 'DoD DSIP',
  url: 'https://www.dodsbirsttr.mil/topics-app/',
};

beforeEach(() => {
  dsipMock.searchDsipTopics.mockReset();
  cacheState.data = [];
  cacheState.error = null;
});

describe('resolveDodSbirFromFeeds', () => {
  it('passes a live hit through undegraded', () => {
    const r = resolveDodSbirFromFeeds(
      { rows: [LIVE_ROW], degraded: false },
      { rows: [], available: true },
    );
    expect(r.degraded).toBe(false);
    expect(r.rows).toEqual([LIVE_ROW]);
  });

  it('a genuine DSIP miss is empty and not degraded', () => {
    const r = resolveDodSbirFromFeeds(
      { rows: [], degraded: false },
      { rows: [], available: true },
    );
    expect(r.degraded).toBe(false);
    expect(r.rows).toEqual([]);
  });

  it('empty cache after DSIP failure is degraded, not a genuine zero', () => {
    const r = resolveDodSbirFromFeeds(
      { rows: [], degraded: true },
      { rows: [], available: true },
    );
    expect(r.degraded).toBe(true);
    expect(r.rows).toEqual([]);
  });

  it('stale cache rows ride along a failed feed, still degraded', () => {
    const cached = { ...LIVE_ROW, source: 'DoD SBIR' };
    const r = resolveDodSbirFromFeeds(
      { rows: [], degraded: true },
      { rows: [cached], available: true },
    );
    expect(r.degraded).toBe(true);
    expect(r.rows).toEqual([cached]);
  });

  it('empty cache after a failed feed must stay degraded (July 2026 cache-as-zero)', () => {
    // Old fetchDodSbir: successful select of 0 rows → { rows:[], degraded:false }.
    // Restoring that assignment makes this assertion fail.
    const r = resolveDodSbirFromFeeds(
      { rows: [], degraded: true },
      { rows: [], available: true },
    );
    expect(r.degraded).toBe(true);
    expect(r.rows).toEqual([]);
  });
});

describe('searchSbir source=dod', () => {
  it('returns a live DSIP hit', async () => {
    dsipMock.searchDsipTopics.mockResolvedValue({ rows: [LIVE_ROW], total: 1, degraded: false });
    const res = await searchSbir({ keyword: 'OSW26BZ06-NV028', source: 'dod', limit: 5 });
    expect(res.degraded).toBe(false);
    expect(res.opportunities).toHaveLength(1);
    expect(res.opportunities[0].id).toBe('dod-sbir:OSW26BZ06-NV028');
  });

  it('a genuine zero-result control is empty and not degraded', async () => {
    dsipMock.searchDsipTopics.mockResolvedValue({ rows: [], total: 0, degraded: false });
    const res = await searchSbir({ keyword: 'xyzzyplughqqqq9999', source: 'dod', limit: 5 });
    expect(res.degraded).toBe(false);
    expect(res.opportunities).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('degraded DSIP + empty cache stays degraded', async () => {
    dsipMock.searchDsipTopics.mockResolvedValue({ rows: [], total: null, degraded: true });
    const res = await searchSbir({ keyword: 'cyber', source: 'dod', limit: 5 });
    expect(res.degraded).toBe(true);
    expect(res.opportunities).toEqual([]);
  });

  it('degraded DSIP + cached rows returns the rows, still degraded', async () => {
    dsipMock.searchDsipTopics.mockResolvedValue({ rows: [], total: null, degraded: true });
    cacheState.data = [
      {
        topic_number: 'OSW26BZ06-NV028',
        title: '5G Signature Tracking Mitigation via Cyber Deception',
        agency: 'DOD',
        branch: 'OSD',
        program: 'SBIR',
        open_date: '2026-09-23',
        close_date: '2026-10-21',
        description: 'cached',
        url: 'https://www.dodsbirsttr.mil/topics-app/',
      },
    ];
    const res = await searchSbir({ keyword: 'OSW26BZ06-NV028', source: 'dod', limit: 5 });
    expect(res.degraded).toBe(true);
    expect(res.opportunities.length).toBeGreaterThan(0);
    expect(res.opportunities[0].title).toMatch(/OSW26BZ06-NV028/);
  });
});

describe('HTTP route wires source=dod through searchSbir', () => {
  it('does not skip DoD the way the NIH/multisite-only GET did', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/sbir/route.ts'), 'utf8');
    expect(src).toContain("import { searchSbir } from '@/lib/sbir/search'");
    expect(src).toContain("source === 'dod'");
    expect(src).toContain('searchSbir(');
    // The defect: GET fetched NIH + multisite only, so source=dod fell through to [].
    expect(src).not.toMatch(/if \(source === 'nih' \|\| source === 'all'\)/);
    expect(src).not.toMatch(/if \(source === 'multisite' \|\| source === 'all'\)/);
  });
});
