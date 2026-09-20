import { describe, it, expect } from 'vitest';
import { mapAwardRow } from './awards-search';

/** USASpending returns these columns as null even when the NAICS filter matched. */
const EMPTY_SOURCE = {
  'Award ID': 'N0002404C2204',
  'Recipient Name': 'HUNTINGTON INGALLS INCORPORATED',
  'Award Amount': 1304530568.3,
  'NAICS Code': null,
  'NAICS Description': null,
  'Product or Service Code': null,
  'Awarding Office': null,
  'Recipient State Code': null,
  'Place of Performance State Code': 'LA',
  generated_internal_id: 'CONT_AWD_N0002404C2204_9700_-NONE-_-NONE-',
};

describe('mapAwardRow — issue-log #8 source vs filter honesty', () => {
  it('does not stamp filter NAICS into naicsCode when USASpending returns null', () => {
    const row = mapAwardRow(EMPTY_SOURCE, { naics: '336612' });
    expect(row.naicsCode).toBe('');
    expect(row.queriedNaics).toBe('336612');
    expect(row.awardId).toBe('N0002404C2204');
  });

  it('does not stamp filter PSC into pscCode when USASpending returns null', () => {
    const row = mapAwardRow(EMPTY_SOURCE, { psc: '1940' });
    expect(row.pscCode).toBe('');
    expect(row.queriedPsc).toBe('1940');
  });

  it('keeps source NAICS when USASpending returns it', () => {
    const row = mapAwardRow({ ...EMPTY_SOURCE, 'NAICS Code': '336611' }, { naics: '336612' });
    expect(row.naicsCode).toBe('336611');
    expect(row.queriedNaics).toBe('336612');
  });

  it('does not invent office or recipient state the source left null', () => {
    const row = mapAwardRow(EMPTY_SOURCE, { naics: '336612' });
    expect(row.awardingOffice).toBe('');
    expect(row.recipientState).toBe('');
  });

  it('preserves popState as place of performance, not recipient HQ', () => {
    const row = mapAwardRow(EMPTY_SOURCE, { naics: '336612' });
    expect(row.popState).toBe('LA');
    expect(row.recipientState).toBe('');
  });
});
