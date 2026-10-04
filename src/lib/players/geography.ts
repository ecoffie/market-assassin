/**
 * Viewport → Players geography scope, resolved BEFORE the query ranks anything.
 *
 * State level: the states the viewport overlaps (centroid-based, capped). If the cap drops states,
 * the answer is a floor and must say so.
 *
 * Sub-state level: when the viewport covers only PART of a state, the query is restricted to the
 * geocodable cities inside the box. Without this, a zoomed-in view ranked the whole state and then
 * kept what fell in the box — rank-then-filter again, one level down (a Fresno view of 541330 would
 * show only the CA firms that happen to be in the state's top 300 by $).
 *
 * Firms whose HQ city is not in the geocode table are placed at the state centroid; they are kept
 * only when that centroid is in view, which is exactly when the map would draw them.
 */
import { CITY_COORDS, CITY_JITTER_MAX_DEG } from '@/lib/geo/city-geocode';
import { STATE_CENTROIDS, statesOverlappingBbox } from '@/lib/geo/state-centroids';

export type Bbox = [number, number, number, number]; // west, south, east, north

export const PLAYERS_MAX_STATES = 6;

export interface StateGeoScope {
  state: string;
  /** undefined = the whole state is in view (state-level filter only). */
  cities?: string[];
  includeUngeocodedCities?: boolean;
  knownCities?: string[];
}

export interface PlayersGeoScope {
  states: StateGeoScope[];
  /** States that overlap the viewport but were dropped by the fan-out cap. */
  droppedStates: string[];
}

function inBox(lat: number, lng: number, b: Bbox): boolean {
  return lat >= b[1] && lat <= b[3] && lng >= b[0] && lng <= b[2];
}

let _citiesByState: Map<string, Array<{ city: string; lat: number; lng: number }>> | null = null;
function citiesByState() {
  if (_citiesByState) return _citiesByState;
  const m = new Map<string, Array<{ city: string; lat: number; lng: number }>>();
  for (const [k, [lat, lng]] of Object.entries(CITY_COORDS)) {
    const i = k.lastIndexOf('|');
    if (i < 0) continue;
    const st = k.slice(i + 1);
    const list = m.get(st) || [];
    list.push({ city: k.slice(0, i), lat, lng });
    m.set(st, list);
  }
  _citiesByState = m;
  return m;
}

/** A city counts as visible when ANY of its pins could be drawn inside the box: its point, padded by
 *  the placement jitter. Testing the bare point dropped every Richmond firm from a Richmond view
 *  (the city's point sits 0.003° south of that box while its pins draw inside it). The route's
 *  final in-box check on the drawn position still decides what is shown. */
function padded(b: Bbox, d: number): Bbox {
  return [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
}

export function stateGeoScope(state: string, bbox: Bbox): StateGeoScope {
  const all = citiesByState().get(state) || [];
  if (all.length === 0) return { state };
  const near = padded(bbox, CITY_JITTER_MAX_DEG);
  const visible = all.filter((c) => inBox(c.lat, c.lng, near)).map((c) => c.city);
  if (visible.length === all.length) return { state }; // whole state in view
  const centroid = STATE_CENTROIDS[state];
  const centroidInView = !!centroid && inBox(centroid[0], centroid[1], bbox);
  return {
    state,
    cities: visible,
    includeUngeocodedCities: centroidInView,
    knownCities: centroidInView ? all.map((c) => c.city) : undefined,
  };
}

/**
 * An explicit `?state=` is a FILTER and the viewport is the VIEW: the pins come from the state ∩ the
 * visible cities, filtered before ranking. It used to be applied state-wide, so a Richmond view of
 * 541512/VA ranked Virginia's top 300 and then cropped to the box — 0 shown, 17 real firms there
 * (P1, 2026-10-04). The route keeps the state-wide count as a separate market-truth query.
 * Without an explicit state the viewport decides which states, down to the visible cities.
 */
export function resolvePlayersGeoScope(bbox: Bbox, explicitState?: string): PlayersGeoScope {
  if (explicitState) return { states: [stateGeoScope(explicitState, bbox)], droppedStates: [] };
  const overlapping = statesOverlappingBbox(bbox, 3, 99);
  const kept = overlapping.slice(0, PLAYERS_MAX_STATES);
  return {
    states: kept.map((s) => stateGeoScope(s, bbox)),
    droppedStates: overlapping.slice(PLAYERS_MAX_STATES),
  };
}
