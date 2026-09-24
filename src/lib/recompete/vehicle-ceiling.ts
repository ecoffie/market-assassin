/**
 * A vehicle's ceiling, counted ONCE.
 *
 * Two different things get grouped into a "vehicle":
 *   - AWARD / ORDER records (what `recompete_opportunities` holds). Each carries its OWN value, so
 *     the vehicle total is their sum — unchanged behaviour.
 *   - HOLDER IDV records of one multiple-award program (what a solicitation-keyed grouping of BQ
 *     IDV rows produces). FPDS reports the PROGRAM ceiling on every holder's IDV: all four Robins
 *     Mech-Elec II holders (FA850124D0002..0005, solicitation FA850124R0001) carry $95,000,000.
 *     That ceiling is shared, not additive. Summing it per holder reported $380M.
 *
 * When holder ceilings DIFFER we cannot tell a shared ceiling from genuinely per-holder ceilings
 * from the record alone, so we show the MAX (a floor for the program either way) and say so in
 * the basis — never the sum, and never a number without its basis.
 *
 * Orders that sit in the same group as their parent IDV are consumption AGAINST the ceiling, so
 * they are never added to it.
 *
 * Pure — no I/O.
 */

export type VehicleCeilingBasis =
  | 'sum_of_award_values'
  | 'shared_program_ceiling'
  | 'holder_ceilings_differ_max_shown'
  | 'shared_ceiling_not_reported';

export interface VehicleCeilingMember {
  contract_id?: string | null;
  award_or_idv_flag?: string | null;
  potential_total_value?: number | null;
  total_obligation?: number | null;
}

export function isIdvRecord(m: VehicleCeilingMember): boolean {
  return String(m.award_or_idv_flag || '').trim().toUpperCase() === 'IDV'
    || /^CONT_IDV_/i.test(String(m.contract_id || '').trim());
}

export function resolveVehicleCeiling(members: VehicleCeilingMember[]): {
  ceiling: number;
  basis: VehicleCeilingBasis;
} {
  const idvs = members.filter(isIdvRecord);
  if (idvs.length === 0) {
    return {
      ceiling: members.reduce((n, m) => n + (m.potential_total_value || m.total_obligation || 0), 0),
      basis: 'sum_of_award_values',
    };
  }
  // An IDV's total_obligation is not a ceiling (the IDV obligates nothing itself).
  const ceilings = idvs
    .map((m) => Number(m.potential_total_value))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ceilings.length === 0) return { ceiling: 0, basis: 'shared_ceiling_not_reported' };
  const max = Math.max(...ceilings);
  const allEqual = ceilings.every((c) => c === ceilings[0]);
  return { ceiling: max, basis: allEqual ? 'shared_program_ceiling' : 'holder_ceilings_differ_max_shown' };
}
