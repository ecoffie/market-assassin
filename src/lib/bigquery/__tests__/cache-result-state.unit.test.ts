import { describe, it, expect } from 'vitest';

/**
 * Locks the distinction between "there is nothing" and "we do not know".
 *
 * THE BUG THIS PREVENTS
 * ---------------------
 * `queryCached()` returns `[]` in three completely different situations:
 *   1. the cache held a genuine zero-row result
 *   2. the cache missed and live BQ is disabled  ← we do not know
 *   3. the query ran and failed                  ← we do not know
 *
 * For a long time all three were indistinguishable, so pages rendered case 2 as
 * "0 contracts". Between June and August 2026 that cost getmindy.ai ~86% of its
 * search impressions: 11,772 `/contractors/<x>/contracts` pages published
 * "Showing contracts 1–0 of 0 total" beneath titles reading
 * "Senture LLC — 29 Federal Contracts ($399M)". The awards existed the whole time
 * (330 real rows for that UEI). Google saw eleven thousand pages contradicting
 * themselves and demoted the cluster.
 *
 * The rule these tests enforce:
 *
 *     NEVER RENDER A ZERO YOU CANNOT PROVE.
 *
 * A mirror of the classifier in cache.ts, kept pure so the semantics are pinned
 * without needing a live KV or BigQuery.
 */

type BqResultState = 'hit' | 'empty' | 'unavailable' | 'failed';

function classify(opts: {
  rowCount: number;
  degraded: boolean;
  unavailable: boolean;
}): BqResultState {
  if (opts.rowCount > 0) return 'hit';
  if (opts.degraded) return 'failed';
  if (opts.unavailable) return 'unavailable';
  return 'empty';
}

const isUnknown = (s: BqResultState) => s === 'unavailable' || s === 'failed';

describe('bq result state — "nothing" vs "we do not know"', () => {
  it('rows present is a hit', () => {
    expect(classify({ rowCount: 42, degraded: false, unavailable: false })).toBe('hit');
  });

  it('a cache hit holding zero rows is a GENUINE empty — safe to render "none"', () => {
    const s = classify({ rowCount: 0, degraded: false, unavailable: false });
    expect(s).toBe('empty');
    expect(isUnknown(s)).toBe(false);
  });

  it('a cache MISS while live BQ is disabled is UNAVAILABLE, not empty', () => {
    // The exact production condition on 2026-08-24.
    const s = classify({ rowCount: 0, degraded: false, unavailable: true });
    expect(s).toBe('unavailable');
    expect(isUnknown(s)).toBe(true);
  });

  it('a failed query is FAILED, not empty', () => {
    const s = classify({ rowCount: 0, degraded: true, unavailable: false });
    expect(s).toBe('failed');
    expect(isUnknown(s)).toBe(true);
  });

  it('failure outranks unavailability when both are flagged', () => {
    expect(classify({ rowCount: 0, degraded: true, unavailable: true })).toBe('failed');
  });

  it('rows outrank every flag — data on the page is data on the page', () => {
    expect(classify({ rowCount: 5, degraded: true, unavailable: true })).toBe('hit');
  });

  it('the three zero-row states are NOT interchangeable', () => {
    const genuine = classify({ rowCount: 0, degraded: false, unavailable: false });
    const cold = classify({ rowCount: 0, degraded: false, unavailable: true });
    const broken = classify({ rowCount: 0, degraded: true, unavailable: false });
    expect(new Set([genuine, cold, broken]).size).toBe(3);
    // Only ONE of them may be rendered as "this contractor has no contracts".
    expect([genuine, cold, broken].filter((s) => !isUnknown(s))).toEqual(['empty']);
  });
});

describe('page behaviour derived from the state', () => {
  /** What the /contracts page decides, given the awards state. */
  function pageDecision(state: BqResultState) {
    const unknown = isUnknown(state);
    return {
      index: !unknown,
      inSitemap: !unknown,
      showsCount: !unknown,
      honestNotice: unknown,
      is404: false, // never — these are real URLs that recover on their own
    };
  }

  it('an unavailable page noindexes, leaves the sitemap, and hides the count', () => {
    const d = pageDecision('unavailable');
    expect(d.index).toBe(false);
    expect(d.inSitemap).toBe(false);
    expect(d.showsCount).toBe(false);
    expect(d.honestNotice).toBe(true);
  });

  it('an unavailable page is NEVER 404ed or redirected away', () => {
    // 11,772 legitimate URLs. They recover automatically once the cache warms;
    // deleting them would throw away the recovery.
    expect(pageDecision('unavailable').is404).toBe(false);
    expect(pageDecision('failed').is404).toBe(false);
  });

  it('a genuinely empty contractor still indexes and may say "no contracts"', () => {
    const d = pageDecision('empty');
    expect(d.index).toBe(true);
    expect(d.showsCount).toBe(true);
    expect(d.honestNotice).toBe(false);
  });

  it('indexing returns on its own once data is available — no manual resubmission', () => {
    expect(pageDecision('unavailable').index).toBe(false);
    expect(pageDecision('hit').index).toBe(true);
  });
});
