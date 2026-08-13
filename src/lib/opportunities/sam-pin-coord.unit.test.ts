import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePinCoord } from './map-data';

const syncSrc = readFileSync(join(__dirname, '../../app/api/cron/sync-sam-opportunities/route.ts'), 'utf8');
const apiSrc = readFileSync(join(__dirname, '../../app/api/app/opportunity-map/route.ts'), 'utf8');

describe('SAM pin coordinates — stamp on sync, place on read', () => {
  it('resolvePinCoord places a notice from pop_state when map_lat is missing', () => {
    const g = resolvePinCoord({ notice_id: 'n-fl', title: 'Test', pop_state: 'FL' });
    expect(g).not.toBeNull();
    expect(g!.state).toBe('FL');
    expect(g!.lat).toBeGreaterThan(24);
    expect(g!.lat).toBeLessThan(32);
    expect(g!.lng).toBeLessThan(-79);
    expect(g!.lng).toBeGreaterThan(-88);
  });

  it('resolvePinCoord coerces office.zip to zipcode (SAM blob drift)', () => {
    const withZipcode = resolvePinCoord({
      notice_id: 'n-zip-a',
      office_address: { city: 'Tampa', state: 'FL', zipcode: '33602' },
    });
    const withZip = resolvePinCoord({
      notice_id: 'n-zip-a',
      office_address: { city: 'Tampa', state: 'FL', zip: '33602' },
    });
    expect(withZipcode).not.toBeNull();
    expect(withZip).not.toBeNull();
    expect(withZip!.lat).toBe(withZipcode!.lat);
    expect(withZip!.lng).toBe(withZipcode!.lng);
  });

  it('refuses a pin when there is no resolvable state (honest null, never 0,0)', () => {
    expect(resolvePinCoord({ notice_id: 'n-none', title: 'Nowhere' })).toBeNull();
  });

  it('SAM sync stamps map_lat/map_lng via resolvePinCoord before the DNA early-return', () => {
    expect(syncSrc).toContain("import { setGroupKey, resolvePinCoord }");
    const stamp = syncSrc.indexOf('record.map_lat = geo.lat');
    const dnaBail = syncSrc.indexOf('if (!_dnaColumnsExist) return record');
    expect(stamp).toBeGreaterThan(-1);
    expect(dnaBail).toBeGreaterThan(stamp);
    expect(syncSrc).toContain('record.map_lng = geo.lng');
    expect(syncSrc).toContain('record.map_loc_source = geo.source');
  });

  it('viewport Open headline counts listings without requiring map_lat', () => {
    const countFn = apiSrc.slice(
      apiSrc.indexOf('async function countUniqueListingsForFilters'),
      apiSrc.indexOf('const samQueries'),
    );
    expect(countFn).toContain(".select('solicitation_number, notice_id')");
    expect(countFn).not.toContain(".not('map_lat'");
    expect(apiSrc).toContain("import { getMapOpportunities, getDibbsMapPins, getDibbsViewportPins, SET_GROUPS, setGroupKey, SET_LABEL, naicsCategory, resolvePinCoord }");
    expect(apiSrc).toContain(".is('map_lat', null)");
    expect(apiSrc).toContain('pop_zip, pop_country');
  });
});
