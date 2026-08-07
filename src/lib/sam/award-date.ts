/**
 * award-date — sanity bounds for `sam_opportunities.award_date`.
 *
 * THE PROBLEM
 * -----------
 * `award_date` is copied verbatim from SAM's `raw_data->award->date`. The
 * extraction is faithful -- verified 0 mismatches across 31,355 rows -- but
 * FAITHFUL IS NOT THE SAME AS SANE. Contracting officers mistype the year at
 * entry and SAM stores it as-is, so the column contains dates that are real
 * strings, correctly parsed, and centuries wrong.
 *
 * Measured 2026-08-07 over 31,355 populated rows:
 *   31,346  plausible (2020 .. today+1yr)
 *        4  absurd future  -- three rows dated 2260 (a transposed 2026)
 *        2  future 1-10yr  -- 2029, posted 2026
 *        1  before 2015    -- 2005, posted 2026
 *
 * Every bad row is wildly divergent from its own `posted_date`:
 *   2260-07-01 posted 2026-07-15   (Soniat& Willow Inc)
 *   2260-05-06 posted 2026-05-08   (Executive Leadership Group)
 *   2260-04-29 posted 2026-04-29   (Sierra7, Inc.)
 *
 * WHY WE FILTER AT READ TIME RATHER THAN FIXING THE ROW
 * ----------------------------------------------------
 * The stored value is what SAM published. Overwriting it would hide a real
 * upstream data error and make our copy disagree with the source of record --
 * and we would have no way to tell a corrected row from an original one later.
 * So the row keeps its value; every READER applies these bounds.
 *
 * 7 rows in 31K is immaterial to any aggregate. It is NOT immaterial to
 * anything ordered or bounded by date: `ORDER BY award_date DESC` puts a 2260
 * award at the top of "most recent" forever, and a date-range chart gets a
 * 234-year axis. That is the failure this module exists to prevent.
 */

/** Awards dated more than this far ahead of today are typos, not schedules. */
export const MAX_FUTURE_YEARS = 1;

/**
 * Awards before this are typos too. SAM's opportunity cache begins 2026-03-15,
 * so a 2005 award date on a 2026 notice is a mistyped year, not deep history.
 * Kept generous (not 2026) because a legitimate notice can reference an older
 * base award; the goal is to catch nonsense, not to enforce a narrow window.
 */
export const MIN_PLAUSIBLE_AWARD_DATE = '2015-01-01';

/**
 * SQL predicate for any query that ORDERS BY or RANGES OVER award_date.
 *
 * Written to be null-safe: rows with no award_date pass, because a missing
 * date is normal (~1 in 6 award notices) and filtering them out would silently
 * shrink result sets. Only IMPLAUSIBLE dates are excluded.
 *
 *   const { data } = await supabase
 *     .from('sam_opportunities')
 *     .select('*')
 *     .not('awardee_name', 'is', null)
 *     .order('award_date', { ascending: false })
 *   // ...becomes, with the guard:
 *   .or(AWARD_DATE_SANE_OR_FILTER)
 */
export const AWARD_DATE_SANE_SQL = `(
  award_date IS NULL
  OR (
    award_date >= DATE '${MIN_PLAUSIBLE_AWARD_DATE}'
    AND award_date <= CURRENT_DATE + INTERVAL '${MAX_FUTURE_YEARS} year'
  )
)`;

/**
 * PostgREST `.or()` form of the same predicate, for supabase-js callers.
 * Computed at call time so "today" is never baked into a module constant that
 * a long-lived serverless instance would carry for days.
 */
export function awardDateSaneOrFilter(now: Date = new Date()): string {
  const max = new Date(now);
  max.setFullYear(max.getFullYear() + MAX_FUTURE_YEARS);
  const maxIso = max.toISOString().slice(0, 10);
  return `award_date.is.null,and(award_date.gte.${MIN_PLAUSIBLE_AWARD_DATE},award_date.lte.${maxIso})`;
}

/**
 * Is this award_date usable for display, ordering, or range math?
 *
 * `null` returns true -- a missing date is not a bad date. Callers that need a
 * date present should check for null separately; conflating "absent" with
 * "wrong" is how rows get dropped from result sets nobody expected to shrink.
 */
export function isPlausibleAwardDate(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (value === null || value === undefined || value === '') return true;

  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return false;

  const min = new Date(`${MIN_PLAUSIBLE_AWARD_DATE}T00:00:00Z`);
  const max = new Date(now);
  max.setFullYear(max.getFullYear() + MAX_FUTURE_YEARS);

  return d >= min && d <= max;
}

/**
 * The date to SHOW, or null when the stored value is nonsense.
 *
 * Use in UI rather than dropping the whole award: a solicitation with a
 * mistyped award date still has a real winner and a real amount, and hiding
 * the row loses more than hiding one field does.
 */
export function displayAwardDate(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!value) return null;
  if (!isPlausibleAwardDate(value, now)) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Drop implausible-dated rows from a list before ordering by date.
 * Rows with a null date are KEPT (see isPlausibleAwardDate).
 */
export function filterSaneAwardDates<T extends { award_date?: string | null }>(
  rows: T[],
  now: Date = new Date(),
): T[] {
  return rows.filter((r) => isPlausibleAwardDate(r.award_date, now));
}
