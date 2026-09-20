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
  generated_internal_id: 'CONT_AWD_N0002404C2204_9700_-NONE-_-NONE-',
};

describe('mapAwardRow — issue-log #8 empty filter fields', () => {
  it('stamps an exact 6-digit NAICS filter when USASpending returns null', () => {
    const row = mapAwardRow(EMPTY_SOURCE, { naics: '336612' });
    expect(row.naicsCode).toBe('336612');
    expect(row.awardId).toBe('N0002404C2204');
  });

  it('stamps a 4-char PSC filter when USASpending returns null', () => {
    const row = mapAwardRow(EMPTY_SOURCE, { psc: '1940' });
    expect(row.pscCode).toBe('1940');
  });

  it('does not invent office or recipient state the source left null', () => {
    const row = mapAwardRow(EMPTY_SOURCE, { naics: '336612' });
    expect(row.awardingOffice).toBe('');
    expect(row.recipientState).toBe('');
  });

  it('does not stamp a prefix NAICS as if it were a 6-digit code', () => {
    const row = mapAwardRow(EMPTY_SOURCE, { naics: '336' });
    expect(row.naicsCode).toBe('');
  });
});
