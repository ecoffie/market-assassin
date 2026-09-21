import { describe, it, expect } from 'vitest';
import { searchNaics, naicsTitle, isKnownNaics, NAICS_SIX_DIGIT } from './naics-catalog';

/**
 * THE INVARIANT:
 *
 *   If the data layer can return opportunities for a NAICS code, the UI catalog must be able
 *   to represent that code.
 *
 * Two users hit the violation two days apart — Robert on 333612, Hector on 324110 — and both
 * concluded we did not cover their industry. We did. The picker just could not say so.
 */
describe('NAICS catalog — the reported codes', () => {
  it('resolves 324110 to Petroleum Refineries (Hector, JPAC Global)', () => {
    expect(naicsTitle('324110')).toBe('Petroleum Refineries');
    expect(isKnownNaics('324110')).toBe(true);
  });

  it('resolves 333612 (Robert, 8/22 demo)', () => {
    expect(isKnownNaics('333612')).toBe(true);
    expect(naicsTitle('333612')).toMatch(/Gear Manufacturing/);
  });

  it('covers every family that was missing from the old picker', () => {
    // Each had live open opportunities on 2026-08-23 and no way to be selected.
    const oneEach = ['324110', '311999', '326220', '331210', '337214', '513210', '531120', '115310'];
    for (const code of oneEach) {
      expect(isKnownNaics(code), `${code} must be representable`).toBe(true);
      expect(naicsTitle(code), `${code} needs a real title`).toBeTruthy();
    }
  });
});

describe('search by code and by name reach the same entry', () => {
  it('finds 324110 by its code', () => {
    expect(searchNaics('324110')[0].code).toBe('324110');
  });

  it('finds petroleum refineries by plain English', () => {
    const hit = searchNaics('petroleum').map((r) => r.code);
    expect(hit).toContain('324110');
  });

  it('ranks an exact code match first', () => {
    expect(searchNaics('541512')[0].code).toBe('541512');
  });

  it('supports partial codes while the user is still typing', () => {
    const codes = searchNaics('3336').map((r) => r.code);
    expect(codes.some((c) => c.startsWith('3336'))).toBe(true);
  });

  it('prefers the 6-digit level a contractor actually bids at', () => {
    // "Software Publishers" is 513210; the parent 5132 exists too. The bid-level code wins.
    const first = searchNaics('software publishers')[0];
    expect(first.code.length).toBe(6);
  });

  it('returns nothing for an empty query rather than the whole catalog', () => {
    expect(searchNaics('')).toEqual([]);
    expect(searchNaics('   ')).toEqual([]);
  });

  it('never invents a title for an unknown code', () => {
    expect(naicsTitle('999999')).toBeUndefined();
    expect(isKnownNaics('999999')).toBe(false);
  });
});

describe('catalog shape', () => {
  it('carries the full 6-digit NAICS universe, not a curated subset', () => {
    // The old hand-maintained list held 521 codes and covered 62.5% of live inventory.
    // Anything near that number means the ceiling came back.
    expect(NAICS_SIX_DIGIT.length).toBeGreaterThan(1000);
  });

  it('gives every entry a code and a title', () => {
    const broken = NAICS_SIX_DIGIT.filter((e) => !e.code || !e.title);
    expect(broken).toEqual([]);
  });
});
