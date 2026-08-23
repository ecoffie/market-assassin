import { describe, it, expect } from 'vitest';
import { pscStatus, isUsablePsc } from './psc-status';

/**
 * PSC HAS TWO REAL LEVELS. The validator only admitted one.
 *
 * The old shape rule required exactly 4 characters, justified as "verified against the
 * catalog: of 2,397 codes, ZERO are four letters." But psc-codes.json is LEVEL-4-ONLY —
 * psc-catalog-live.ts:64 discards non-4-char nodes on ingest — so the catalog is structurally
 * incapable of observing 2-char codes. A constraint was derived from a source that could not
 * see the counterexamples.
 *
 * MEASURED against live active opportunities, 2026-08-23:
 *   4-char  11,844 rows / 1,021 codes
 *   2-char   3,074 rows /    51 codes   <- every one shown "Not a valid PSC format"
 *   1-char      12 rows /     3 codes
 *
 * Those 2-char values are real product groups (59 electrical components, 53 hardware,
 * 25 vehicular equipment), not truncations. Same class as the NAICS picker gap: the reference
 * layer could not represent data the system already held, so the UI called reality wrong.
 */
describe('PSC group codes are a level, not a malformation', () => {
  it('accepts the highest-volume live group codes', () => {
    // Top of the measured distribution: 59 (663 rows), 53 (515), 48 (230), 25 (181).
    for (const code of ['59', '53', '48', '25', '61', '47']) {
      const v = pscStatus(code);
      expect(v.status, `${code} must not be malformed`).not.toBe('malformed');
      expect(isUsablePsc(code)).toBe(true);
    }
  });

  it('reports an unknown group as not_in_catalog — the honest state that already existed', () => {
    // "may still be valid" is exactly right for a level the catalog does not carry.
    const v = pscStatus('59');
    expect(['valid', 'not_in_catalog']).toContain(v.status);
    if (v.status === 'not_in_catalog') expect(v.label).toMatch(/may still be valid/i);
  });

  it('still calls a genuine typo malformed — the anti-noise intent survives', () => {
    // The original rule existed to stop 'NOPE' being waved through as "maybe real". Widening
    // to admit groups must not cost that.
    for (const bad of ['NOPE', 'ABCD', 'X', '123', '12345', '', '  ']) {
      expect(pscStatus(bad).status, `${bad || '(blank)'} should be malformed`).toBe('malformed');
    }
  });

  it('keeps full 4-char codes working, both shapes', () => {
    // Service codes are letter-led with digits; products are 4 digits.
    for (const code of ['D314', 'R425', '1005']) {
      expect(pscStatus(code).status).not.toBe('malformed');
    }
  });

  it('normalises case and whitespace before judging', () => {
    expect(pscStatus(' d314 ').status).not.toBe('malformed');
    expect(pscStatus(' 59 ').status).not.toBe('malformed');
  });
});
