/**
 * DEFECT-8 — capability vs interest, and the shape collision underneath it.
 * Fixtures are the REAL production shapes measured 2026-08-25.
 */
import { describe, it, expect } from 'vitest';
import {
  readNaicsSignals, naicsCodesFrom, invalidNaicsCodes, declaredCodes, observedInterestCodes,
} from './naics-signal';

// Real rows from production.
const CLICK_SHAPE = [
  { code: '561720', name: 'Janitorial Services', count: 5 },
  { code: '561730', name: 'Landscaping Services', count: 5 },
  { code: '561210', name: 'Facilities Support Services', count: 2 },
];
const DECLARED_SHAPE = ['541511', '541512', '541611'];

describe('DEFECT-8-A — the shape collision', () => {
  it('reads the CLICK (object) shape', () => {
    expect(naicsCodesFrom(CLICK_SHAPE)).toEqual(['561720', '561730', '561210']);
  });

  it('reads the DECLARED (string) shape', () => {
    expect(naicsCodesFrom(DECLARED_SHAPE)).toEqual(['541511', '541512', '541611']);
  });

  it('⚠️ THE BUG: object rows are NOT invalid NAICS', () => {
    // The old code stringified these to "[object Object]" and reported them as invalid.
    // Measured: 53 production rows falsely flagged by admin/debug-profile.
    expect(invalidNaicsCodes(CLICK_SHAPE)).toEqual([]);
  });

  it('never emits "[object Object]"', () => {
    const out = [...naicsCodesFrom(CLICK_SHAPE), ...invalidNaicsCodes(CLICK_SHAPE)];
    expect(out.some((c) => c.includes('object Object'))).toBe(false);
  });

  it('still reports GENUINELY malformed codes', () => {
    expect(invalidNaicsCodes(['5415', 'abcdef', '541512'])).toEqual(['5415', 'abcdef']);
    expect(invalidNaicsCodes([{ code: '99', name: 'x' }])).toEqual(['99']);
  });

  it('a naive .includes() on the raw column misses object rows — the seam exists for this', () => {
    expect((CLICK_SHAPE as unknown as string[]).includes('561720')).toBe(false); // the old bug
    expect(naicsCodesFrom(CLICK_SHAPE).includes('561720')).toBe(true);           // the fix
  });
});

describe('DEFECT-8-B — provenance must survive the read', () => {
  it('clicked codes are OBSERVED INTEREST, not declared capability', () => {
    expect(observedInterestCodes(CLICK_SHAPE)).toEqual(['561720', '561730', '561210']);
    expect(declaredCodes(CLICK_SHAPE)).toEqual([]);
  });

  it('profile codes are DECLARED capability', () => {
    expect(declaredCodes(DECLARED_SHAPE)).toEqual(['541511', '541512', '541611']);
    expect(observedInterestCodes(DECLARED_SHAPE)).toEqual([]);
  });

  it('interest never silently becomes capability', () => {
    const sigs = readNaicsSignals(CLICK_SHAPE);
    expect(sigs.every((s) => s.provenance === 'observed_interest')).toBe(true);
  });

  it('keeps the click COUNT — how strong the interest was', () => {
    expect(readNaicsSignals(CLICK_SHAPE)[0].count).toBe(5);
  });

  it('drops the placeholder "Unknown" name rather than presenting it as a label', () => {
    expect(readNaicsSignals([{ code: '332722', name: 'Unknown', count: 4 }])[0].name).toBeUndefined();
  });
});

describe('robustness — both shapes are live in production', () => {
  it.each([[null], [undefined], [{}], ['nope'], [[]], [[null]], [[{}]]])('%p → []', (v) => {
    expect(naicsCodesFrom(v)).toEqual([]);
    expect(invalidNaicsCodes(v)).toEqual([]);
  });

  it('handles a MIXED array without dropping either kind', () => {
    const mixed = [...DECLARED_SHAPE, ...CLICK_SHAPE];
    expect(naicsCodesFrom(mixed)).toHaveLength(6);
    expect(declaredCodes(mixed)).toHaveLength(3);
    expect(observedInterestCodes(mixed)).toHaveLength(3);
  });

  it('dedupes a code appearing in both shapes', () => {
    expect(naicsCodesFrom(['561720', { code: '561720', count: 3 }])).toEqual(['561720']);
  });

  it('accepts alternate object keys without inventing codes', () => {
    expect(naicsCodesFrom([{ naicsCode: '541512' }, { naics: '541611' }])).toEqual(['541512', '541611']);
    expect(naicsCodesFrom([{ name: 'no code here' }])).toEqual([]);
  });
});
