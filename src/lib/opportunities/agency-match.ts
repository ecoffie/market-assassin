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

/** Split a pipe-joined multi-agency value (a value with no pipe = one needle → single free-text input). */
export function multiAgency(v: string): string[] {
  return [...new Set((v || '').split('|').map((s) => s.trim()).filter(Boolean))];
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
