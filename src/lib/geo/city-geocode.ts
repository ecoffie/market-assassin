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

/**
 * `true` when `city` is a real GeoNames city inside US `state` (a confirmed city↔state
 * pairing). A foreign city ("Seoul") or a city that isn't in the given state fails this —
 * so callers can refuse to render an incoherent "City, WrongState".
 */
export function isCityInState(city: string | null | undefined, state: string | null | undefined): boolean {
  const st = normalizeStateCode(state || '');
  if (!st) return false;
  const cityName = (city || '').trim();
  if (!cityName) return false;
  return !!CITY_COORDS[`${cityName.toUpperCase()}|${st}`];
}

export type BuyerLocation = {
  /** Confirmed US 2-letter state (always present — a pin/card without one is skipped upstream). */
  state: string;
  /** A city ONLY when it's a real GeoNames city inside `state`. '' when the city was foreign,
   *  mismatched, or absent — so the render never shows "ForeignCity, WrongState". */
  city: string;
  /** '' → render "City, ST"; a note (e.g. "buying office") → render "ST (buying office)". */
  approxNote: string;
};

/**
 * Resolve ONE coherent US location for a Gov Buyer from a notice's place-of-performance
 * (pop_city/pop_state) and the buying office (office_city/office_state).
 *
 * The bug this fixes ("Seoul, DC"): State-Dept POCs sit on notices whose place of
 * performance is an OVERSEAS post — pop_city="Seoul", pop_state="KR-11" (a foreign ISO
 * subdivision, NOT a US state) — bought by an office in Washington (office_state="DC").
 * The old code took the pop CITY and, because "KR-11" isn't a US state, fell the STATE
 * back to the office's "DC" — pairing a foreign city with a US state it isn't in.
 *
 * The honest rule here:
 *  1. If pop_state is a real US state AND pop_city is a real city IN that state → use the
 *     pop city+state (the true place of performance).
 *  2. Else if pop_state is a real US state (but the city doesn't validate) → use pop_state
 *     with NO city (state-level, honest).
 *  3. Else (pop is foreign / unusable) → fall back to the OFFICE. City is kept only if it's
 *     a real city IN the office state; otherwise state-only, noted as "buying office".
 *  4. If neither yields a real US state → null (no pin; never fabricate a location).
 *
 * A foreign city is NEVER paired with a US state, and a city is only ever shown when it's
 * confirmed to sit in the resolved state (validated against the GeoNames table).
 */
export function resolveBuyerLocation(input: {
  popCity?: string | null;
  popState?: string | null;
  officeCity?: string | null;
  officeState?: string | null;
}): BuyerLocation | null {
  const popSt = normalizeStateCode(input.popState || '');
  const offSt = normalizeStateCode(input.officeState || '');

  // 1/2 — place of performance is a real US state.
  if (popSt) {
    if (isCityInState(input.popCity, popSt)) {
      return { state: popSt, city: (input.popCity || '').trim(), approxNote: '' };
    }
    return { state: popSt, city: '', approxNote: '' };
  }

  // 3 — pop is foreign/unusable → the buying office is the only honest US anchor.
  if (offSt) {
    if (isCityInState(input.officeCity, offSt)) {
      return { state: offSt, city: (input.officeCity || '').trim(), approxNote: 'buying office' };
    }
    return { state: offSt, city: '', approxNote: 'buying office' };
  }

  // 4 — no real US state anywhere → no location.
  return null;
}

/** Stable small integer seed from a string (e.g. a UEI/contract_id/notice_id) — so a row's
 *  jittered coordinate is deterministic across requests/backfill runs. */
export function stableSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
