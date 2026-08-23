/**
 * Opportunity Map data — live `sam_opportunities` → pinned points for the Leaflet map.
 * Ported from Eric's evc-opportunity-map prototype: same shape, but LIVE data +
 * state-centroid geocoding (the prototype baked lat/lng; we derive it from the state).
 */
import { getReadClient } from '@/lib/supabase/server-clients';
import { multiAgency, agencyOrExpr } from './agency-match';
import { resolveQueryIntent, setAsideOrExpr, keywordOrExpr, pscToNaicsCodes } from '@/lib/search/query-intent';
import { STATE_CENTROIDS, jitter } from '@/lib/geo/state-centroids';
// CITY_COORDS is the shared board-wide table (also backs contacts-map + recompete-map via
// `geocodeCity()`) — imported from the ONE shared lib so every map surface reads the same
// ~29.5K-city GeoNames data, not a duplicate copy. This module keeps its OWN richer precedence
// chain (ZIP → OCONUS → office fallback) that the simpler shared `geocodeCity()` doesn't need.
import { CITY_COORDS } from '@/lib/geo/city-geocode';
import { normalizeStateCode } from '@/lib/utils/us-states';
import zipCoordsRaw from '@/data/us-zip-coords.json';
import worldCityRaw from '@/data/world-city-coords.json';
import countryCentroidRaw from '@/data/country-centroids.json';
import iso3to2Raw from '@/data/iso3-to-iso2.json';
// DIBBS RFQs carry no geography — location is derived from the DoDAAC prefix of the
// solicitation number. See that file's header for how each office was grounded.
import { getDlaOfficeLocation, getUnmappedDodaacs } from '@/data/dla-dodaac-locations';

// Real coords from GeoNames (public domain). ZIP is the cleanest, most-complete key
// (office zip ~99.5% filled); city covers place-of-performance where we only have a name.
const ZIP_COORDS = zipCoordsRaw as unknown as Record<string, [number, number]>;
// OCONUS: foreign place-of-performance. City key "NAME|ISO2"; else the country centroid (ISO3).
const WORLD_CITY = worldCityRaw as unknown as Record<string, [number, number]>;
const COUNTRY_CENTROID = countryCentroidRaw as unknown as Record<string, [number, number]>;
const ISO3_TO_ISO2 = iso3to2Raw as unknown as Record<string, string>;

/**
 * Every spelling of "this is domestic" the sources actually emit.
 *
 * THE BUG (2026-08-01): this test used to be `iso3 !== 'USA' && iso3 !== 'US'`, which was
 * true for SAM (ISO3 codes) and silently wrong for everything else. The forecast portals
 * write the country out in full — Treasury/HHS/NASA/EPA all store "United States" — so
 * every one of those rows took the FOREIGN branch, missed ISO3_TO_ISO2["UNITED STATES"],
 * and returned no pin. Treasury had 198 clean 2-letter states and mapped 0 of 200.
 *
 * A guard checked against ONE input shape reads as a working guard. Any new country
 * spelling belongs here, not in a caller-side cleanup.
 */
const DOMESTIC_COUNTRY = new Set([
  'USA', 'US', 'U.S.', 'U.S.A.',
  'UNITED STATES', 'UNITED STATES OF AMERICA',
]);

// Tiny deterministic offset (~1km) so multiple opps at the same point don't perfectly stack.
function cityJitter([lat, lng]: [number, number], seed: number): [number, number] {
  const s = seed % 12;
  return [lat + (s - 6) * 0.011, lng + (((s * 5) % 12) - 6) * 0.011];
}

/** Resolve a real coordinate for an opp, most-precise source first:
 *  place-of-performance city → buying-office ZIP → buying-office city. Returns the
 *  matched city label + state so the pin's text agrees with its location. */
