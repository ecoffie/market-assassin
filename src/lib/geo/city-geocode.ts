/**
 * geocodeCity — THE canonical city→lat/lng resolver for every map surface (Open opps,
 * Recompetes, Companies, Gov Buyers). One shared lib so a firm/opp lands on the same real
 * spot everywhere, instead of the prior patchwork (opp map already had a real city table;
 * contacts-map and recompete-map both used a bare STATE_CENTROID ring instead).
 *
 * Backed by `src/data/us-city-coords.json` — ~29.5K US cities, GeoNames (public domain),
 * the SAME table `src/lib/opportunities/map-data.ts` already uses for opp pins. Keyed
 * `UPPER(city)|STATE`. City-exact when found; falls back to STATE_CENTROIDS (the honest
 * state-level approximation) when the city isn't in the table — NEVER fabricated, and
 * callers can tell the two apart via `precision`.
 *
 * A tiny deterministic jitter is applied ONLY when multiple rows resolve to the exact same
 * city (so they fan out instead of stacking on one pixel) — not a state-wide ring. Callers
 * that need per-row jitter pass a `seed` (e.g. a stable hash of the row's id); omitting it
 * returns the raw city coordinate.
 */
import cityCoordsRaw from '@/data/us-city-coords.json';
import { STATE_CENTROIDS, jitter as stateJitter } from './state-centroids';
import { normalizeStateCode } from '@/lib/utils/us-states';

/** The bundled US-city table itself (~29.5K cities, GeoNames, keyed `UPPER(city)|STATE`) —
 *  exported so OTHER geocode paths that need extra precedence (e.g. the opp map's ZIP/OCONUS
 *  chain in `map-data.ts`) can share this ONE table instead of each bundling their own copy. */
export const CITY_COORDS = cityCoordsRaw as unknown as Record<string, [number, number]>;

export type GeocodePrecision = 'city' | 'state';

export type GeocodeResult = {
  lat: number;
  lng: number;
  precision: GeocodePrecision;
};

/** Small deterministic offset (~1km per step) so rows sharing one exact city coordinate
 *  don't perfectly overlap into a single dot. Bounded, not a ring — stays within the city. */
function cityJitter([lat, lng]: [number, number], seed: number): [number, number] {
  const s = seed % 12;
  return [lat + (s - 6) * 0.011, lng + (((s * 5) % 12) - 6) * 0.011];
}

/**
 * Resolve {lat,lng,precision} for a city+state pair.
 * - `precision:'city'` — exact match in the bundled GeoNames table.
 * - `precision:'state'` — city unknown/empty; honest state-centroid fallback.
 * - `null` — state itself isn't recognized (never fabricate ANY coordinate).
 *
 * `seed` (optional): a stable per-row integer (e.g. hash of an id/UEI) used to jitter
 * multiple hits at the SAME point so they don't stack. Omit for a single lookup.
 */
export function geocodeCity(
  city: string | null | undefined,
  state: string | null | undefined,
  seed?: number,
): GeocodeResult | null {
  const st = normalizeStateCode(state || '');
  if (!st) return null;

  const cityName = (city || '').trim();
  if (cityName) {
    const hit = CITY_COORDS[`${cityName.toUpperCase()}|${st}`];
    if (hit) {
      const [lat, lng] = seed !== undefined ? cityJitter(hit, seed) : hit;
      return { lat, lng, precision: 'city' };
    }
  }

  const base = STATE_CENTROIDS[st];
  if (!base) return null;
  const [lat, lng] = stateJitter(base, seed ?? 0);
  return { lat, lng, precision: 'state' };
}

/** Stable small integer seed from a string (e.g. a UEI/contract_id/notice_id) — so a row's
 *  jittered coordinate is deterministic across requests/backfill runs. */
export function stableSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
