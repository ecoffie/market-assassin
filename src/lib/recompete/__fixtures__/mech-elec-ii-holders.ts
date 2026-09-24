/**
 * Robins Mech-Elec II — solicitation FA850124R0001, the four holder IDVs as USASpending reports
 * them (award detail `/api/v2/awards/CONT_IDV_<piid>_9700/`, captured 2026-09-22):
 * MULTIPLE AWARD IDC, HUBZone set-aside, NAICS 238220, office FA8501, $95,000,000 ceiling on
 * EACH holder (the shared program ceiling), last date to order 2029-04-23.
 * Order counts / obligations are USASpending `/api/v2/idvs/amounts/` as of 2026-09-23.
 *
 * FA850124D0001/0006/0008 404 under agency suffix 9700, so four holders is a floor.
 * D0007/D0009/D0010 (propane, FA850124R0008) and D0011 (custodial) are adjacent PIIDs of
 * DIFFERENT programs — PIID adjacency is not a grouping key.
 */
export interface MechElecHolderRow {
  piid: string;
  contract_id: string;
  award_or_idv_flag: 'IDV';
  solicitation_identifier: string;
  multiple_or_single_award_idv_code: 'M' | 'S';
  awarding_agency: string;
  naics_code: string;
  incumbent_name: string;
  potential_total_value: number;
  total_obligation: number;
  ordering_period_end_date: string;
  period_of_performance_current_end: string | null;
  child_order_count: number;
  child_order_obligations: number;
}

const common = {
  award_or_idv_flag: 'IDV' as const,
  solicitation_identifier: 'FA850124R0001',
  multiple_or_single_award_idv_code: 'M' as const,
  awarding_agency: 'DEPARTMENT OF DEFENSE',
  naics_code: '238220',
  potential_total_value: 95_000_000,
  total_obligation: 0,
  ordering_period_end_date: '2029-04-23',
  period_of_performance_current_end: null,
};

export const MECH_ELEC_II_HOLDERS: MechElecHolderRow[] = [
  { ...common, piid: 'FA850124D0002', contract_id: 'CONT_IDV_FA850124D0002_9700', incumbent_name: 'NEW DOMINION CONSTRUCTION LLC', child_order_count: 2, child_order_obligations: 1_256_989.65 },
  { ...common, piid: 'FA850124D0003', contract_id: 'CONT_IDV_FA850124D0003_9700', incumbent_name: 'APEX FSE JV LLC', child_order_count: 4, child_order_obligations: 1_150_768 },
  { ...common, piid: 'FA850124D0004', contract_id: 'CONT_IDV_FA850124D0004_9700', incumbent_name: 'GULF PACIFIC CONTRACTING LLC', child_order_count: 11, child_order_obligations: 4_335_178 },
  { ...common, piid: 'FA850124D0005', contract_id: 'CONT_IDV_FA850124D0005_9700', incumbent_name: 'RCA CONTRACTING, INC.', child_order_count: 14, child_order_obligations: 10_258_350.35 },
];

/** Sum of child-order obligations across the four holders (USASpending, 2026-09-23). */
export const MECH_ELEC_II_ORDERED_TO_DATE = 17_001_286;
