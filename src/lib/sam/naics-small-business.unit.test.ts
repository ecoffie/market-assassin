/**
 * P0-3 — both ingestion pipelines must normalise to IDENTICAL output.
 *
 * Eric's requirement: "One behavioral test should feed equivalent API and bulk records and
 * assert identical normalized output. That prevents the two pipelines from quietly
 * diverging later."
 *
 * Also pins the tri-state rule: unknown is ABSENT, never coerced to N.
 */
import { describe, it, expect } from 'vitest';
import {
  fromEntityApiNaicsList, fromBulkExtractField, smallBusinessCodes,
  representedCodes, isSmallForNaics, toEntityColumns,
  isExceptionDependent, fromBulkExtractExceptionField,
} from './naics-small-business';

describe('SAM per-NAICS small-business normalisation', () => {
  it('API and BULK produce identical output for the same entity', () => {
    // Real shapes. Didlake (UEI YMZ1PCB5LEM9) is N for 561720 — verified live 2026-08-23.
    const api = fromEntityApiNaicsList([
      { naicsCode: '561720', sbaSmallBusiness: 'N' },
      { naicsCode: '332312', sbaSmallBusiness: 'Y' },
      { naicsCode: '423310', sbaSmallBusiness: 'Y' },
    ]);
    const bulk = fromBulkExtractField('332312Y~423310Y~561720N');
    expect(api).toEqual(bulk);
    expect(smallBusinessCodes(api)).toEqual(smallBusinessCodes(bulk));
    expect(toEntityColumns(api, 's', 't')).toEqual(toEntityColumns(bulk, 's', 't'));
  });

  it('preserves N — it is NOT dropped and NOT confused with unknown', () => {
    const m = fromBulkExtractField('561720N');
    expect(m['561720']).toBe('N');            // recorded
    expect(smallBusinessCodes(m)).toEqual([]); // but not "small"
    expect(isSmallForNaics(m, '561720')).toBe(false);
  });

  it('UNKNOWN stays absent and reads as null — never coerced to N', () => {
    const m = fromBulkExtractField('561720Y');
    expect('332710' in m).toBe(false);
    expect(isSmallForNaics(m, '332710')).toBeNull();   // unknown, NOT false
    expect(isSmallForNaics(m, '561720')).toBe(true);
  });

  it('a bare code with no Y/N flag is UNKNOWN, not N', () => {
    // The old parser's behaviour — slice(0,6) then strip non-digits — would have
    // produced a code here with no status at all. Unknown must stay unknown.
    const m = fromBulkExtractField('541512');
    expect('541512' in m).toBe(false);
    expect(isSmallForNaics(m, '541512')).toBeNull();
  });

  it('ignores malformed codes and stray flags without inventing entries', () => {
    expect(fromBulkExtractField('~~ 12345Y ~ abcdefY ~ 561720X ~')).toEqual({});
    expect(fromEntityApiNaicsList([
      { naicsCode: '56172', sbaSmallBusiness: 'Y' },       // 5 digits
      { naicsCode: '561720', sbaSmallBusiness: null },      // no status
      { naicsCode: '561720', sbaSmallBusiness: 'maybe' },   // not Y/N
    ])).toEqual({});
  });

  it('accepts lowercase / padded flags from either source', () => {
    expect(fromBulkExtractField('561720y')).toEqual({ '561720': 'Y' });
    expect(fromEntityApiNaicsList([{ naicsCode: ' 561720 ', sbaSmallBusiness: ' n ' }]))
      .toEqual({ '561720': 'N' });
  });

  it('representedCodes reports everything SAM spoke to, Y and N alike', () => {
    const m = fromBulkExtractField('332312Y~561720N');
    expect(representedCodes(m)).toEqual(['332312', '561720']);
    expect(smallBusinessCodes(m)).toEqual(['332312']);
  });

  it('the projection is derivable, so it can never drift from the map', () => {
    const m = fromBulkExtractField('561720Y~541512N~332710Y');
    const cols = toEntityColumns(m, 'sam_bulk_extract:X.ZIP', '2026-05-03T00:00:00Z');
    expect(cols.small_business_naics).toEqual(smallBusinessCodes(cols.naics_small_business));
    expect(cols.naics_sb_source).toBe('sam_bulk_extract:X.ZIP');
  });
});

/**
 * ── 'E' / naicsException (added 2026-08-24, P0) ────────────────────────────────────────────
 *
 * MEASURED: field-34 tokens are Y 147,344 / N 44,367 / E 16,203 / bare 946. The normalizer
 * previously accepted only Y and N, so every E became "SAM said nothing". Live-mirror cost,
 * against a control: 541330 / 541519 / 541715 showed 0.0% flagged small across 127,366 firms,
 * vs 84.7% for 541512. Thirteen NAICS are 100% E with zero Y and zero N.
 *
 * 'E' is NOT a size answer — it means the NAICS has exception-specific size standards. These
 * tests pin that it is PRESERVED and NEVER INTERPRETED.
 */
describe("'E' — exception-dependent, preserved but not interpreted", () => {
  it('preserves E instead of dropping it into unknown', () => {
    const m = fromBulkExtractField('541519E~541512Y~561720N');
    expect(m['541519']).toBe('E');
    expect(m['541512']).toBe('Y');
    expect(m['561720']).toBe('N');
  });

  it('E is NOT counted as small — smallBusinessCodes returns Y only', () => {
    // Including E here would silently convert "exception-dependent" into "small".
    const codes = smallBusinessCodes(fromBulkExtractField('541519E~541512Y~561720N'));
    expect(codes).toEqual(['541512']);
    expect(codes).not.toContain('541519');
  });

  it('E is NOT counted as not-small either', () => {
    const m = fromBulkExtractField('541519E');
    expect(m['541519']).not.toBe('N');
  });

  it('a genuinely absent flag is still ABSENT, not E', () => {
    const m = fromBulkExtractField('541512');
    expect(m['541512']).toBeUndefined();
  });

  it('isExceptionDependent distinguishes E from unknown and from N', () => {
    const m = fromBulkExtractField('541519E~561720N');
    expect(isExceptionDependent(m, '541519')).toBe(true);
    expect(isExceptionDependent(m, '561720')).toBe(false);
    expect(isExceptionDependent(m, '999999')).toBe(false);   // unknown != exception-dependent
  });
});

describe('exception field (idx 113) — structure preserved, semantics unresolved', () => {
  it('parses general-base + per-exception answers', () => {
    // Real shapes: 541519 always 2 answers, 541715 always 4 (100% consistent across firms).
    const m = fromBulkExtractExceptionField('541519YY~541715YNYY');
    expect(m['541519'].base).toBe('Y');
    expect(m['541519'].exceptions).toEqual(['Y']);
    expect(m['541715'].base).toBe('Y');
    expect(m['541715'].exceptions).toEqual(['N', 'Y', 'Y']);
  });

  it('keeps every answer rather than collapsing to one boolean', () => {
    const m = fromBulkExtractExceptionField('541330YNYN');
    expect(m['541330'].exceptions).toHaveLength(3);
  });

  it('a malformed token yields NO entry rather than a guessed one', () => {
    // An invented exception answer is worse than an absent one — it looks authoritative.
    expect(fromBulkExtractExceptionField('54151~abc~541519XY~12345Y')).toEqual({});
  });

  it('empty input is empty, not a default', () => {
    expect(fromBulkExtractExceptionField('')).toEqual({});
    expect(fromBulkExtractExceptionField(null)).toEqual({});
  });
});
