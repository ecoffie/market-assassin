/**
 * US state normalizer (shared, dependency-free).
 *
 * `normalizeStateCode` accepts EITHER a 2-letter code (any case) OR a full state
 * name ("Florida", "florida") and returns the canonical uppercase 2-letter code,
 * or `null` if it can't be resolved. Covers all 50 states + DC + PR.
 *
 * Used by location search: SAM stores place-of-performance / office state as
 * 2-letter uppercase codes (FL, TX, AK…), but users and agents type names.
 */

// Canonical code → name (50 states + DC + PR).
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
  DC: 'District of Columbia', PR: 'Puerto Rico',
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
  return NAME_TO_CODE[trimmed.toLowerCase()] ?? null;
}

export { CODE_TO_NAME as US_STATE_NAMES };