// 'pop' = the coordinate is the actual place of performance (incl. overseas); 'office' = we
// fell back to the BUYING OFFICE because SAM omitted the place of performance (~64% of notices).
// The UI labels/styles these differently so an office-fallback pin isn't read as confirmed PoP.
export type LocSource = 'pop' | 'office';
export function geocode(
  popCity: string, popState: string | null,
  office: { city?: string; state?: string; zipcode?: string } | null,
  popZip?: string | null,
  popCountry?: string | null,
): { coord: [number, number] | null; city: string; state: string | null; source: LocSource | null } {
  // OCONUS: when place-of-performance is a FOREIGN country, resolve to its real location —
  // never fall through to the US buying office (that put Rome/Jeddah/Vienna in Washington DC).
  const iso3 = (popCountry || '').toUpperCase().trim();
  if (iso3 && !DOMESTIC_COUNTRY.has(iso3)) {
    const iso2 = ISO3_TO_ISO2[iso3];
    if (popCity && iso2) {
      const wc = WORLD_CITY[`${popCity.toUpperCase().trim()}|${iso2}`];
      if (wc) return { coord: wc, city: popCity.trim(), state: iso3, source: 'pop' };
    }
    const cc = COUNTRY_CENTROID[iso3];
    if (cc) return { coord: cc, city: popCity ? popCity.trim() : '', state: iso3, source: 'pop' };
    // Foreign but unknown country → no pin (honest; do NOT place on US soil).
    return { coord: null, city: '', state: null, source: null };
  }
  if (popCity && popState) {
    const c = CITY_COORDS[`${popCity.toUpperCase()}|${popState}`];
    if (c) return { coord: c, city: popCity, state: popState, source: 'pop' };
  }
  // Place-of-performance ZIP — more precise than the buying office, so it comes next.
  if (popZip) {
    const z = String(popZip).replace(/\D/g, '').slice(0, 5);
    const c = ZIP_COORDS[z];
    if (c) return { coord: c, city: popCity.trim(), state: popState, source: 'pop' };
  }
  const oState = normalizeStateCode(office?.state || '');
  if (office?.zipcode) {
    const z = String(office.zipcode).replace(/\D/g, '').slice(0, 5);
    const c = ZIP_COORDS[z];
    if (c) return { coord: c, city: (office.city || '').trim(), state: oState, source: 'office' };
  }
  if (office?.city && oState) {
    const c = CITY_COORDS[`${office.city.trim().toUpperCase()}|${oState}`];
    if (c) return { coord: c, city: office.city.trim(), state: oState, source: 'office' };
  }
  // No coord match → state-centroid fallback in resolvePinCoord. Source follows the state we'll
  // use: the pop state (performed-in-state) if we have it, else the office state.
  return { coord: null, city: '', state: popState || oState, source: popState ? 'pop' : (oState ? 'office' : null) };
}

/** Stable small integer seed from a string (notice_id) — so a row's jittered coordinate is
 *  DETERMINISTIC across backfill runs, not dependent on its position in a result set. */
function stableSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Resolve the FINAL stored pin coordinate for a row (city/ZIP if placeable, else state
 *  centroid, else null). Used by the backfill + sync-time stamp so map_lat/map_lng agree
 *  with what getMapOpportunities would have drawn. Deterministic per notice_id. */
export function resolvePinCoord(row: {
  notice_id?: string | null; title?: string | null;
  pop_city?: string | null; pop_state?: string | null; pop_zip?: string | null;
  pop_country?: string | null;
  office_address?: { city?: string; state?: string; zipcode?: string } | null;
}): { lat: number; lng: number; state: string; city: string; source: LocSource } | null {
  const popState = normalizeStateCode((row.pop_state as string) || '');
  const popCity = ((row.pop_city as string) || '').trim();
  const office = (row.office_address as { city?: string; state?: string; zipcode?: string } | null) || null;
  const g = geocode(popCity, popState, office, row.pop_zip || null, row.pop_country || null);
  const state = g.state;
  if (!state) return null;
  const source: LocSource = g.source ?? 'office';
  const seed = stableSeed(String(row.notice_id ?? row.title ?? ''));
  if (g.coord) {
    const [lat, lng] = cityJitter(g.coord, seed);
    return { lat, lng, state, city: g.city, source };
  }
  const base = STATE_CENTROIDS[state];
  if (!base) return null;
  const [lat, lng] = jitter(base, seed);
  return { lat, lng, state, city: g.city, source };
}

/** Set-aside groups — key, display label, pin color. Colors mirror the prototype's palette. */
export const SET_GROUPS: Array<{ key: string; label: string; color: string; codes: string[] }> = [
  { key: 'SDVOSB', label: 'SDVOSB', color: '#10b981', codes: ['SDVOSBC', 'SDVOSBS', 'VSA', 'VSB', 'SDVOSB'] },
  { key: 'SB', label: 'Small Business', color: '#3b82f6', codes: ['SBA', 'SBP', 'SB'] },
  { key: '8A', label: '8(a)', color: '#a855f7', codes: ['8A', '8AN', '8(A)'] },
  { key: 'WOSB', label: 'WOSB / EDWOSB', color: '#ef4444', codes: ['WOSB', 'WOSBSS', 'EDWOSB', 'EDWOSBSS'] },
  { key: 'HZ', label: 'HUBZone', color: '#f59e0b', codes: ['HZC', 'HZS'] },
  { key: 'OTHER', label: 'Other set-aside', color: '#c084fc', codes: ['ISBEE', 'BI', 'BICIV', 'IEE'] },
  { key: 'NONE', label: 'Unrestricted', color: '#94a3b8', codes: ['NONE', '—', ''] },
];

const CODE_TO_GROUP = new Map<string, string>();
for (const g of SET_GROUPS) for (const c of g.codes) CODE_TO_GROUP.set(c, g.key);

export function setGroupKey(code: string | null | undefined): string {
  const c = (code || '').toUpperCase().trim();
  return CODE_TO_GROUP.get(c) ?? 'NONE';
}
export const SET_COLOR: Record<string, string> = Object.fromEntries(SET_GROUPS.map((g) => [g.key, g.color]));
export const SET_LABEL: Record<string, string> = Object.fromEntries(SET_GROUPS.map((g) => [g.key, g.label]));

