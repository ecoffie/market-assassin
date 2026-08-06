/**
 * Normalise a forecast row's fields to the invariants the oracle enforces.
 *
 * WHY THIS IS A LIB AND NOT JUST A SCRIPT: the repair ran once by hand and the
 * daily DHS sync put the damage straight back — 146 rows regained the literal
 * string "NA" in pop_state within a day, and the oracle went red again with
 * mismatches nobody had introduced. A one-time repair against a recurring source
 * is a treadmill. The INGEST has to apply the same rules the audit checks, so
 * this is shared between the cron and scripts/repair-forecast-invariants.ts.
 *
 * Every rule DROPS an impossible value to null rather than inventing a good one.
 * Where the truth is unrecoverable the field is empty, which the map, the card
 * and the unplaced list all render honestly.
 */

/**
 * Placeholder text meaning "no value", written into a field as if it were one.
 * DHS stores the literal "NA" in pop_state; several sources write "TBD" or
 * "Multiple" into pop_city. These render on a card as though they were data.
 *
 * Deliberately ANCHORED — "Various" matches, "Various Locations, TX" does not,
 * because that second one names a state we can still use.
 */
export const PLACEHOLDER = /^(n\/?a|na|tbd|tba|none|null|unknown|multiple|various|various locations|n\/a virtual|virtual|remote|- ?)$/i;

/** "2026" → "FY2026"; "FY26" → "FY2026"; "TBD" → null. */
export function normalizeFy(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  const m = /^FY?\s?(\d{4})$/.exec(s) || /^(20\d{2})$/.exec(s);
  if (m) { const n = Number(m[1]); return n >= 2020 && n <= 2040 ? `FY${m[1]}` : null; }
  const short = /^FY\s?(\d{2})$/.exec(s);
  if (short) { const n = 2000 + Number(short[1]); return n >= 2020 && n <= 2040 ? `FY${n}` : null; }
  return null;   // "TBD" and anything else unparseable
}

export interface ForecastRowFields {
  naics_code?: string | null;
  fiscal_year?: string | null;
  estimated_value_min?: number | null;
  estimated_value_max?: number | null;
  pop_state?: string | null;
  pop_city?: string | null;
}

/**
 * Return only the fields that need CHANGING, or an empty object when the row is
 * already clean — so a caller can skip a no-op write.
 */
export function normalizeForecastRow(r: ForecastRowFields): Partial<ForecastRowFields> {
  const patch: Partial<ForecastRowFields> = {};

  // A NAICS is exactly 6 digits. "TBD" (509 Navy rows) rendered on cards as if it
  // were a real classification; a 7-digit value is a different code entirely.
  if (r.naics_code && !/^\d{6}$/.test(String(r.naics_code))) patch.naics_code = null;

  // The query filter matches FY20xx, so a bare "2026" silently dropped the row out
  // of every future-year search.
  const fy = normalizeFy(r.fiscal_year);
  if (r.fiscal_year && fy !== r.fiscal_year) patch.fiscal_year = fy;

  // A federal forecast floored under $1,000 is a malformed cell — usually a stray
  // digit or a shared-suffix range read wrong. Drop the floor, keep the ceiling.
  if (r.estimated_value_min != null && r.estimated_value_min < 1000) patch.estimated_value_min = null;

  if (r.pop_state && PLACEHOLDER.test(r.pop_state)) patch.pop_state = null;
  if (r.pop_city && PLACEHOLDER.test(r.pop_city)) patch.pop_city = null;

  // Inverted bounds are a parse failure, not a real range. Order them rather than
  // storing a floor above the ceiling, which no downstream filter would catch.
  const min = 'estimated_value_min' in patch ? patch.estimated_value_min : r.estimated_value_min;
  if (min != null && r.estimated_value_max != null && min > r.estimated_value_max) {
    patch.estimated_value_min = r.estimated_value_max;
    patch.estimated_value_max = min;
  }

  return patch;
}

/** Apply the normalisation in place — for an ingest building rows before upsert. */
export function normalizeForecastRowInPlace<T extends ForecastRowFields>(r: T): T {
  return Object.assign(r, normalizeForecastRow(r));
}

/**
 * Forecast pop_state is dirty in ways SAM's isn't — the dominant bad pattern is
 * "CA United States" / "DC United States" (a state code + a country suffix), which
 * normalizeStateCode() can't parse, so 5,782 recoverable rows were dropped as "no state".
 * Strip the trailing " United States" (and "USA"/"US") so the real 2-letter code (or full
 * state NAME) survives to resolvePinCoord. "[Nationwide]" / "Not specified" / null stay
 * null — genuinely national forecasts with no place, honestly left unpinned.
 *
 * A CITY+STATE written into the state column ("Washington, DC" from NRL) keeps only the
 * trailing code; the city half is already carried in pop_city when the source populated it.
 *
 * SHARED so the write-time path (api/cron/sync-forecasts) and the drain
 * (scripts/backfill-forecast-latlng.ts) can never drift apart — two copies of a cleaning
 * rule is how a fix half-lands and the map disagrees with itself. (Lifted here 2026-08-06.)
 */
export function cleanForecastState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (/nationwide|not specified|various|multiple/i.test(s)) return null;
  s = s.replace(/[\s,]+(united states of america|united states|u\.?s\.?a\.?|u\.?s\.?)\s*$/i, '').trim();
  const cityState = /^(.+),\s*([A-Za-z]{2})$/.exec(s);
  if (cityState) s = cityState[2].toUpperCase();
  return s || null;
}
