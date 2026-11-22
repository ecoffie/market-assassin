import { describe, it, expect } from 'vitest';
import { classifyForecastLink } from './forecast-link';

// Every constant the forecast ingests store today (2026-11-22).
const STORED = {
  dhsApi: 'https://apfs-cloud.dhs.gov/api/forecast/',
  dhsEra: 'https://apfs-era.dhs.gov/api/apfs-public/forecasts/all',
  hhsApi: 'https://osdbu.hhs.gov/api/sbcxopportunities/?filter=',
  doj: 'https://www.justice.gov/media/1381791/dl',
  nasa: 'https://www.hq.nasa.gov/office/procurement/forecast/AcqForecastNew.xlsx',
  dhsCsv: 'https://www.dhs.gov/sites/default/files/APFS_forecast_allRecords.csv',
};

describe('classifyForecastLink — never an API root, never a fabricated record link', () => {
  it('DHS and HHS API endpoints become the documented listing page, labelled as not this record', () => {
    for (const u of [STORED.dhsApi, STORED.dhsEra]) {
      expect(classifyForecastLink({ source_url: u })).toEqual({ url: 'https://apfs-cloud.dhs.gov/forecast/', scope: 'source_listing', label: expect.stringMatching(/not this record/) });
    }
    expect(classifyForecastLink({ source_url: STORED.hhsApi }).url).toBe('https://osdbu.hhs.gov/industry/opportunity-forecast');
  });
  it('an undocumented API endpoint is no link at all', () => {
    expect(classifyForecastLink({ source_url: 'https://forecast.example.gov/api/v2/items' })).toEqual({ url: null, scope: 'none', label: null });
  });
  it('whole-feed files are the source file, not the record', () => {
    for (const u of [STORED.doj, STORED.nasa, STORED.dhsCsv]) {
      const l = classifyForecastLink({ source_url: u });
      expect(l.scope).toBe('source_file');
      expect(l.label).toMatch(/all records, not this record/);
    }
  });
  it('a Gateway per-row link is the related solicitation, not the forecast', () => {
    const l = classifyForecastLink({ source_url: 'https://sam.gov/opp/abc123/view', external_id: 'GW-L:USGS0070330066' });
    expect(l.scope).toBe('related_solicitation');
    expect(l.url).toBe('https://sam.gov/opp/abc123/view');
  });
  it('a general page is a listing; missing or unsafe values are none', () => {
    expect(classifyForecastLink({ source_url: 'https://www.hq.nasa.gov/office/procurement/forecast/NAF.html' }).scope).toBe('source_listing');
    for (const v of [null, undefined, '', 'not a url', 'javascript:alert(1)', 42]) {
      expect(classifyForecastLink({ source_url: v })).toEqual({ url: null, scope: 'none', label: null });
    }
  });
  it('no stored constant is ever exposed with /api/ in it', () => {
    for (const u of Object.values(STORED)) expect(classifyForecastLink({ source_url: u }).url ?? '').not.toMatch(/\/api\//);
  });
});
