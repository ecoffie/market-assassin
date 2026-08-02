/**
 * US state normalizer (shared, dependency-free).
 *
 * `normalizeStateCode` accepts EITHER a 2-letter code (any case) OR a full state
 * name ("Florida", "florida") and returns the canonical uppercase 2-letter code,
 * or `null` if it can't be resolved. Covers all 50 states + DC + the five
 * inhabited US territories.
 *
 * Used by location search: SAM stores place-of-performance / office state as
 * 2-letter uppercase codes (FL, TX, AK…), but users and agents type names.
 */

// Canonical code → name (50 states + DC + the 5 inhabited territories).
//
// THE TERRITORIES WERE MISSING (found 2026-08-02 by the map-coverage audit). This
// table gates every state lookup — resolvePinCoord calls normalizeStateCode BEFORE
// consulting STATE_CENTROIDS — so a code absent here is dropped even though the
// centroid table has had VI/GU/AS/MP coordinates all along. Two tables that must
// agree, silently disagreeing: 69 forecasts in Guam, the Virgin Islands, Saipan and
// Yigo were unmappable, and PR worked only because it happened to be listed.
const CODE_TO_NAME: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
  // Inhabited territories — real places with real federal buying (Naval Base Guam,
  // NAVFAC Marianas, CBP in the USVI).
  PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', GU: 'Guam',
  MP: 'Northern Mariana Islands', AS: 'American Samoa',
};

// Aliases the sources actually write, so a name lookup finds them too.
const NAME_ALIASES: Record<string, string> = {
  'virgin islands': 'VI', 'us virgin islands': 'VI', 'u.s. virgin islands': 'VI',
  'guam': 'GU', 'northern mariana islands': 'MP', 'saipan': 'MP',
  'american samoa': 'AS', 'puerto rico': 'PR',
};

// Reverse: normalized name → code. Built once at module load.
const NAME_TO_CODE: Record<string, string> = Object.entries(CODE_TO_NAME).reduce(
  (acc, [code, name]) => {
    acc[name.toLowerCase()] = code;
    return acc;
  },
  {} as Record<string, string>,
);

/**
 * Normalize a state input to its uppercase 2-letter code.
 * @param input a 2-letter code ("fl", "FL") or full name ("Florida", "florida").
 * @returns the uppercase code (e.g. "FL"), or null if unrecognized.
 */
export function normalizeStateCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 2-letter code path.
  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    return CODE_TO_NAME[upper] ? upper : null;
  }

  // Full-name path.
  const lower = trimmed.toLowerCase();
  return NAME_TO_CODE[lower] ?? NAME_ALIASES[lower] ?? null;
}

export { CODE_TO_NAME as US_STATE_NAMES };
