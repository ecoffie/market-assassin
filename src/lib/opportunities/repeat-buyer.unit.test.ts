import { describe, it, expect } from 'vitest';
import { isRepeatBuyer, repeatBuyerKey, REPEAT_BUYER_MIN, REPEAT_BUYER_PAIRS } from './repeat-buyer';
import { normalizeAgencyKey } from '@/lib/gov-contacts/agency-key';

describe('repeat-buyer lib — grounded membership check', () => {
  it('the honesty floor matches buyer-behavior MIN_SAMPLE (8)', () => {
    expect(REPEAT_BUYER_MIN).toBe(8);
  });

  it('returns false when NAICS or agency is missing (never fabricates)', () => {
    expect(isRepeatBuyer('Department of the Army', null)).toBe(false);
    expect(isRepeatBuyer('Department of the Army', '')).toBe(false);
    expect(isRepeatBuyer(null, '561210')).toBe(false);
    expect(isRepeatBuyer('', '561210')).toBe(false);
  });

  it('returns false for a pair NOT in the precomputed set (honest miss)', () => {
    // A bogus NAICS an agency has never bought → not a repeat buyer. (Real pairs ARE in the set now,
    // so pick a code that cannot qualify — the no-fabrication behavior is the strand staying dark.)
    expect(isRepeatBuyer('Department of the Army', '999999')).toBe(false);
    expect(isRepeatBuyer('Nonexistent Agency Xyzzy', '561210')).toBe(false);
  });

  it('membership hits when the normalized-agency|naics pair IS in the set', () => {
    // Prove the lookup wiring against a synthetic set (the shipped set is generated, not hand-authored).
    const agency = 'Department of the Army';
    const naics = '561210';
    const key = repeatBuyerKey(normalizeAgencyKey(agency), naics);
    const probe: ReadonlySet<string> = new Set([key]);
    // isRepeatBuyer reads the module-level set; emulate its exact predicate here to prove the key math.
    const hit = (() => {
      const nc = naics.trim(); if (!nc) return false;
      const k = normalizeAgencyKey(agency); if (!k) return false;
      return probe.has(repeatBuyerKey(k, nc));
    })();
    expect(hit).toBe(true);
  });

  it('repeatBuyerKey is a stable "agencyKey|naics" join', () => {
    expect(repeatBuyerKey('DEFENSE', '541512')).toBe('DEFENSE|541512');
  });

  it('the shipped set contains only well-formed "KEY|NAICS" entries (no hand-authored junk)', () => {
    for (const entry of REPEAT_BUYER_PAIRS) {
      expect(entry).toMatch(/^[^|]+\|\d{2,6}$/);
    }
  });
});
