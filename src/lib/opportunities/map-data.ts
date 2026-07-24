/**
 * Opportunity Map data — live `sam_opportunities` → pinned points for the Leaflet map.
 * Ported from Eric's evc-opportunity-map prototype: same shape, but LIVE data +
 * state-centroid geocoding (the prototype baked lat/lng; we derive it from the state).
 */
import { getReadClient } from '@/lib/supabase/server-clients';
import { STATE_CENTROIDS, jitter } from '@/lib/geo/state-centroids';
import { normalizeStateCode } from '@/lib/utils/us-states';
import cityCoordsRaw from '@/data/us-city-coords.json';
import zipCoordsRaw from '@/data/us-zip-coords.json';

// Real coords from GeoNames (public domain). ZIP is the cleanest, most-complete key
// (office zip ~99.5% filled); city covers place-of-performance where we only have a name.
const CITY_COORDS = cityCoordsRaw as unknown as Record<string, [number, number]>;
const ZIP_COORDS = zipCoordsRaw as unknown as Record<string, [number, number]>;

// Tiny deterministic offset (~1km) so multiple opps at the same point don't perfectly stack.
function cityJitter([lat, lng]: [number, number], seed: number): [number, number] {
  const s = seed % 12;
  return [lat + (s - 6) * 0.011, lng + (((s * 5) % 12) - 6) * 0.011];
}

/** Resolve a real coordinate for an opp, most-precise source first:
 *  place-of-performance city → buying-office ZIP → buying-office city. Returns the
 *  matched city label + state so the pin's text agrees with its location. */
export function geocode(
  popCity: string, popState: string | null,
  office: { city?: string; state?: string; zipcode?: string } | null,
): { coord: [number, number] | null; city: string; state: string | null } {
  if (popCity && popState) {
    const c = CITY_COORDS[`${popCity.toUpperCase()}|${popState}`];
    if (c) return { coord: c, city: popCity, state: popState };
  }
  const oState = normalizeStateCode(office?.state || '');
  if (office?.zipcode) {
    const z = String(office.zipcode).replace(/\D/g, '').slice(0, 5);
    const c = ZIP_COORDS[z];
    if (c) return { coord: c, city: (office.city || '').trim(), state: oState };
  }
  if (office?.city && oState) {
    const c = CITY_COORDS[`${office.city.trim().toUpperCase()}|${oState}`];
    if (c) return { coord: c, city: office.city.trim(), state: oState };
  }
  return { coord: null, city: '', state: popState || oState };
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

export type MapOpp = {
  id: string; title: string; agency: string; set: string; setLabel: string;
  naics: string; cat: string; loc: string; close: string | null; sol: string;
  uiLink: string | null; lat: number; lng: number; src: 'SAM';
};

/**
 * Live open opportunities with a pin. Ordered soonest-deadline first (most actionable),
 * capped for map performance. Geocoded by place-of-performance state, else buying-office state.
 */
export async function getMapOpportunities(limit = 600): Promise<MapOpp[]> {
  const sb = getReadClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('sam_opportunities')
    .select('notice_id, title, department, naics_code, set_aside_code, set_aside_description, response_deadline, ui_link, solicitation_number, pop_state, pop_city, office_address')
    .eq('active', true)
    .gte('response_deadline', today)
    .order('response_deadline', { ascending: true })
    .limit(limit * 2); // over-fetch; some rows drop for missing geo
  if (error) throw new Error(`getMapOpportunities: ${error.message}`);

  const out: MapOpp[] = [];
  for (const r of (data || []) as Array<Record<string, unknown>>) {
    const title = String(r.title ?? '').trim();
    // Skip FSC-coded commodity micro-buys ("48--VALVE,GLOBE") — real, but noise on the map;
    // surface the named service/construction/professional work instead.
    if (!title || /^\d{1,4}--/.test(title)) continue;
    const office = r.office_address as { city?: string; state?: string; zipcode?: string } | null;
    const popState = normalizeStateCode((r.pop_state as string) || '');
    const popCity = ((r.pop_city as string) || '').trim();
    const g = geocode(popCity, popState, office);
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
      lat, lng, src: 'SAM',
    });
    if (out.length >= limit) break;
  }
  return out;
}
