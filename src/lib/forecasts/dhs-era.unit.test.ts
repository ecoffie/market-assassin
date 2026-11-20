/**
 * One record from GET https://apfs-era.dhs.gov/api/apfs-public/forecasts/all
 * on 2026-11-19 (659 records). NAICS comes from the source string, not a default.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DHS_ERA_FORECASTS_URL, dhsAllrecordsToDbRow, dhsEraRecordToParsed } from './dhs-allrecords';

const live = JSON.parse(readFileSync(join(__dirname, '__fixtures__/dhs-era-singapore-pier.json'), 'utf8'));

describe('dhsEraRecordToParsed', () => {
  it('attributes the USCG row to its APFS number and source NAICS', () => {
    const parsed = dhsEraRecordToParsed(live);
    expect(parsed).not.toBeNull();
    expect(parsed!.apfsNumber).toBe('F2027076057');
    expect(parsed!.title).toBe('Singapore Pier and Shoreside Support');
    expect(parsed!.component).toBe('USCG/LOGCOM');
    expect(parsed!.naicsCode).toBe('488310');
    expect(parsed!.naicsDescription).toBe('Port and Harbor Operations');
    expect(parsed!.solicitationRelease).toBe('2026-11-18');
    expect(parsed!.pocEmail).toBeUndefined();
    const db = dhsAllrecordsToDbRow(parsed!, { sourceUrl: DHS_ERA_FORECASTS_URL });
    expect(db.external_id).toBe('F2027076057');
    expect(db.naics_code).toBe('488310');
    expect(db.source_url).toBe(DHS_ERA_FORECASTS_URL);
    expect(db.bureau).toBe('USCG/LOGCOM');
  });

  it('drops a record with no APFS number instead of inventing an id', () => {
    expect(dhsEraRecordToParsed({ title: 'No number', component: 'FEMA' })).toBeNull();
  });
});
