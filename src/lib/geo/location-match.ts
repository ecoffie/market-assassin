/**
 * Location matching for expiring contracts (and any place-of-performance
 * vs. user-service-area comparison).
 *
 * The user's profile says WHERE they work (hq_state + service_states[]).
 * Each contract has a place-of-performance state. This turns that into a
 * VISIBLE relevance signal instead of a silent filter (Eric, 2026-06-04:
 * "I don't see how it measures against the places I work").
 *
 * Tiers: hq > service-area > neighboring > outside. Neighboring uses a
 * US state-adjacency map (border states), which is the practical grain
 * for federal place-of-performance.
 */

export type LocationMatch = 'hq' | 'service' | 'neighbor' | 'outside' | 'unknown';

// US state border adjacency (USPS codes). DC borders MD + VA.
const ADJACENCY: Record<string, string[]> = {
  AL: ['FL', 'GA', 'MS', 'TN'],
  AK: [],
  AZ: ['CA', 'CO', 'NM', 'NV', 'UT'],
  AR: ['LA', 'MO', 'MS', 'OK', 'TN', 'TX'],
  CA: ['AZ', 'NV', 'OR'],
  CO: ['AZ', 'KS', 'NE', 'NM', 'OK', 'UT', 'WY'],
  CT: ['MA', 'NY', 'RI'],
  DE: ['MD', 'NJ', 'PA'],
  DC: ['MD', 'VA'],
  FL: ['AL', 'GA'],
  GA: ['AL', 'FL', 'NC', 'SC', 'TN'],
  HI: [],
  ID: ['MT', 'NV', 'OR', 'UT', 'WA', 'WY'],
  IL: ['IA', 'IN', 'KY', 'MO', 'WI'],
  IN: ['IL', 'KY', 'MI', 'OH'],
  IA: ['IL', 'MN', 'MO', 'NE', 'SD', 'WI'],
  KS: ['CO', 'MO', 'NE', 'OK'],
  KY: ['IL', 'IN', 'MO', 'OH', 'TN', 'VA', 'WV'],
  LA: ['AR', 'MS', 'TX'],
  ME: ['NH'],
  MD: ['DC', 'DE', 'PA', 'VA', 'WV'],
  MA: ['CT', 'NH', 'NY', 'RI', 'VT'],
  MI: ['IN', 'OH', 'WI'],
  MN: ['IA', 'ND', 'SD', 'WI'],
  MS: ['AL', 'AR', 'LA', 'TN'],
  MO: ['AR', 'IA', 'IL', 'KS', 'KY', 'NE', 'OK', 'TN'],
  MT: ['ID', 'ND', 'SD', 'WY'],
  NE: ['CO', 'IA', 'KS', 'MO', 'SD', 'WY'],
  NV: ['AZ', 'CA', 'ID', 'OR', 'UT'],
  NH: ['MA', 'ME', 'VT'],
  NJ: ['DE', 'NY', 'PA'],
  NM: ['AZ', 'CO', 'OK', 'TX', 'UT'],
  NY: ['CT', 'MA', 'NJ', 'PA', 'VT'],
  NC: ['GA', 'SC', 'TN', 'VA'],
  ND: ['MN', 'MT', 'SD'],
  OH: ['IN', 'KY', 'MI', 'PA', 'WV'],
  OK: ['AR', 'CO', 'KS', 'MO', 'NM', 'TX'],
  OR: ['CA', 'ID', 'NV', 'WA'],
  PA: ['DE', 'MD', 'NJ', 'NY', 'OH', 'WV'],
  RI: ['CT', 'MA'],
  SC: ['GA', 'NC'],
  SD: ['IA', 'MN', 'MT', 'ND', 'NE', 'WY'],
  TN: ['AL', 'AR', 'GA', 'KY', 'MO', 'MS', 'NC', 'VA'],
  TX: ['AR', 'LA', 'NM', 'OK'],
  UT: ['AZ', 'CO', 'ID', 'NM', 'NV', 'WY'],
  VT: ['MA', 'NH', 'NY'],
  VA: ['DC', 'KY', 'MD', 'NC', 'TN', 'WV'],
  WA: ['ID', 'OR'],
  WV: ['KY', 'MD', 'OH', 'PA', 'VA'],
  WI: ['IA', 'IL', 'MI', 'MN'],
  WY: ['CO', 'ID', 'MT', 'NE', 'SD', 'UT'],
};

export interface UserGeo {
  hqState?: string | null;
  serviceStates?: string[];
}

/**
 * Classify a contract's place-of-performance state against the user's geo.
 * Returns 'unknown' when the contract has no state (don't pretend to match).
 */
export function classifyLocation(contractState: string | null | undefined, geo: UserGeo): LocationMatch {
  const cs = (contractState || '').trim().toUpperCase();
  if (!cs) return 'unknown';

  const hq = (geo.hqState || '').trim().toUpperCase();
  const service = new Set((geo.serviceStates || []).map(s => s.trim().toUpperCase()).filter(Boolean));

  if (hq && cs === hq) return 'hq';
  if (service.has(cs)) return 'service';

  // Neighboring: adjacent to the HQ state OR any service-area state.
  const homes = [hq, ...service].filter(Boolean);
  for (const home of homes) {
    if ((ADJACENCY[home] || []).includes(cs)) return 'neighbor';
  }
  return 'outside';
}

// Display metadata for each tier (label + a short why).
export const MATCH_META: Record<LocationMatch, { label: string; hint: string; rank: number }> = {
  hq:      { label: 'HQ state',        hint: 'Your headquarters state',            rank: 0 },
  service: { label: 'Service area',    hint: 'A state you listed as a work area',  rank: 1 },
  neighbor:{ label: 'Neighboring',     hint: 'Borders a state where you work',     rank: 2 },
  outside: { label: 'Outside your area', hint: 'Not in or adjacent to your areas', rank: 3 },
  unknown: { label: 'Location N/A',    hint: 'No place of performance listed',     rank: 4 },
};
