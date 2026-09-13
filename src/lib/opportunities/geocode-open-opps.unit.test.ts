/**
 * THE RECURRING GEOCODER's contract. Each test maps to a requirement Eric set (2026-09-12)
 * and to a defect the incident actually produced.
 *
 * The incident's real signature: Open was the ONLY horizon with no geocoding path, so new rows
 * accumulated with NULL coordinates and coverage decayed while every job reported success.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isJunkCity, decideGeocode, planGeocodeWrites, coverageIsHealthy, COVERAGE_FLOOR_PCT,
  type GeocodeSrcRow,
} from './geocode-open-opps';

const row = (o: Partial<GeocodeSrcRow>): GeocodeSrcRow => ({
  notice_id: 'n1', title: 't', pop_city: null, pop_state: null, pop_zip: null,
  pop_country: null, office_address: null, ...o,
});

describe('junk numeric cities are rejected', () => {
  it('rejects "0" and ZIPs-in-the-city-field', () => {
    for (const c of ['0', '77416', '53470', '  0 ']) expect(isJunkCity(c)).toBe(true);
  });
  it('accepts real places incl. installations and digit-containing names', () => {
    for (const c of ['Washington', 'Wright Patterson AFB', 'JBPHH', '29 Palms']) {
      expect(isJunkCity(c)).toBe(false);
    }
  });
  it('a junk city NEVER produces an exact/city match', () => {
    // "0, TX" must fall through to the state centroid, not be looked up as a city name.
    const d = decideGeocode(row({ pop_city: '0', pop_state: 'TX', pop_country: 'USA' }));
    expect(d.precision).toBe('state-approx');
  });
});

describe('precision labels', () => {
  it('a real city+state is exact/city', () => {
    const d = decideGeocode(row({ pop_city: 'Kansas City', pop_state: 'MO', pop_country: 'USA' }));
    expect(d.precision).toBe('exact/city');
    expect(d.lat).toBeTypeOf('number');
    expect(d.source).toBeTruthy();          // provenance ALWAYS set alongside a coordinate
  });
  it('an unresolvable city with a real state is state-approx', () => {
    const d = decideGeocode(row({ pop_city: 'Nowhereville XYZ', pop_state: 'MT', pop_country: 'USA' }));
    expect(d.precision).toBe('state-approx');
    expect(d.lat).toBeTypeOf('number');
  });
  it('falls back to the buying office when place-of-performance has no state', () => {
    const d = decideGeocode(row({ office_address: { city: 'RICHMOND', state: 'VA' } }));
    expect(d.precision).toBe('exact/city');
  });
  it('a real ZIP still geocodes through pop_zip (its actual column)', () => {
    const d = decideGeocode(row({ pop_city: null, pop_state: 'WA', pop_zip: '98337', pop_country: 'USA' }));
    expect(d.precision).toBe('exact/city');
  });
});

describe('never fabricates a location', () => {
  it('no resolvable state anywhere → unplaced, no coordinate', () => {
    const d = decideGeocode(row({}));
    expect(d.precision).toBe('unplaced');
    expect(d.lat).toBeNull();
    expect(d.lng).toBeNull();
  });
  it('APO/FPO military mail is unplaced (no US centroid exists)', () => {
    const d = decideGeocode(row({ office_address: { city: 'APO', state: 'AE' } }));
    expect(d.precision).toBe('unplaced');
  });
  it('a foreign place is never pinned to the US buying office (the "Seoul, DC" guard)', () => {
    const d = decideGeocode(row({
      pop_city: 'Seoul', pop_state: 'KR-11', pop_country: 'KOR',
      office_address: { city: 'WASHINGTON', state: 'DC' },
    }));
    // Either a real world coordinate or unplaced — but NEVER Washington DC's point.
    if (d.lat != null) expect(Math.abs(d.lat - 38.9)).toBeGreaterThan(1);
  });
  it('unplaced rows are never queued for a write', () => {
    const { totals, writes } = planGeocodeWrites([row({}), row({ office_address: { city: 'APO', state: 'AP' } })]);
    expect(totals.unplaced).toBe(2);
    expect(writes).toHaveLength(0);
  });
});

describe('run totals are reportable', () => {
  it('emits exact/state-approx/unplaced counts that sum to scanned', () => {
    const { totals } = planGeocodeWrites([
      row({ pop_city: 'Kansas City', pop_state: 'MO', pop_country: 'USA' }),
      row({ pop_city: 'Nowhereville XYZ', pop_state: 'MT', pop_country: 'USA' }),
      row({}),
    ]);
    expect(totals.scanned).toBe(3);
    expect(totals.exactCity + totals.stateApprox + totals.unplaced).toBe(3);
  });
});

describe('coverage regression guard — the incident signature', () => {
  it('healthy at the ~95.7% steady state', () => {
    expect(coverageIsHealthy(10524, 11001)).toBe(true);
  });
  it('UNHEALTHY at the 4.66% the incident actually sat at', () => {
    // This is the whole point: that state must FAIL the job, not return a cheerful 200.
    expect(coverageIsHealthy(513, 11012)).toBe(false);
  });
  it('trips below the floor', () => {
    expect(coverageIsHealthy(COVERAGE_FLOOR_PCT - 1, 100)).toBe(false);
    expect(coverageIsHealthy(COVERAGE_FLOOR_PCT, 100)).toBe(true);
  });
  it('an empty corpus is not "unhealthy"', () => {
    expect(coverageIsHealthy(0, 0)).toBe(true);
  });
});

describe('cron route wiring', () => {
  const src = readFileSync(join(__dirname, '../../app/api/cron/geocode-open-opps/route.ts'), 'utf8');
  it('only selects UNMAPPED, currently-open rows', () => {
    expect(src).toContain("is('map_lat', null)");
    expect(src).toContain("eq('active', true)");
    expect(src).toContain("gt('response_deadline'");
  });
  it('UPDATEs and can never insert', () => {
    expect(src).toContain('.update(');
    expect(src).not.toContain('.upsert(');
    expect(src).not.toContain('.insert(');
  });
  it('reads an exact affected-row count, not a RETURNING payload (INT-005)', () => {
    expect(src).toContain("count: 'exact'");
  });
  it('returns non-2xx when coverage is unhealthy (fails LOUDLY)', () => {
    expect(src).toContain('status: 500');
    expect(src).toContain('below the');
  });
  it('treats UNKNOWN coverage as not-healthy (never assumes success)', () => {
    expect(src).toContain('unknown != healthy');
  });
  it('supports a dry run', () => {
    expect(src).toContain("p.get('dry') === '1'");
  });
});
