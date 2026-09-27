/**
 * Date-field input normalization for `user_pipeline` writes (POST + PATCH).
 *
 * ── WHY (#1705) ────────────────────────────────────────────────────────────
 * `POST /api/pipeline` returned 500 with
 *   `invalid input syntax for type timestamp with time zone: "" (22007)`
 * 11 times in ~20h of prod logs. Clients send an EMPTY STRING for an unknown
 * deadline — the saved-inbox "Start pursuit" sends `r.response_deadline || ''`,
 * and the Opportunity Map sends `o.close` / `CUR.deadline`, which are `''` for
 * every undated notice, forecast, recompete and company pin. The pursuit writer
 * only backfills `response_deadline` when SAM has one, so for a notice with no
 * SAM deadline the `''` went straight into the TIMESTAMPTZ column.
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────
 * - empty / whitespace-only string, or null → `null` (the honest "unknown").
 * - key absent (undefined) → left absent (a PATCH that doesn't mention a date
 *   must not clear it).
 * - a recognisable date → passed through UNCHANGED (no reformatting).
 * - a non-empty string that is NOT a date ("Due in 6 days", "TBD", "1",
 *   "2026-02-30") → a validation error naming the field. It is never coerced
 *   into a fabricated date and never silently nulled: the caller sent
 *   something it believed was a date, and dropping it would lose a real
 *   deadline without anyone knowing.
 */

/** Every date-typed `user_pipeline` column a request body can reach. */
export const PURSUIT_DATE_FIELDS = [
  // TIMESTAMPTZ
  'response_deadline',
  'discovered_at',
  'bid_decided_at',
  'docs_fetched_at',
  // DATE
  'next_action_date',
  'outcome_date',
] as const;

export type PursuitDateField = (typeof PURSUIT_DATE_FIELDS)[number];

export type NormalizeDatesResult =
  | { ok: true }
  | { ok: false; field: string; value: unknown; error: string };

const ISO_YMD = /^(\d{4})-(\d{2})-(\d{2})/;

/** True when `s` is a date Postgres will accept for a date/timestamptz column. */
export function isRecognisableDate(s: string): boolean {
  // A 4-digit year is required: V8's Date.parse accepts "1" (→ 2001), which
  // Postgres rejects, so Date.parse alone would let garbage through to a 500.
  if (!/\d{4}/.test(s)) return false;
  if (Number.isNaN(Date.parse(s))) return false;
  // Date.parse rolls impossible ISO days over ("2026-02-30" → Mar 2); Postgres
  // rejects them. Check the calendar for the ISO form.
  const m = ISO_YMD.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
  }
  return true;
}

/**
 * Normalize the date fields of a pursuit write body IN PLACE.
 * Returns `{ ok: false, field }` on the first malformed value; the body may
 * then be partially normalized and must not be written.
 */
export function normalizePursuitDates(
  body: Record<string, unknown>,
  fields: readonly string[] = PURSUIT_DATE_FIELDS,
): NormalizeDatesResult {
  for (const field of fields) {
    if (!(field in body)) continue;
    const v = body[field];
    if (v === undefined) continue;
    if (v === null) continue;
    if (typeof v !== 'string') {
      return { ok: false, field, value: v, error: `${field} must be a date string or null` };
    }
    if (v.trim() === '') {
      body[field] = null;
      continue;
    }
    if (!isRecognisableDate(v.trim())) {
      return { ok: false, field, value: v, error: `${field} is not a valid date: "${v}"` };
    }
    // Valid: keep the caller's value exactly as sent.
  }
  return { ok: true };
}
