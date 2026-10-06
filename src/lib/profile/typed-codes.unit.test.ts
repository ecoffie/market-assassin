import { describe, it, expect } from 'vitest';
import { extractTypedNaics, mergeTypedCodeRejection, rejectedTypedCodes, typedCodeOffers } from './typed-codes';

describe('typed NAICS codes in a user description', () => {
  // Shape taken from the audit's typed-but-unstored rows (no customer text).
  const desc = 'Federal contractor: 541611, 541618. 484110,484121 and 999999. Budget $541611 for 2026.';

  it('extracts standalone 6-digit tokens in order, including comma-joined, skipping money', () => {
    expect(extractTypedNaics(desc)).toEqual(['541611', '541618', '484110', '484121', '999999']);
  });

  it('offers only Census-valid codes, each with its official title', () => {
    const offers = typedCodeOffers([desc]);
    expect(offers.map((o) => o.code)).toEqual(['541611', '541618', '484110', '484121']);
    expect(offers.find((o) => o.code === '484110')?.title).toMatch(/General Freight Trucking, Local/i);
    expect(offers.every((o) => o.title.length > 0)).toBe(true);
  });

  it('never re-offers a stored or rejected code, and dedupes across sources', () => {
    const offers = typedCodeOffers([desc, 'also 484110'], { stored: ['541611'], rejected: ['541618'] });
    expect(offers.map((o) => o.code)).toEqual(['484110', '484121']);
  });

  it('records a rejection without touching other aggregated_profile keys', () => {
    const before = { alert_mode: 'focused', naics_priorities: { '541611': 'primary' } };
    const after = mergeTypedCodeRejection(before, '484121', '2026-10-06T00:00:00Z');
    expect(after.alert_mode).toBe('focused');
    expect(after.naics_priorities).toEqual({ '541611': 'primary' });
    expect(rejectedTypedCodes(after)).toEqual(['484121']);
    expect(rejectedTypedCodes(mergeTypedCodeRejection(after, '484121', 'x'))).toEqual(['484121']);
    expect(rejectedTypedCodes(null)).toEqual([]);
  });
});