/** NAICS 2-digit sector → clean "service line" category (the filter axis). */
const SECTOR: Record<string, string> = {
  '11': 'Agriculture', '21': 'Mining & Energy', '22': 'Utilities', '23': 'Construction',
  '31': 'Manufacturing', '32': 'Manufacturing', '33': 'Manufacturing', '42': 'Wholesale',
  '44': 'Retail', '45': 'Retail', '48': 'Transportation & Logistics', '49': 'Transportation & Logistics',
  '51': 'Information & Media', '52': 'Finance', '53': 'Real Estate', '54': 'Professional & Technical',
  '55': 'Management', '56': 'Facilities & Admin Support', '61': 'Education', '62': 'Healthcare',
  '71': 'Arts & Recreation', '72': 'Food & Lodging', '81': 'Other Services', '92': 'Public Administration',
};
export function naicsCategory(naics: string | null | undefined): string {
  const n = (naics || '').trim();
  // IT lives under 5415 but reads as its own line to a GovCon buyer
  if (n.startsWith('5415') || n.startsWith('5182') || n.startsWith('5112')) return 'IT & Cyber';
  return SECTOR[n.slice(0, 2)] ?? 'Other';
}

/** Pin provenance. 'SAM' = sam_opportunities; 'DLA' = DIBBS small-buy RFQs (dibbs_rfqs).
 *  The map UI already styles/filters all three (SRCLABEL + .chip.SAM/.DLA/.RECOMPETE). */
export type MapSrc = 'SAM' | 'DLA' | 'FORECAST' | 'GRANTS';

export type MapOpp = {
  id: string; title: string; agency: string; set: string; setLabel: string;
  naics: string; cat: string; loc: string; close: string | null; sol: string;
  uiLink: string | null; lat: number; lng: number; src: MapSrc; locSrc: LocSource;
  // SOW card facts (Tier 1) — present only once the row has been precomputed AND has
  // brandNameOrEqual/evalBasis/setAsideFromText content worth showing. undefined otherwise
  // (never fabricated — the extractor already nulls out fields it can't ground).
  brandNameOrEqual?: boolean;
  evalBasis?: 'best_value' | 'lpta' | 'tradeoff' | null;
  // Forecast pins carry their estimated ceiling here so the client's pinMoney(o.est) shows a
  // $ tag (forecasts aren't posted, so there's no M-Estimate — the ceiling IS the number).
  est?: number;
  // Forecast pins ALSO carry the agency's OWN published estimate as a verbatim string (Eric
  // 2026-08-04: "the forecast should have real numbers not m estimate"). This is a REAL government
  // figure (agency_forecasts.estimated_value_range, 97.6% populated) — the Expanded Decision Card
  // shows it WITHOUT the ≈ glyph, unlike an open opp's modeled M-Estimate. '' when the agency
  // published no value (2.4%) → the card shows an honest "Estimate pending", never a fabricated one.
  estRange?: string;
};

/**
 * The agency's OWN published forecast value, as a display string — a REAL government figure, never
 * modeled (Eric 2026-08-04). Prefers the verbatim `estimated_value_range` the agency wrote (e.g.
 * "> $2M - < $7.5M", "$5M - $9.9M"); else composes a clean "$min–$max" (or a single "$max") from
 * the real min/max columns; else '' — NEVER a guessed number. No ≈ glyph anywhere: these are the
 * agency's figures, not Mindy's estimate. `estMoneyServer` mirrors the client estMoney() rounding
 * so a composed range reads like the rest of the app.
 */
export function estMoneyServer(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(n % 1e9 ? 1 : 0).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(n % 1e6 ? 1 : 0).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
}
export function forecastRangeText(r: Record<string, unknown>): string {
  const verbatim = String(r.estimated_value_range ?? '').trim();
  if (verbatim) {
    // Most agency_forecasts rows store a formatted range ("$20M to $50M", "Over $100M",
    // "$500K - $999K") — pass those THROUGH. But some store a BARE numeric string
    // ("99000000", "24,000,000") which was rendered as a giant raw integer in the map hero
    // (Eric screenshot 2026-08-08). A bare number = only digits/commas/whitespace/decimal
    // (no $, letter, or range separator) → format it with estMoneyServer ("$99M").
    if (!/[a-zA-Z$]/.test(verbatim) && !/[-–—]/.test(verbatim) && !/\bto\b/i.test(verbatim)) {
      const n = Number(verbatim.replace(/[,\s]/g, ''));
      if (Number.isFinite(n) && n > 0) return estMoneyServer(n);
    }
    return verbatim;
  }
  const lo = Number(r.estimated_value_min) || 0;
  const hi = Number(r.estimated_value_max) || 0;
  const loT = estMoneyServer(lo), hiT = estMoneyServer(hi);
  if (loT && hiT) return loT === hiT ? hiT : `${loT}–${hiT}`;
  return hiT || loT || '';
}

const BASE_MAP_COLS = 'notice_id, title, department, naics_code, set_aside_code, set_aside_description, response_deadline, ui_link, solicitation_number, pop_state, pop_city, pop_zip, pop_country, office_address';

