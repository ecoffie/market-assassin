/**
 * spending_by_award returns NAICS / PSC / locations as objects under the current field names; the flat columns we
 * used to request are null (measured 2026-11-28: search_past_contracts NAICS 5418 in CT had naicsCode, pscCode and
 * recipientState empty on all 10 rows). Row shape below is a live response for W91ZRS25PA014.
 */
import { describe, it, expect } from 'vitest';
import { awardNaics, awardPsc, awardRecipientState, awardPopState, awardPopCity, AWARD_SEARCH_NESTED_FIELDS } from './award-search-fields';
import { mapAwardRow } from './awards-search';

const LIVE = {
  'Award ID': 'W91ZRS25PA014',
  'NAICS Code': null, 'NAICS Description': null, 'PSC Code': null, 'Recipient State Code': null,
  'Product or Service Code': null, 'Product or Service Code Description': null, 'Place of Performance State Code': 'CT',
  NAICS: { code: '541890', description: 'OTHER SERVICES RELATED TO ADVERTISING' },
  PSC: { code: 'R699', description: 'SUPPORT- ADMINISTRATIVE: OTHER' },
  'Recipient Location': { state_code: 'CT', city_name: 'SOUTHINGTON' },
  'Primary Place of Performance': { state_code: 'CT', city_name: 'SOUTHINGTON' },
  generated_internal_id: 'CONT_AWD_W91ZRS25PA014_9700_-NONE-_-NONE-',
};

describe('award search field shapes', () => {
  it('reads the object-shaped fields', () => {
    expect(awardNaics(LIVE)).toEqual({ code: '541890', description: 'OTHER SERVICES RELATED TO ADVERTISING' });
    expect(awardPsc(LIVE)).toEqual({ code: 'R699', description: 'SUPPORT- ADMINISTRATIVE: OTHER' });
    expect(awardRecipientState(LIVE)).toBe('CT');
    expect(awardPopState(LIVE)).toBe('CT');
  });
  it('still reads the legacy flat columns when those carry the value', () => {
    const flat = { 'NAICS Code': '236220', 'NAICS Description': 'COMMERCIAL BUILDING', 'Product or Service Code': 'Y1JZ', 'Recipient State Code': 'VA', 'Place of Performance State Code': 'MD' };
    expect(awardNaics(flat).code).toBe('236220');
    expect(awardPsc(flat).code).toBe('Y1JZ');
    expect(awardRecipientState(flat)).toBe('VA');
    expect(awardPopState(flat)).toBe('MD');
  });
  it('absent in both shapes → empty (never stamped from the query filter); recipient and pop never cross', () => {
    expect(awardNaics({})).toEqual({ code: '', description: '' });
    expect(awardRecipientState({ 'Primary Place of Performance': { state_code: 'TX' } })).toBe('');
    expect(awardPopState({ 'Recipient Location': { state_code: 'TX' } })).toBe('');
  });
  it('mapAwardRow (search_past_contracts) now fills naics/psc/recipientState from the live shape', () => {
    const row = mapAwardRow(LIVE, { naics: '5418' });
    expect(row).toMatchObject({ naicsCode: '541890', naicsDescription: 'OTHER SERVICES RELATED TO ADVERTISING', pscCode: 'R699', pscDescription: 'SUPPORT- ADMINISTRATIVE: OTHER', recipientState: 'CT', popState: 'CT', queriedNaics: '5418' });
  });
  it('the request asks for the object-shaped fields', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./awards-search.ts', import.meta.url), 'utf8');
    expect(src).toContain('...AWARD_SEARCH_NESTED_FIELDS');
    expect(AWARD_SEARCH_NESTED_FIELDS).toEqual(['NAICS', 'PSC', 'Recipient Location', 'Primary Place of Performance']);
  });
});

describe('place-of-performance city (Q13/Q26)', () => {
  it('reads Primary Place of Performance.city_name; never the recipient HQ city; empty when absent', () => {
    const r = { 'Primary Place of Performance': { state_code: 'GA', city_name: 'KENNESAW' }, 'Recipient Location': { state_code: 'VA', city_name: 'RESTON' } };
    expect(awardPopCity(r)).toBe('KENNESAW');
    expect(awardPopCity({ 'Recipient Location': { city_name: 'RESTON' } })).toBe('');
    expect(mapAwardRow({ 'Award ID': 'W91YTZ26PA001', ...r }).popCity).toBe('KENNESAW');
  });
});

