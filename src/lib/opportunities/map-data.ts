/**
 * Opportunity Map data — live `sam_opportunities` → pinned points for the Leaflet map.
 * Ported from Eric's evc-opportunity-map prototype: same shape, but LIVE data +
 * state-centroid geocoding (the prototype baked lat/lng; we derive it from the state).
 */
import { getReadClient } from '@/lib/supabase/server-clients';
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
  if (iso3 && iso3 !== 'USA' && iso3 !== 'US') {
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
export type MapSrc = 'SAM' | 'DLA';

export type MapOpp = {
  id: string; title: string; agency: string; set: string; setLabel: string;
  naics: string; cat: string; loc: string; close: string | null; sol: string;
  uiLink: string | null; lat: number; lng: number; src: MapSrc; locSrc: LocSource;
  // SOW card facts (Tier 1) — present only once the row has been precomputed AND has
  // brandNameOrEqual/evalBasis/setAsideFromText content worth showing. undefined otherwise
  // (never fabricated — the extractor already nulls out fields it can't ground).
  brandNameOrEqual?: boolean;
  evalBasis?: 'best_value' | 'lpta' | 'tradeoff' | null;
};

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
