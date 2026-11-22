/**
 * contractCeiling — is the stored `potential_total_value` really an award ceiling?
 *
 * The USASpending recompete sync (usaspending-sync.ts) fills `potential_total_value` from the search
 * API's 'Award Amount' column, which is the OBLIGATED amount — the same number it writes to
 * `total_obligation`. Surfaces then presented it as "potential value (ceiling)" / "the prize ceiling".
 * Measured 2026-11-22 on 36C24825C0020 (VA, RENOVATE 5 WEST): recompete row 8,442,784 "potential" =
 * 8,442,784 obligated, while the award record's base_and_all_options ceiling is 17,386,875.96.
 *
 * Rule: a ceiling is established only when the stored value is a finite positive number that differs
 * from (and is not below) the obligated amount. An equal value cannot be told apart from the obligation
 * copy, so it is NOT a ceiling: unknown, never the obligation relabelled. A genuinely fully-funded award
 * also reads as not established — conservative, never fabricated. The authoritative ceiling is the award
 * record (get_award_detail → award.ceiling).
 */
export type CeilingBasis = 'source_reported' | 'not_established';

function finite(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function contractCeiling(row: {
  potential_total_value?: number | string | null;
  total_obligation?: number | string | null;
}): { ceiling: number | null; basis: CeilingBasis } {
  const potential = finite(row.potential_total_value);
  const obligated = finite(row.total_obligation);
  if (potential === null || potential <= 0) return { ceiling: null, basis: 'not_established' };
  if (obligated !== null && potential <= obligated) return { ceiling: null, basis: 'not_established' };
  return { ceiling: potential, basis: 'source_reported' };
}
