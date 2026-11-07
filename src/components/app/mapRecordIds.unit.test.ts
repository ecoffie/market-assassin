import { describe, expect, it } from 'vitest';
import { samNoticeIdFrom } from './mapRecordIds';

const NID = '006d77f604a74dd0a16c99d041e6c032';

describe('samNoticeIdFrom', () => {
  it('accepts a bare notice id (normalized)', () => {
    expect(samNoticeIdFrom(NID)).toBe(NID);
    expect(samNoticeIdFrom(NID.toUpperCase())).toBe(NID);
    expect(samNoticeIdFrom('006d77f6-04a7-4dd0-a16c-99d041e6c032')).toBe(NID);
  });

  it('extracts the id from a SAM link', () => {
    expect(samNoticeIdFrom(`https://sam.gov/opp/${NID}/view`)).toBe(NID);
    expect(samNoticeIdFrom(`https://sam.gov/workspace/contract/opp/${NID}/view`)).toBe(NID);
  });

  it('never treats a solicitation number as a notice id', () => {
    expect(samNoticeIdFrom('W912PL-26-Q-0007')).toBeNull();
    expect(samNoticeIdFrom('N0017426R1003', 'https://sam.gov/search?keywords=x')).toBeNull();
    expect(samNoticeIdFrom(undefined, null, '', 42)).toBeNull();
  });

  it('takes the first candidate that is a real notice id', () => {
    expect(samNoticeIdFrom('W912PL-26-Q-0007', `https://sam.gov/opp/${NID}/view`)).toBe(NID);
  });
});
