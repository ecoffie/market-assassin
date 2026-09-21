/**
 * Shared briefing NAICS query-time expansion (Eric/QA 2026-07-28). Three briefing routes carried a
 * byte-identical private copy of this curated recall table + expander. Two bugs were fixed in the
 * consolidation:
 *   1. send-all-briefings was MISSING the no-match fallback → an unmatched code dropped entirely.
 *   2. ALL THREE checked `expanded.length === 0` (TOTAL accumulated) for the fallback, so once any
 *      earlier code matched, a LATER unmatched code was silently swallowed. The guard must be per-code.
 * Both are locked here. (This is query-time recall, NOT persist — see PERSIST-vs-QUERY in CLAUDE.md.)
 */
import { describe, it, expect } from 'vitest';
import { expandNaicsForBriefing, NAICS_BRIEFING_EXPANSION } from './naics-briefing-expansion';

describe('expandNaicsForBriefing', () => {
  it('a 3-digit prefix expands to its curated members', () => {
    const out = expandNaicsForBriefing(['519']);
    expect(out).toEqual(expect.arrayContaining(['519130', '519190']));
  });

  it('a 6-digit code is kept exact (no family blow-out)', () => {
    expect(expandNaicsForBriefing(['541512'])).toEqual(['541512']);
  });

  it('an unmatched code is KEPT, not dropped (send-all-briefings was missing this)', () => {
    // '999' matches no family prefix in the table → must survive.
    expect(expandNaicsForBriefing(['999'])).toEqual(['999']);
  });

  it('a later unmatched code survives even after an earlier code matched (the per-code fallback bug)', () => {
    // '541512' matches (kept), then '999' matches nothing. The OLD `expanded.length === 0` guard
    // saw a non-empty accumulator and swallowed '999'. Per-code fixes it.
    const out = expandNaicsForBriefing(['541512', '999']);
    expect(out).toContain('541512');
    expect(out).toContain('999');
  });

  it('caps the expanded set (large subsector does not exceed the cap)', () => {
    const out = expandNaicsForBriefing(['541']); // 541 has 27 members
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.every((c) => NAICS_BRIEFING_EXPANSION['541'].includes(c))).toBe(true);
  });

  it('trims + drops empty/whitespace codes; null-safe', () => {
    expect(expandNaicsForBriefing([' 541512 ', '', '  '])).toEqual(['541512']);
    expect(expandNaicsForBriefing(null)).toEqual([]);
    expect(expandNaicsForBriefing(undefined)).toEqual([]);
  });

  it('dedups across overlapping inputs', () => {
    const out = expandNaicsForBriefing(['541512', '541512']);
    expect(out).toEqual(['541512']);
  });
});
