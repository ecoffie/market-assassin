import { describe, it, expect } from 'vitest';
import { multiVal, parseMapFilters } from './map-filters';
import { multiAgency } from './agency-match';

/**
 * Regression: snapshot-watchlist 500, 2026-08-08.
 *
 * `multiVal(v: string)` guarded null/undefined with `(v || '')` but NOT `[]` --
 * an empty array is TRUTHY, so it reached `.split(',')` and threw
 * `TypeError: (v || "").split is not a function`. 0-byte 500, before any
 * response existed. Same flaw in `multiAgency`.
 *
 * The route had not changed in months. The DATA shape had: the viewport API
 * feeds these URL strings, but the saved-search crons feed
 * `saved_searches.filters` JSON, where the UI stores list-valued filters as real
 * arrays. Two of seven open saved searches held `"strategy": []` and the cron
 * died on the first one.
 *
 * These are the exact stored shapes pulled from prod that day.
 */

const PROD_SAVED_FILTERS = [
  { state: 'SC', horizons: { open: true, forecast: false, recompete: false }, strategy: [] },
  { horizons: { open: true, forecast: false, recompete: false }, strategy: [] },
  {},
  { valueRange: '-1004536' },
];

describe('multiVal — non-string inputs (the 500)', () => {
  it('does not throw on an empty array', () => {
    // The exact crash: `"strategy": []` from a stored saved search.
    expect(() => multiVal([])).not.toThrow();
    expect(multiVal([])).toEqual([]);
  });

  it('does not throw on an object', () => {
    // `"horizons": {...}` -- unparseable as a list, must degrade to empty
    // rather than throw OR silently match everything.
    expect(() => multiVal({ open: true })).not.toThrow();
    expect(multiVal({ open: true })).toEqual([]);
  });

  it('JOINS a populated array rather than merely tolerating it', () => {
    // strategy genuinely IS a list. Returning [] here would not throw but WOULD
    // silently drop the user's filter -- a quieter, worse bug.
    expect(multiVal(['sb_friendly', 'closes_soon'])).toEqual(['sb_friendly', 'closes_soon']);
  });

  it('still handles every URL-string shape it always did', () => {
    expect(multiVal('541512,541511')).toEqual(['541512', '541511']);
    expect(multiVal('  541512 , 541511  ')).toEqual(['541512', '541511']);
    expect(multiVal('')).toEqual([]);
    expect(multiVal(null)).toEqual([]);
    expect(multiVal(undefined)).toEqual([]);
  });

  it('dedupes across both input shapes', () => {
    expect(multiVal('a,a,b')).toEqual(['a', 'b']);
    expect(multiVal(['a', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('drops non-scalar array members instead of stringifying them', () => {
    // [object Object] is never a valid strand key -- it must not become a needle.
    expect(multiVal(['ok', { bad: 1 }, null, 'fine'])).toEqual(['ok', 'fine']);
  });

  it('accepts a number (JSON can store one)', () => {
    expect(multiVal(541512)).toEqual(['541512']);
  });
});

describe('multiAgency — the same flaw, pipe-delimited', () => {
  it('does not throw on an array', () => {
    expect(() => multiAgency([])).not.toThrow();
    expect(multiAgency([])).toEqual([]);
  });

  it('joins a populated array into needles', () => {
    expect(multiAgency(['Navy', 'Army'])).toEqual(['Navy', 'Army']);
  });

  it('preserves pipe-string behaviour', () => {
    expect(multiAgency('Navy|Army')).toEqual(['Navy', 'Army']);
    expect(multiAgency('')).toEqual([]);
    expect(multiAgency(null)).toEqual([]);
  });

  it('does not throw on an object', () => {
    expect(multiAgency({ a: 1 })).toEqual([]);
  });
});

describe('parseMapFilters over the REAL stored saved-search filters', () => {
  it.each(PROD_SAVED_FILTERS)('survives %j', (filters) => {
    // This is what the cron does: read filters JSON, hand each key to the parser.
    const get = (k: string) => (filters as Record<string, unknown>)[k] as string | null;
    expect(() => parseMapFilters(get)).not.toThrow();
  });

  it('parses the SC search without losing its state filter', () => {
    const f = PROD_SAVED_FILTERS[0] as Record<string, unknown>;
    const parsed = parseMapFilters((k) => f[k] as string | null);
    expect(parsed.state).toBe('SC');
    expect(parsed.strategy).toEqual([]);
  });

  it('carries a populated stored strategy array through to the filter', () => {
    const f: Record<string, unknown> = { strategy: ['sb_friendly'] };
    const parsed = parseMapFilters((k) => f[k] as string | null);
    // Allowlisted against STRATEGY_STRAND_KEYS, so a real strand survives.
    expect(parsed.strategy).toEqual(['sb_friendly']);
  });
});
