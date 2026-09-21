/**
 * Agency multi-select matching — shared by every Opportunity Map source (SAM opps, recompete,
 * forecast) so one Agency dropdown selection means the same thing everywhere. Kept in its OWN module
 * (not map-filters) because map-data imports these AND map-filters imports map-data — a cycle if these
 * lived in map-filters.
 *
 * Two problems this solves:
 *  1) An agency needle can contain a comma ("STATE, DEPARTMENT OF"), so the multi-select joins needles
 *     with a PIPE, not a comma (multiAgency).
 *  2) The SAME real agency is spelled in different WORD ORDERS across sources — SAM's `department` =
 *     "STATE, DEPARTMENT OF" vs USASpending's `awarding_agency` = "Department of State". So a multi-word
 *     needle is matched in BOTH orders (%STATE%DEPARTMENT%OF% OR its reverse), which hits the right
 *     agency in every source without the false positives a bare %STATE% pulls ("United States …").
 */

/**
 * Split a pipe-joined multi-agency value (a value with no pipe = one needle → single free-text input).
 *
 * Takes `unknown` for the same reason multiVal() does: the viewport API passes a
 * URL string, but the saved-search crons pass `saved_searches.filters` JSON,
 * where a multi-select can be stored as a real ARRAY. `(v || '')` does not guard
 * `[]` (an empty array is truthy), so an array reached `.split()` and threw a
 * 0-byte 500. Joined rather than tolerated so ['Navy','Army'] parses to two
 * needles, not none. See the multiVal() docblock for the full incident.
 */
export function multiAgency(v: unknown): string[] {
  const raw = Array.isArray(v)
    ? v.filter((x) => typeof x === 'string' || typeof x === 'number').join('|')
    : typeof v === 'string'
      ? v
      : typeof v === 'number'
        ? String(v)
        : '';
  return [...new Set(raw.split('|').map((s) => s.trim()).filter(Boolean))];
}

/** PostgREST `.or()` fragments matching one agency needle against `col`, across both word orders. */
export function agencyIlikeConds(col: string, needle: string): string[] {
  const words = needle.replace(/[%,()]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (words.length === 1) return [`${col}.ilike.%${words[0]}%`];
  const fwd = `${col}.ilike.%${words.join('%')}%`;
  const rev = `${col}.ilike.%${words.slice().reverse().join('%')}%`;
  return [...new Set([fwd, rev])];
}

/** Full `.or()` string for a set of agency needles against a column (empty string if none). */
export function agencyOrExpr(col: string, needles: string[]): string {
  return needles.flatMap((n) => agencyIlikeConds(col, n)).join(',');
}

/**
 * BigQuery-SQL analog of agencyIlikeConds — same "both word orders" matching, but as
 * `LOWER(col) LIKE '%…%'` fragments for a BQ WHERE clause instead of PostgREST `.or()`
 * syntax. Used by searchRecipients' agency-scoped path (src/lib/bigquery/recipients.ts)
 * so a BQ awarding_agency/awarding_sub_agency match means the same thing as the map's
 * SAM department/sub_tier match for the identical typed needle ("VA" / "Navy" / "Army").
 * Params are inlined as BQ string literals (needles are our own curated/typed agency
 * text, not raw user SQL) — single-quoted, with embedded quotes escaped.
 */
export function agencyBqLikeConds(col: string, needle: string): string[] {
  const words = needle.replace(/[%,()]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const esc = (s: string) => s.toLowerCase().replace(/'/g, "\\'");
  if (words.length === 1) return [`LOWER(${col}) LIKE '%${esc(words[0])}%'`];
  const fwd = `LOWER(${col}) LIKE '%${words.map(esc).join('%')}%'`;
  const rev = `LOWER(${col}) LIKE '%${words.slice().reverse().map(esc).join('%')}%'`;
  return [...new Set([fwd, rev])];
}

/**
 * Full BQ boolean OR expression matching ANY of the given agency needles against
 * BOTH `awarding_agency` (department, e.g. "Department of Veterans Affairs") and
 * `awarding_sub_agency` (Army/Navy/Air Force/DLA/etc — where "Navy"/"Army" actually
 * live, mirroring the SAM department-vs-sub_tier split). Returns '(FALSE)' (never
 * matches) when there are no needles, so callers can always splice this into an
 * `AND (...)` without a conditional branch.
 */
export function agencyBqOrSql(depCol: string, subCol: string, needles: string[]): string {
  const conds = needles.flatMap((n) => [...agencyBqLikeConds(depCol, n), ...agencyBqLikeConds(subCol, n)]);
  return conds.length ? `(${conds.join(' OR ')})` : '(FALSE)';
}
