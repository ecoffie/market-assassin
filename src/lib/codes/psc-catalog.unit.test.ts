import { describe, it, expect } from 'vitest';
import { getPsc } from './lookup';
import pscData from '@/data/psc-codes.json';

/**
 * A customer hit this on 2026-08-15: our recommender told him to add D314
 * (9% of his market, $134.6M in live awards), Settings rendered it as "not a
 * known PSC", and he swapped in a code that added no coverage. The reference
 * file had 869 of the catalog's 2,048 codes.
 *
 * These guard the shape of that failure — a real code the product itself
 * recommends must never read as unknown.
 */
describe('PSC reference catalog', () => {
  it('resolves D314 — the code that started this', () => {
    const e = getPsc('D314');
    expect(e).toBeTruthy();
    expect(e!.title).toMatch(/ACQUISITION SUPPORT/i);
  });

  it('covers the top PSCs of the acquisition-support market', () => {
    // Live top-5 by dollars; every one must resolve or the coverage hint
    // recommends codes Settings then rejects.
    for (const code of ['R707', 'D314', 'R408', 'R499', 'R425']) {
      expect(getPsc(code), `${code} must resolve`).toBeTruthy();
    }
  });

  it('carries the full catalog, not a subset', () => {
    // 869 was the broken state. The live tree has ~2,048 leaves; we keep
    // local-only legacy codes too, so the floor is well above the old count.
    const total = Object.keys((pscData as { codes: Record<string, unknown> }).codes).length;
    expect(total).toBeGreaterThan(2000);
  });

  it('has no empty titles — an entry with no title reads as broken in the UI', () => {
    const codes = (pscData as { codes: Record<string, { title?: string }> }).codes;
    const empty = Object.entries(codes).filter(([, v]) => !v.title || !v.title.trim());
    expect(empty.map(([k]) => k)).toEqual([]);
  });

  it('still resolves legacy product codes (nothing was dropped)', () => {
    expect(getPsc('1005')).toBeTruthy();
  });
});
