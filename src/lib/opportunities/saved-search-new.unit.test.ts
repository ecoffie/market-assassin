import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  uniqueNoticeIds,
  isSearchBaselined,
  unseenUniqueNoticeIds,
  unseenUniqueCount,
  mergeSeenIds,
  SAVED_SEARCH_MATCH_CAP,
  SAVED_SEARCH_SEEN_CAP,
} from './saved-search-new';

describe('uniqueNoticeIds', () => {
  it('drops blanks and duplicates, keeps first-seen order', () => {
    expect(uniqueNoticeIds(['a', 'b', 'a', '', null, 'c', undefined, 'b'])).toEqual(['a', 'b', 'c']);
  });
});

describe('isSearchBaselined', () => {
  it('empty last_seen and no last_alerted_at = just-saved / never opened', () => {
    expect(isSearchBaselined([])).toBe(false);
    expect(isSearchBaselined(null)).toBe(false);
    expect(isSearchBaselined(undefined)).toBe(false);
  });
  it('non-empty last_seen is baselined (current matches were stamped)', () => {
    expect(isSearchBaselined(['n1'])).toBe(true);
  });
  it('empty last_seen + last_alerted_at is baselined (saved with 0 matches)', () => {
    expect(isSearchBaselined([], '2026-08-13T08:00:00.000Z')).toBe(true);
  });
});

describe('unseenUniqueNoticeIds — unique, not a cap-delta; 0 when just saved', () => {
  const matches = ['a', 'b', 'c', 'a', 'd'];

  it('just saved / never baselined → 0 new (current matches are the baseline, not "new")', () => {
    expect(unseenUniqueCount(matches, [])).toBe(0);
    expect(unseenUniqueCount(matches, null)).toBe(0);
    expect(unseenUniqueNoticeIds(matches, [])).toEqual([]);
  });

  it('duplicate notice_ids in the match list count once', () => {
    expect(unseenUniqueCount(['x', 'x', 'x', 'y'], ['z'])).toBe(2);
    expect(unseenUniqueNoticeIds(['x', 'x', 'y'], ['z'])).toEqual(['x', 'y']);
  });

  it('only ids not in last_seen count, and the count is not 300−200', () => {
    // The Watchlist "100 new" was MATCH_CAP 300 minus mark_seen 200 — a set number,
    // not unique new opps. When the same 300 were stamped as seen, new = 0.
    const threeHundred = Array.from({ length: 300 }, (_, i) => `n${i}`);
    const twoHundred = threeHundred.slice(0, 200);
    expect(unseenUniqueCount(threeHundred, twoHundred)).toBe(100); // honest remainder
    expect(unseenUniqueCount(threeHundred, threeHundred)).toBe(0);  // just saved / just viewed
    expect(unseenUniqueCount(threeHundred, [])).toBe(0);            // never baselined
  });

  it('saved with 0 matches (last_alerted_at set, last_seen empty) → later matches ARE new', () => {
    expect(unseenUniqueCount(['a', 'b'], [], { lastAlertedAt: '2026-08-13T08:00:00.000Z' })).toBe(2);
  });

  it('KPI across searches is a unique Set, not a sum (same notice in two searches = 1)', () => {
    const a = unseenUniqueNoticeIds(['n1', 'n2'], ['old']);
    const b = unseenUniqueNoticeIds(['n2', 'n3'], ['old']);
    const kpi = new Set([...a, ...b]);
    expect(a.length + b.length).toBe(4); // naive sum double-counts n2
    expect(kpi.size).toBe(3);
  });
});

describe('mergeSeenIds', () => {
  it('unions existing + current, unique, capped at SEEN_CAP', () => {
    expect(mergeSeenIds(['a'], ['b', 'a'])).toEqual(['a', 'b']);
    expect(SAVED_SEARCH_SEEN_CAP).toBeGreaterThanOrEqual(SAVED_SEARCH_MATCH_CAP);
    const many = Array.from({ length: SAVED_SEARCH_SEEN_CAP + 10 }, (_, i) => `n${i}`);
    expect(mergeSeenIds([], many)).toHaveLength(SAVED_SEARCH_SEEN_CAP);
  });
});

describe('callers share MATCH_CAP and the unique-new helper (no 300−200 drift)', () => {
  const brief = readFileSync(join(process.cwd(), 'src/app/api/app/watchlist-brief/route.ts'), 'utf8');
  const saved = readFileSync(join(process.cwd(), 'src/app/api/app/saved-searches/route.ts'), 'utf8');
  const snap = readFileSync(join(process.cwd(), 'src/app/api/cron/snapshot-watchlist/route.ts'), 'utf8');
  const alerts = readFileSync(join(process.cwd(), 'src/app/api/cron/saved-search-alerts/route.ts'), 'utf8');

  it('brief, badge, mark_seen, snapshot, and alerts import the shared helper + cap', () => {
    for (const src of [brief, snap, alerts]) {
      expect(src).toContain('SAVED_SEARCH_MATCH_CAP');
    }
    expect(brief).toContain('unseenUniqueNoticeIds');
    expect(saved).toContain('unseenUniqueNoticeIds');
    expect(saved).toContain('fetchSavedSearchNoticeIds');
    expect(snap).toContain('unseenUniqueNoticeIds');
  });

  it('badge/mark_seen no longer hard-code limit(200) (the 100-new artifact)', () => {
    expect(saved).not.toMatch(/\.limit\(200\)/);
    expect(brief).not.toMatch(/const MATCH_CAP = 300/);
  });

  it('POST create stamps last_seen_notice_ids + last_alerted_at so a just-saved search is 0 new', () => {
    expect(saved).toContain('last_seen_notice_ids: baselineIds');
    expect(saved).toContain('last_alerted_at: nowIso');
    expect(saved).toContain('fetchSavedSearchNoticeIds');
  });

  it('KPI totals.newListings is unique across searches, not a sum of per-search newCount', () => {
    expect(brief).toContain('kpiFresh.add(id)');
    expect(brief).toContain('totals.newListings = kpiFresh.size');
    expect(brief).not.toContain('totals.newListings += newCount');
  });
});
