/**
 * Canonical USASpending award_type_codes groups.
 *
 * Contract and IDV types must never be mixed in one spending_by_award request.
 * Keep every consumer on these exports — diverging local lists already caused
 * IDV_B_B PIIDs (e.g. FA461025D0001) to miss in resolvePiidToId.
 */

/** Definitive contracts, POs, delivery orders, BPA calls. */
export const CONTRACT_CODES = ['A', 'B', 'C', 'D'] as const;

/**
 * IDV vehicles. Subtypes IDV_B_A / IDV_B_B / IDV_B_C are required —
 * parent codes alone (IDV_A..E) do not return those rows from USASpending.
 */
export const IDV_CODES = [
  'IDV_A',
  'IDV_B',
  'IDV_B_A',
  'IDV_B_B',
  'IDV_B_C',
  'IDV_C',
  'IDV_D',
  'IDV_E',
] as const;

export type ContractAwardTypeCode = (typeof CONTRACT_CODES)[number];
export type IdvAwardTypeCode = (typeof IDV_CODES)[number];
