/**
 * City-coordinate integrity (2026-10-04). The shared table's entries were single-ZIP centroids,
 * not places: RICHMOND|VA was ZIP 23234 in Chesterfield County, 10.5 km south of the city, so a
 * downtown-Richmond viewport drew 1 of the 8 Richmond firms (Players acceptance check 5).
 * Corrections come from the US Census 2024 Gazetteer internal points, applied only where the old
 * point was outside the Census place boundary and the move is ≤ 25 km
 * (scripts/geo/correct-city-coords.mjs; manifest data/geo/us-city-coords-corrections-2026-10-04.json).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CITY_COORDS, geocodeCity } from './city-geocode';

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'data/geo/us-city-coords-corrections-2026-10-04.json'), 'utf8')) as {
  applied: Array<{ key: string; from: [number, number]; to: [number, number]; move_km: number; geoid: string }>;
  held: Array<{ key: string; from: [number, number]; to: [number, number]; move_km: number }>;
};
const km = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180;
  const x = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
};
const inBox = ([lat, lng]: [number, number], b: number[]) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
const RICHMOND_DOWNTOWN = [-77.6112, 37.4405, -77.3290, 37.6395];

describe('shared city coordinates — Census place truth', () => {
  it('Richmond, VA is the Census place, inside a downtown-Richmond viewport', () => {
    expect(km(CITY_COORDS['RICHMOND|VA'], [37.5314, -77.476])).toBeLessThan(0.1);
    expect(inBox(CITY_COORDS['RICHMOND|VA'], RICHMOND_DOWNTOWN)).toBe(true);
    // every jittered Richmond pin draws inside that viewport now (was 1 of 8)
    for (let seed = 0; seed < 12; seed++) {
      const g = geocodeCity('Richmond', 'VA', seed)!;
      expect(inBox([g.lat, g.lng], RICHMOND_DOWNTOWN)).toBe(true);
    }
  });
  it('Glen Allen, VA is the Census CDP, north of downtown Richmond', () => {
    expect(km(CITY_COORDS['GLEN ALLEN|VA'], [37.6659, -77.4843])).toBeLessThan(0.1);
  });
  it('metros displaced outside their own city are corrected; metros already inside are untouched', () => {
    expect(km(CITY_COORDS['DENVER|CO'], [39.7619, -104.8811])).toBeLessThan(0.1);
    expect(km(CITY_COORDS['ATLANTA|GA'], [33.7629, -84.4227])).toBeLessThan(0.1);
    expect(CITY_COORDS['NEW YORK|NY']).toEqual([40.7484, -73.9967]); // Midtown ZIP, inside NYC
    expect(CITY_COORDS['AUSTIN|TX']).toEqual([30.3264, -97.7713]);  // inside Austin
  });
  it('every applied correction is in the table; every held entry is unchanged', () => {
    expect(manifest.applied.length).toBeGreaterThan(8000);
    for (const r of manifest.applied) expect(CITY_COORDS[r.key]).toEqual(r.to);
    for (const r of manifest.held) expect(CITY_COORDS[r.key]).toEqual(r.from);
  });
  it('no applied move exceeds 25 km — larger moves are homonym risks and are held', () => {
    expect(Math.max(...manifest.applied.map((r) => r.move_km))).toBeLessThanOrEqual(25);
    expect(manifest.held.every((r) => r.move_km > 25)).toBe(true);
    expect(manifest.held.map((r) => r.key)).toContain('VOORHEES|NJ');
  });
  it('the table keeps its identity: same keys, every value a finite [lat, lng] in US range', () => {
    expect(Object.keys(CITY_COORDS).length).toBe(29542);
    for (const [k, v] of Object.entries(CITY_COORDS)) {
      expect(Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]), k).toBe(true);
    }
  });
});
