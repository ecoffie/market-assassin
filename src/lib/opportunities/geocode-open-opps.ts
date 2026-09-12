/**
 * THE OPEN-OPPORTUNITY GEOCODER — one definition, shared by the recurring cron
 * (/api/cron/geocode-open-opps) and the one-time backfill script.
 *
 * WHY THIS EXISTS AS A RECURRING JOB, not just a backfill. The 2026-09-12 incident was NOT
 * "some rows lacked coordinates" — it was that NOTHING EVER GEOCODED THEM. Open was the only
 * horizon with no geocode path at all: 513 of 11,012 open opps (4.7%) mapped, every one posted
 * 2026-08-06..08-14, ZERO of the 8,292 posted in September. The daily sync inserted new rows
 * with NULL coordinates and nothing ever filled them, so coverage decayed silently toward zero
 * as the corpus turned over. A one-time backfill fixes the symptom and the same incident returns
 * in a few weeks. This job is the prevention layer.
 *
 * PURE LOOKUP — no external API, no network geocoding. Reuses resolvePinCoord(), the SAME chain
 * the map itself uses (OCONUS → pop city/state → pop ZIP → office ZIP → office city/state →
 * state centroid), so a geocoded pin lands exactly where the map would have drawn it.
 *
 * INVARIANTS (each one is a defect this incident actually produced):
 *  1. Only touches rows where map_lat IS NULL — new + unmapped, never re-writes good data.
 *  2. UPDATE, never upsert/insert: a geocoder must be incapable of CREATING an opportunity.
 *  3. Junk numeric "cities" ("0", a ZIP in the city column) never become a city match.
 *  4. Provenance is always written (map_loc_source) — a coordinate with no source is unauditable.
 *  5. A row whose state cannot be resolved is LEFT NULL. Honest gap, never a fabricated point.
 *  6. Reports exact/state-approx/unplaced counts so a run is verifiable, not merely "successful".
 */
import { resolvePinCoord, geocode } from './map-data';
import { normalizeStateCode } from '@/lib/utils/us-states';

/** Columns the geocoder needs. Exported so callers select exactly these (no drift). */
export const GEOCODE_SRC_COLS =
  'notice_id, title, pop_city, pop_state, pop_zip, pop_country, office_address';

export type GeocodeSrcRow = {
  notice_id: string; title: string | null;
  pop_city: string | null; pop_state: string | null; pop_zip: string | null; pop_country: string | null;
  office_address: { city?: string; state?: string; zipcode?: string } | null;
};

export type GeocodePrecisionLabel = 'exact/city' | 'state-approx' | 'unplaced';

export type GeocodeDecision = {
  precision: GeocodePrecisionLabel;
  lat: number | null; lng: number | null;
  /** 'pop' | 'office' — which field produced the point. Always set when lat is set. */
  source: string | null;
};

/**
 * THE JUNK-CITY GUARD. 484 of the 10,491 unmapped rows carried a NUMERIC "city": "0" (~330 —
 * 0|OK 48, 0|CA 41, 0|TX 38) and ZIPs sitting in the city column (77416|DC, 53470|VA).
 * "0" is a placeholder, not a place; a ZIP in the city field is a data-entry error. Either one
 * accepted as a city NAME is a confidently-wrong pin. A real ZIP still geocodes — through
 * pop_zip, its actual column. This guard only stops it being read as a city name.
 */
export function isJunkCity(city: string | null | undefined): boolean {
  const c = String(city ?? '').trim();
  return c === '' || /^\d+$/.test(c);
}

/** Strip junk cities so they can never reach the city-name lookup. */
function cleaned(row: GeocodeSrcRow): GeocodeSrcRow {
  const office = row.office_address;
  return {
    ...row,
    pop_city: isJunkCity(row.pop_city) ? null : row.pop_city,
    office_address: office ? { ...office, city: isJunkCity(office.city) ? undefined : office.city } : null,
  };
}

/**
 * Decide ONE row's coordinate + precision. No I/O.
 * `exact/city` = a real city or ZIP match. `state-approx` = correct state, centroid point.
 * `unplaced` = no resolvable US state (or a foreign place we cannot locate) → no pin, ever.
 */
export function decideGeocode(rawRow: GeocodeSrcRow): GeocodeDecision {
  const row = cleaned(rawRow);
  const popState = normalizeStateCode(row.pop_state || '');
  const g = geocode((row.pop_city || '').trim(), popState, row.office_address, row.pop_zip, row.pop_country);
  if (!g.state) return { precision: 'unplaced', lat: null, lng: null, source: null };

  const coord = resolvePinCoord(row);
  if (!coord) return { precision: 'unplaced', lat: null, lng: null, source: null };

  // g.coord set → a real city/ZIP/world-city match. Unset → the state-centroid fallback.
  return {
    precision: g.coord ? 'exact/city' : 'state-approx',
    lat: coord.lat, lng: coord.lng, source: coord.source,
  };
}

export type GeocodeRunTotals = {
  scanned: number; written: number;
  exactCity: number; stateApprox: number; unplaced: number;
  junkCities: number; missing: number;
};

export function emptyTotals(): GeocodeRunTotals {
  return { scanned: 0, written: 0, exactCity: 0, stateApprox: 0, unplaced: 0, junkCities: 0, missing: 0 };
}

/**
 * Classify a batch and return the rows to write. Pure — the caller owns the DB.
 * Split out so the cron, the script and the tests all classify IDENTICALLY.
 */
export function planGeocodeWrites(rows: GeocodeSrcRow[]): {
  totals: GeocodeRunTotals;
  writes: Array<{ notice_id: string; map_lat: number; map_lng: number; map_loc_source: string }>;
} {
  const totals = emptyTotals();
  const writes: ReturnType<typeof planGeocodeWrites>['writes'] = [];
  for (const r of rows) {
    totals.scanned++;
    if (isJunkCity(r.pop_city) && String(r.pop_city ?? '').trim() !== '') totals.junkCities++;
    const d = decideGeocode(r);
    if (d.precision === 'exact/city') totals.exactCity++;
    else if (d.precision === 'state-approx') totals.stateApprox++;
    else { totals.unplaced++; continue; }
    if (d.lat != null && d.lng != null && d.source) {
      writes.push({ notice_id: r.notice_id, map_lat: d.lat, map_lng: d.lng, map_loc_source: d.source });
    }
  }
  return { totals, writes };
}

/**
 * COVERAGE REGRESSION GUARD. The incident's real signature was not an error — it was coverage
 * DECAYING while every job reported success. So a run that leaves open coverage below the floor
 * FAILS LOUDLY (non-2xx) instead of returning a cheerful 200.
 *
 * Floor is deliberately well under the ~95.7% steady state: enough headroom for a big sync of
 * fresh un-geocoded rows mid-run, tight enough that a genuinely broken geocoder trips it.
 */
export const COVERAGE_FLOOR_PCT = 80;

export function coverageIsHealthy(mapped: number, total: number): boolean {
  if (total <= 0) return true;                 // nothing open → nothing to be unhealthy about
  return (100 * mapped) / total >= COVERAGE_FLOOR_PCT;
}