/**
 * Live open opportunities with a pin. Ordered soonest-deadline first (most actionable),
 * capped for map performance. Geocoded by place-of-performance state, else buying-office state.
 */
export async function getMapOpportunities(limit = 600): Promise<MapOpp[]> {
  const sb = getReadClient();
  const today = new Date().toISOString().slice(0, 10);
  // sow_card_facts is requested SEPARATELY from the base columns: a single .select() naming a
  // column that doesn't exist yet (pre-migration — 20260726_sow_card_facts.sql) fails the WHOLE
  // query silently ([[postgrest_missing_column_nulls]]), which would take down map pins
  // entirely. Try WITH it first; on ANY error, retry withOUT it (map still works, just no
  // brand-name/eval-basis pills until the migration lands).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let error: any;
  ({ data, error } = await sb
    .from('sam_opportunities')
    .select(`${BASE_MAP_COLS}, sow_card_facts`)
    .eq('active', true)
    .gte('response_deadline', today)
    .order('response_deadline', { ascending: true })
    .limit(limit * 2)); // over-fetch; some rows drop for missing geo
  if (error) {
    ({ data, error } = await sb
      .from('sam_opportunities')
      .select(BASE_MAP_COLS)
      .eq('active', true)
      .gte('response_deadline', today)
      .order('response_deadline', { ascending: true })
      .limit(limit * 2));
  }
  if (error) throw new Error(`getMapOpportunities: ${error.message}`);

  const out: MapOpp[] = [];
  for (const r of (data || []) as Array<Record<string, unknown>>) {
    const title = String(r.title ?? '').trim();
    // No self-filtering — commodity buys are real opportunities and the goal is the most
    // complete dataset. The explorer offers a user toggle to hide FSC micro-buys instead.
    if (!title) continue;
    const office = r.office_address as { city?: string; state?: string; zipcode?: string } | null;
    const popState = normalizeStateCode((r.pop_state as string) || '');
    const popCity = ((r.pop_city as string) || '').trim();
    const g = geocode(popCity, popState, office, (r.pop_zip as string) || null, (r.pop_country as string) || null);
    const state = g.state;
    if (!state) continue; // no location → no pin (honest; not placed at 0,0)
    let lat: number, lng: number;
    if (g.coord) {
      [lat, lng] = cityJitter(g.coord, out.length + 1); // real city/ZIP coordinate
    } else {
      const base = STATE_CENTROIDS[state];
      if (!base) continue;
      [lat, lng] = jitter(base, out.length + 1); // state centroid fallback
    }
    const city = g.city;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cardFacts = r.sow_card_facts as any;
    out.push({
      id: String(r.notice_id ?? ''),
      title: String(r.title ?? 'Untitled opportunity'),
      agency: String(r.department ?? ''),
      set: setGroupKey(r.set_aside_code as string),
      setLabel: (r.set_aside_description as string) || SET_LABEL[setGroupKey(r.set_aside_code as string)],
      naics: String(r.naics_code ?? ''),
      cat: naicsCategory(r.naics_code as string),
      loc: city ? `${city}, ${state}` : state,
      close: (r.response_deadline as string) || null,
      sol: String(r.solicitation_number ?? ''),
      uiLink: (r.ui_link as string) || null,
      lat, lng, src: 'SAM', locSrc: g.source ?? 'office',
      ...(cardFacts?.brandNameOrEqual ? { brandNameOrEqual: true } : {}),
      ...(cardFacts?.evalBasis ? { evalBasis: cardFacts.evalBasis } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * DIBBS (DLA small-buy RFQ) pins — `src:'DLA'`, the third source the map UI already
 * styles and filters (SRCLABEL.DLA = "DLA supply", .chip.DLA, the "Where it came from"
 * toggle). Previously the backend never supplied any, so that filter was always empty.
 *
 * GEOGRAPHY: `dibbs_rfqs` has NO location column — location is derived from the 6-char
 * DoDAAC prefix of the solicitation number via DLA_DODAAC_LOCATIONS (see that file's header
 * for how those were grounded). That is the BUYING OFFICE, not place of performance, so
 * every pin is `locSrc:'office'` — the same honest flag SAM office-fallback pins carry.
 * Consequence: DIBBS pins cluster on a handful of DLA centers (Richmond / Philadelphia /
 * Columbus), NOT nationwide. An unmapped DoDAAC yields NO pin rather than a guessed one.
 *
 * Only OPEN RFQs (return_by_date >= today) are pinned — these are ~2-week-fuse quote
 * requests, so an expired one is noise on a map. Deadline-soonest first, like SAM.
 */
export async function getDibbsMapPins(limit = 400): Promise<MapOpp[]> {
  const sb = getReadClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('dibbs_rfqs')
    .select('solicitation_number, nsn, fsc, description, quantity, unit_of_issue, return_by_date, url')
    .gte('return_by_date', today)
    .order('return_by_date', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`getDibbsMapPins: ${error.message}`);

  const rows = (data || []) as Array<Record<string, unknown>>;
  // Surface DoDAACs we can't place — DLA adds buying activities over time and an unmapped
  // code silently vanishes from the map otherwise (a coverage gap that looks like "no data").
  const unmapped = getUnmappedDodaacs(rows.map((r) => r.solicitation_number as string));
  if (unmapped.length) {
    console.warn(`[map-data] DIBBS DoDAACs with no location mapping: ${unmapped.join(', ')} — add to src/data/dla-dodaac-locations.ts`);
  }

  const out: MapOpp[] = [];
  for (const r of rows) {
    const sol = String(r.solicitation_number ?? '').trim();
    if (!sol) continue;
    const office = getDlaOfficeLocation(sol);
    if (!office) continue; // unmapped DoDAAC → no pin (never a placeholder coordinate)
    const [lat, lng] = cityJitter(office.coords, stableSeed(sol));
    // DIBBS descriptions are terse NSN nomenclature ("ACLIP,HEADBAND HEL"); prefix the FSC
    // so the card reads like the FSC-titled SAM commodity notices users already see.
    const desc = String(r.description ?? '').trim();
    const fsc = String(r.fsc ?? '').trim();
    out.push({
      id: sol,
      title: desc ? (fsc ? `${fsc}-- ${desc}` : desc) : `RFQ ${sol}`,
      agency: office.office, // real DLA center name (dodaac_directory + USASpending agree)
      // DIBBS carries no set-aside field — 'NONE' is the honest value, not an assumption
      // that these are unrestricted-by-policy. The UI shows it under "Unrestricted".
      set: 'NONE',
      setLabel: SET_LABEL.NONE,
      naics: '', // DIBBS is FSC/NSN-coded, not NAICS — leave empty rather than cross-walk a guess
      cat: 'DLA Supply/Parts', // the category the map template already colors (--dla)
      loc: `${office.city}, ${office.state}`,
      close: (r.return_by_date as string) || null,
      sol,
      uiLink: (r.url as string) || null,
      lat, lng, src: 'DLA',
      locSrc: 'office', // buying office, never confirmed place of performance
    });
  }
  return out;
}

/**
 * Resolve the PERSISTED map fields for a DIBBS solicitation from its DoDAAC prefix —
 * the SAME coords getDibbsMapPins() derives at read time (office coords + stable
 * per-sol jitter), so a backfilled row renders identically. Returns null when the
 * DoDAAC isn't in the location map (→ leave lat/lng NULL: an honest gap, never a fake
 * pin). Used by scripts/backfill-dibbs-latlng.ts AND the sync (new rows), so the map
 * can bbox-query DIBBS in SQL like SAM instead of the old global-top-400 + JS-filter
 * (the rank-then-filter bug that hid most open DLA bids). (Eric 2026-07-30 — "everything
 * on the map so people can find + bid".)
 */
export function resolveDibbsLocation(
  solicitationNumber: string,
): { map_lat: number; map_lng: number; map_office: string; map_loc: string } | null {
  const sol = (solicitationNumber || '').trim();
  if (!sol) return null;
  const office = getDlaOfficeLocation(sol);
  if (!office) return null;
  const [map_lat, map_lng] = cityJitter(office.coords, stableSeed(sol));
  return { map_lat, map_lng, map_office: office.office, map_loc: `${office.city}, ${office.state}` };
}

/**
 * VIEWPORT DIBBS pins — open RFQs whose PERSISTED coords fall in the bbox, filtered in
 * SQL (bbox BEFORE the limit) so EVERY open DLA bid in the current view renders, not a
 * global top-400 subset (the rank-then-filter bug this replaces). Reads the map_lat/
 * map_lng/map_office/map_loc columns (backfill-dibbs-latlng.ts + the sync populate them).
 * Deadline-soonest first, capped at `limit` (the map clusters when a view is dense).
 * (Eric 2026-07-30 — "everything on the map so people can find + bid".)
 */
export async function getDibbsViewportPins(
  bbox: { west: number; south: number; east: number; north: number },
  limit = 1000,
  fsc?: string[] | null,
): Promise<MapOpp[]> {
  const sb = getReadClient();
  const today = new Date().toISOString().slice(0, 10);
  let q = sb
    .from('dibbs_rfqs')
    .select('solicitation_number, fsc, description, return_by_date, url, map_lat, map_lng, map_office, map_loc')
    .gte('return_by_date', today)
    .not('map_lat', 'is', null)
    .gte('map_lat', bbox.south).lte('map_lat', bbox.north)
    .gte('map_lng', bbox.west).lte('map_lng', bbox.east);
  // FSC (Federal Supply Class) filter — DLA's REAL taxonomy (DIBBS is FSC/NSN-coded, not
  // NAICS). A 4-digit code (5330) is an exact class; a 2-digit prefix (53) is the whole
  // FSC group (Hardware & Abrasives). OR across the given codes. (Eric 2026-07-30 — the
  // "find bids I can make" lever for DLA.)
  if (fsc && fsc.length) {
    const ors = fsc.map((c) => (c.length >= 4 ? `fsc.eq.${c}` : `fsc.like.${c}%`)).join(',');
    q = q.or(ors);
  }
  const { data, error } = await q
    .order('return_by_date', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`getDibbsViewportPins: ${error.message}`);

  const out: MapOpp[] = [];
  for (const r of (data || []) as Array<Record<string, unknown>>) {
    const sol = String(r.solicitation_number ?? '').trim();
    if (!sol) continue;
    const desc = String(r.description ?? '').trim();
    const fsc = String(r.fsc ?? '').trim();
    out.push({
      id: sol,
      title: desc ? (fsc ? `${fsc}-- ${desc}` : desc) : `RFQ ${sol}`,
      agency: String(r.map_office ?? 'DLA'),
      set: 'NONE',
      setLabel: SET_LABEL.NONE,
      naics: '',
      cat: 'DLA Supply/Parts',
      loc: String(r.map_loc ?? ''),
      close: (r.return_by_date as string) || null,
      sol,
      uiLink: (r.url as string) || null,
      lat: r.map_lat as number,
      lng: r.map_lng as number,
      src: 'DLA',
      locSrc: 'office',
    });
  }
  return out;
}

/**
 * FORECAST viewport pins — the "coming work" horizon on the Opportunities map (Eric 2026-07-30).
 * agency_forecasts are UPCOMING procurements (6–18mo out), so they carry no solicitation to bid
 * yet — the $ is the estimated ceiling, the timing is "anticipated Q<n> FY<yr>". Reads the
 * persisted map_lat/map_lng (backfill-forecast-latlng.ts fills them via resolvePinCoord). bbox in
 * SQL before the limit, like SAM/DIBBS. src:'FORECAST' → violet horizon pin; no uiLink (nothing
 * to bid yet). Value = estimated_value_max (the ceiling; 99% populated).
 */
export interface ForecastFilters { q?: string | null; naics?: string | null; agency?: string | null; state?: string | null }

/**
 * Apply the SEARCH BRAIN + filters to an agency_forecasts query (shared by the pins query AND the
 * headline count so they can never disagree). Resolves the typed `q` into an intent and applies the
 * SAME meaning as SAM/recompete: set-aside term → set_aside_type, NAICS → naics_code, PSC → psc_code,
 * free text → multi-term OR on title/naics_description/department/description. (Eric 2026-08-01.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyForecastFilters(query: any, filters?: ForecastFilters): any {
  const kw = (filters?.q || '').trim();
  if (kw) {
    const intent = resolveQueryIntent(kw);
    if (intent.kind === 'setAside' && intent.setAside) {
      const expr = setAsideOrExpr(intent.setAside, { textCols: ['set_aside_type'] });
      if (expr) query = query.or(expr);
    } else if (intent.kind === 'naics' && intent.naics?.length) {
      // Same rule as map-filters.ts: < 6 widens by prefix, a full 6-digit code is exact. These two
      // paths disagreed on 5-digit codes until 2026-08-23.
      query = query.or(intent.naics.map((c) => (c.length < 6 ? `naics_code.like.${c}%` : `naics_code.eq.${c}`)).join(','));
    } else if (intent.kind === 'psc' && intent.psc) {
      // agency_forecasts.psc_code is ~0.6% populated → a real PSC filter is a dead filter. CROSSWALK
      // the PSC to its equivalent NAICS (forecast naics is well-populated) and filter by industry.
      // No mapping → keyword fallback. (The brain solve; never a fabricated/empty match.)
      const xw = pscToNaicsCodes(intent.psc);
      if (xw.length) query = query.or(xw.map((c) => `naics_code.eq.${c}`).join(','));
      else { const kwExpr = keywordOrExpr(kw, ['title', 'naics_description', 'department', 'description']); if (kwExpr) query = query.or(kwExpr); }
    } else {
      const kwExpr = keywordOrExpr(kw, ['title', 'naics_description', 'department', 'description']);
      if (kwExpr) query = query.or(kwExpr);
    }
  }
  const naics = (filters?.naics || '').trim();
  if (naics) {
    const codes = naics.split(',').map((c) => c.trim()).filter(Boolean);
    if (codes.length) query = query.or(codes.map((c) => (c.length >= 6 ? `naics_code.eq.${c}` : `naics_code.like.${c}%`)).join(','));
  }
  // Agency multi-select (pipe-joined; both word orders) → forecast's `department` column.
  // Match on BOTH columns. `department` is NULL for over half the corpus — NAVY
  // (8,821), HHS (3,643) and USACE (2,908) all store the agency in
  // `source_agency` only — so filtering on `department` alone silently returned
  // ZERO for those sources, on the map and in alerts alike. Found 2026-08-02
  // while wiring forecast alerts: a saved search for HHS forecasts matched
  // nothing at all.
  const needles = multiAgency(filters?.agency || '');
  const agencyExpr = [agencyOrExpr('department', needles), agencyOrExpr('source_agency', needles)]
    .filter(Boolean).join(',');
  if (agencyExpr) query = query.or(agencyExpr);
  const state = (filters?.state || '').trim();
  if (state) query = query.eq('pop_state', state.toUpperCase());
  return query;
}

export async function getForecastViewportPins(
  bbox: { west: number; south: number; east: number; north: number },
  limit = 1000,
  filters?: ForecastFilters,
): Promise<MapOpp[]> {
  const sb = getReadClient();
  let query = sb
    .from('agency_forecasts')
    .select('id, title, department, source_agency, naics_code, naics_description, set_aside_type, estimated_value_min, estimated_value_max, estimated_value_range, anticipated_quarter, fiscal_year, anticipated_award_date, pop_state, pop_city, map_lat, map_lng, map_loc_source')
    .not('map_lat', 'is', null)
    .gte('map_lat', bbox.south).lte('map_lat', bbox.north)
    .gte('map_lng', bbox.west).lte('map_lng', bbox.east);
  query = applyForecastFilters(query, filters);
  const { data, error } = await query
    // Soonest anticipated award first (most actionable "position now"), nulls last.
    .order('anticipated_award_date', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`getForecastViewportPins: ${error.message}`);

  const out: MapOpp[] = [];
  for (const r of (data || []) as Array<Record<string, unknown>>) {
    const id = String(r.id ?? '').trim();
    if (!id) continue;
    const agency = String(r.department || r.source_agency || 'Federal agency');
    const city = String(r.pop_city || '').trim();
    const st = String(r.pop_state || '').trim();
    const q = String(r.anticipated_quarter || '').replace(/^Q?/, 'Q');
    const fy = String(r.fiscal_year || '').replace(/^FY/i, '');
    const timing = q && q !== 'Qnull' && fy && fy !== 'null' ? `${q} FY${fy}` : (fy && fy !== 'null' ? `FY${fy}` : 'upcoming');
    out.push({
      id: 'fc-' + id,
      title: String(r.title || 'Forecast opportunity'),
      agency,
      set: (r.set_aside_type ? String(r.set_aside_type) : 'NONE'),
      setLabel: (r.set_aside_type ? String(r.set_aside_type) : SET_LABEL.NONE),
      naics: String(r.naics_code || ''),
      cat: 'Forecast · ' + timing,
      loc: city ? `${city}, ${st}` : (st || ''),
      // No close/deadline — forecasts aren't posted yet. Carry the anticipated date as `close`
      // so the card can show "anticipated <date>" (the client reads close as the timing line).
      close: (r.anticipated_award_date as string) || null,
      sol: '',
      uiLink: null,             // nothing to bid yet — no "View sol" on forecast pins
      lat: r.map_lat as number,
      lng: r.map_lng as number,
      src: 'FORECAST',
      locSrc: (r.map_loc_source === 'city') ? 'pop' : 'office',
      est: Number(r.estimated_value_max) || 0,   // the ceiling → the pin's $ tag (via pinMoney)
      estRange: forecastRangeText(r),            // the agency's OWN published value (no ≈) → the card hero
    });
  }
  return out;
}

/**
 * UNPLACED forecasts — the ~43% of agency_forecasts (14,353 of 33,075 as of 2026-08-02) with NO
 * map coordinate (agency said "TBD"/"vendor's facility", withheld it, or published no location
 * field). They are REAL, current upcoming buys — the only thing they lack is a lat/lng, so they
 * cannot be a pin. Instead of exiling them to a standalone dead-end page (the old "Unplaced" view),
 * we return them as LIST-ONLY rows (lat/lng null → the map renders them in the results panel, no
 * pin) so a forecast surfaces WHEREVER a user searches its NAICS/agency (Eric 2026-08-02: "a way
 * people can see this data as part of their search results without it being spatial on the map").
 *
 * Same MapOpp shape + same SEARCH BRAIN (applyForecastFilters) as the placed pins, so the client's
 * toRow renders them identically. NO bbox — they have no location to be inside one. `locSrc:'none'`
 * + a `noLoc` reason so the card can honestly say "no location yet" rather than an empty place.
 */
export type UnplacedForecastRow = {
  id: string; title: string; agency: string; set: string; setLabel: string;
  naics: string; cat: string; noLoc: string; close: string | null; est: number; estRange: string;
};

export async function getUnplacedForecastRows(
  limit = 200,
  filters?: ForecastFilters,
): Promise<UnplacedForecastRow[]> {
  const sb = getReadClient();
  let query = sb
    .from('agency_forecasts')
    .select('id, title, department, source_agency, naics_code, set_aside_type, estimated_value_min, estimated_value_max, estimated_value_range, anticipated_quarter, fiscal_year, anticipated_award_date, pop_city, pop_state')
    .is('map_lat', null);
  query = applyForecastFilters(query, filters);
  const { data, error } = await query
    .order('anticipated_award_date', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`getUnplacedForecastRows: ${error.message}`);

  const out: UnplacedForecastRow[] = [];
  for (const r of (data || []) as Array<Record<string, unknown>>) {
    const id = String(r.id ?? '').trim();
    if (!id) continue;
    const agency = String(r.department || r.source_agency || 'Federal agency');
    const q = String(r.anticipated_quarter || '').replace(/^Q?/, 'Q');
    const fy = String(r.fiscal_year || '').replace(/^FY/i, '');
    const timing = q && q !== 'Qnull' && fy && fy !== 'null' ? `${q} FY${fy}` : (fy && fy !== 'null' ? `FY${fy}` : 'upcoming');
    // Why no pin — ONLY from real columns (there is no free-text place field). Rows have map_lat
    // null; pop_state/pop_city carry the reason: a bracketed sentinel "[Nationwide]", a note like
    // "Cannot be disclosed", or nothing. Read BOTH, strip brackets, and NEVER fabricate a reason —
    // a null place is "No location published", not a guessed city. (Verified against live rows.)
    const placeTxt = (String(r.pop_city || '').trim() + ' ' + String(r.pop_state || '').trim()).replace(/[[\]]/g, '').trim();
    const noLoc = /nationwide|various|multiple|worldwide/i.test(placeTxt) ? 'Nationwide'
      : /disclos|withheld|tbd|to be determined/i.test(placeTxt) ? 'Location not disclosed'
      : (placeTxt && !/^usa$/i.test(placeTxt) ? placeTxt : 'No location published');
    out.push({
      id: 'fc-' + id,
      title: String(r.title || 'Forecast opportunity'),
      agency,
      set: (r.set_aside_type ? String(r.set_aside_type) : 'NONE'),
      setLabel: (r.set_aside_type ? String(r.set_aside_type) : SET_LABEL.NONE),
      naics: String(r.naics_code || ''),
      cat: 'Forecast · ' + timing,
      noLoc,
      close: (r.anticipated_award_date as string) || null,
      est: Number(r.estimated_value_max) || 0,
      estRange: forecastRangeText(r),
    });
  }
  return out;
}

/**
 * Grants layer of the Opportunities map. Reads the STORED grants_cache (scripts/ingest-grants.ts
 * fills it from Grants.gov, pinned at the awarding department's HQ — grants have no place of
 * performance, so the coord is honestly "agency HQ · approximate"). bbox-filtered in SQL, same as
 * SAM/DIBBS/forecasts. Grants are apply-for-now funding → they ride the green/"open" horizon
 * (src:'GRANTS' is the FILTER; the pin color stays open-green via srcColor's else branch).
 * award_ceiling is often NULL at Grants.gov → est=0 → the pin shows a dot, not a $ tag (honest).
 * ACTIONABLE grants only: status posted (close_date future/null) OR forecasted (upcoming, not yet
 * open — no close_date). Expired posted grants (past close_date) are filtered out as noise. The card
 * cat reads "Grant" vs "Grant · Upcoming" so a user sees which are open now vs coming.
 * Eric 2026-07-31 "store the grants"; widened to forecasted 2026-07-31.
 */
export async function getGrantsViewportPins(
  bbox: { west: number; south: number; east: number; north: number },
  limit = 1000,
): Promise<MapOpp[]> {
  const sb = getReadClient();
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('grants_cache')
    .select('opp_number, title, agency, agency_code, status, award_ceiling, close_date, url, map_lat, map_lng, map_loc_source')
    .not('map_lat', 'is', null)
    .gte('map_lat', bbox.south).lte('map_lat', bbox.north)
    .gte('map_lng', bbox.west).lte('map_lng', bbox.east)
    // Actionable only: a future/rolling deadline (posted still open) OR a forecasted grant (not yet
    // open → no close_date). Expired POSTED grants (past close_date) are dropped as noise.
    .or(`close_date.gte.${todayIso},close_date.is.null,status.eq.forecasted`)
    // Order by posted/open date DESC (newest first) — NOT close_date. Forecasted grants have no
    // close_date, so a close_date sort dumped ALL 502 of them past the 1,000-pin cap → they never
    // rendered on a wide viewport. posted_date is populated for both statuses, so newest-first keeps
    // posted + forecasted interleaved and both visible. (The card still shows the deadline.)
    .order('posted_date', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`getGrantsViewportPins: ${error.message}`);

  const out: MapOpp[] = [];
  for (const r of (data || []) as Array<Record<string, unknown>>) {
    const oppNumber = String(r.opp_number ?? '').trim();
    if (!oppNumber) continue;
    const forecasted = String(r.status || '') === 'forecasted';
    out.push({
      id: 'gr-' + oppNumber,
      title: String(r.title || 'Federal grant'),
      agency: String(r.agency || 'Federal agency'),
      set: 'NONE',
      setLabel: SET_LABEL.NONE,
      naics: '',
      cat: forecasted ? 'Grant · Upcoming' : 'Grant · ' + String(r.agency_code || 'federal'),
      loc: '',                         // grants have no place of performance
      close: (r.close_date as string) || null,
      sol: oppNumber,
      uiLink: (r.url as string) || `https://www.grants.gov/search-results-detail/${oppNumber}`,
      lat: r.map_lat as number,
      lng: r.map_lng as number,
      src: 'GRANTS',
      locSrc: 'office',                // always agency-HQ approximate (never a real PoP)
      est: Number(r.award_ceiling) || 0,
    });
  }
  return out;
}
