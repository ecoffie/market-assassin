/**
 * WHY A FORECAST HAS NO MAP PIN — the classification, and the policy.
 *
 * Eric, 2026-08-02: "we need a formula for how we handle no mapping."
 *
 * The problem this solves: "0% mapped" was being read as one condition, so it
 * got one response — usually a shrug ("that source publishes no location").
 * Measured across 30,777 forecasts, 15,021 unmapped, it is actually FIVE
 * conditions with five different correct responses, and three of them are BUGS
 * that were sitting behind an "it's a source limitation" explanation:
 *
 *   NO_LOCATION_PUBLISHED  11,574  source truly has no place field  → accept
 *   SUPPRESSED_BY_SOURCE    1,900  "Cannot be disclosed" (USDA/GSA) → accept
 *   NOT_A_PLACE               198  "TBD"/"Headquarters"/"Secret"    → accept
 *   RECOVERABLE_FORMAT         12  "Washington, DC" in pop_state    → FIX
 *   CORRUPT_STATE            ~670  "DI"/"TE"/"NO"/"WE" truncations  → FIX
 *
 * THE FORMULA — apply in this order, to any source, on every ingest:
 *
 *   1. Does the SOURCE publish a place-of-performance field at all?
 *      No  → NO_LOCATION_PUBLISHED. Accept it, record it in the ledger, and
 *            never re-litigate it. This is the only honest 0%.
 *      Yes → continue. A 0% on a source that HAS the field is a bug until
 *            proven otherwise. That is the rule EPA and Treasury both violated.
 *
 *   2. Is the value a real place in the wrong SHAPE ("Washington, DC" in a
 *      state column, "CO; NJ", "CA United States")?
 *      → RECOVERABLE_FORMAT. Fix the PARSER, then re-ingest. Never hand-patch
 *        rows: the next sync re-creates the same mess.
 *
 *   3. Is the value a non-state token in a state column ("DI", "TE", 6-digit
 *      NAICS)? → CORRUPT_STATE. Fix the parser. Do NOT guess the expansion;
 *      "NO" could be North Carolina or North Dakota, and a wrong pin is worse
 *      than no pin.
 *
 *   4. Does the value explicitly say there is no single place ("Nationwide",
 *      "Various", "TBD", "Headquarters")? → NOT_A_PLACE. Accept. Do not invent
 *      a centroid — a nationwide IDIQ pinned to Kansas is a lie about scope.
 *
 *   5. Does the source deliberately withhold it ("Cannot be disclosed")?
 *      → SUPPRESSED_BY_SOURCE. Accept, and surface the label to the user rather
 *        than showing an empty field: "location withheld by the agency" is
 *        information; a blank is not.
 *
 * WHAT WE NEVER DO: place a pin we cannot defend. No office-address fallback
 * for forecasts (the buying office is not the place of performance), no state
 * centroid for "Nationwide", no guessing a truncated code. An absent pin is a
 * fact; a wrong pin is a claim.
 */

export type MapGap =
  | 'MAPPED'
  | 'NO_LOCATION_PUBLISHED'
  | 'SUPPRESSED_BY_SOURCE'
  | 'NOT_A_PLACE'
  | 'RECOVERABLE_FORMAT'
  | 'CORRUPT_STATE';

/** Values that explicitly assert "there is no single place". */
const NOT_A_PLACE = /^(tbd|tba|to be determined|various|multiple|nation ?wide|\[nationwide\]|national|worldwide|world ?wide|headquarters|hq|off ?site|remote|secret|classified|n\/?a|na|none|unknown|unavailable|contractor'?s facility|region ?-?wide|region \d+|region \w+|united states|usa|us)$/i;

/** The source is withholding the location on purpose. */
const SUPPRESSED = /^(cannot be disclosed|not disclosed|withheld|restricted|sensitive)$/i;

/** USPS codes — the only two-letter values that are really states. */
const US_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC','PR','VI','GU','AS','MP',
]);

/**
 * Classify why a row has no pin.
 *
 * `sourcePublishesLocation` comes from the LEDGER, not from the row — a single
 * blank row cannot tell you whether the portal has the field at all, and that
 * distinction is the whole point of step 1.
 */
export function classifyMapGap(
  row: { map_lat?: number | null; pop_state?: string | null; pop_city?: string | null },
  sourcePublishesLocation: boolean,
): MapGap {
  if (row.map_lat != null) return 'MAPPED';

  const raw = String(row.pop_state ?? '').trim();
  const city = String(row.pop_city ?? '').trim();

  if (!raw && !city) {
    // Nothing at all. Whether this is acceptable depends on the SOURCE.
    return sourcePublishesLocation ? 'RECOVERABLE_FORMAT' : 'NO_LOCATION_PUBLISHED';
  }

  if (SUPPRESSED.test(raw)) return 'SUPPRESSED_BY_SOURCE';
  if (NOT_A_PLACE.test(raw)) return 'NOT_A_PLACE';

  // A real place written into the wrong column — "Washington, DC",
  // "Stennis Space Center, MS", "CO; NJ", "CA United States".
  if (/,\s*[A-Z]{2}\s*$/.test(raw)) return 'RECOVERABLE_FORMAT';
  if (/\b[A-Z]{2}\b/.test(raw) && Array.from(raw.matchAll(/\b([A-Z]{2})\b/g)).some(m => US_STATE_CODES.has(m[1]))) {
    return 'RECOVERABLE_FORMAT';
  }

  // A 6-digit code in a state column is a parser wiring bug (ONR shipped a
  // NAICS there), not a location.
  if (/^\d{6}/.test(raw)) return 'CORRUPT_STATE';

  // Two letters that are NOT a USPS code: truncation artifacts. DOI/GSA/DOT
  // carry "DI", "TE", "WE", "NO" — the first two letters of a word, not a
  // state. Never expand these by guessing: "NO" is North Carolina in one row
  // and could be North Dakota in the next.
  if (/^[A-Za-z]{2}$/.test(raw) && !US_STATE_CODES.has(raw.toUpperCase())) return 'CORRUPT_STATE';

  // Something is there, it is not obviously junk, and it did not geocode.
  return 'RECOVERABLE_FORMAT';
}

/** Is this gap a BUG we should fix, or a fact we accept? */
export function isFixable(gap: MapGap): boolean {
  return gap === 'RECOVERABLE_FORMAT' || gap === 'CORRUPT_STATE';
}

/**
 * What the UI shows instead of a pin. Never an empty cell — a blank reads as
 * "we lost it", while a reason reads as information.
 */
export function mapGapLabel(gap: MapGap): string | null {
  switch (gap) {
    case 'MAPPED': return null;
    case 'NO_LOCATION_PUBLISHED': return 'Location not published by the agency';
    case 'SUPPRESSED_BY_SOURCE': return 'Location withheld by the agency';
    case 'NOT_A_PLACE': return 'No single location (nationwide or TBD)';
    case 'RECOVERABLE_FORMAT':
    case 'CORRUPT_STATE': return 'Location pending';
  }
}
