/**
 * FROZEN FIXTURE — IMI test (Industrial Mechanical Inc., UEI M66AH329AJM6), Workstream B.
 *
 * Provenance of `imi-expiring-ga-2382.rows.json`
 *   table   : recompete_opportunities (production Supabase, READ-ONLY)
 *   query   : node scripts/db.mjs recompete_opportunities --like naics_code=2382% \
 *               --eq place_of_performance_state=GA --order period_of_performance_current_end \
 *               --limit 500 --json --select contract_id,piid,incumbent_name,incumbent_uei,
 *               awarding_agency,awarding_sub_agency,naics_code,naics_description,psc_code,
 *               description,total_obligation,potential_total_value,period_of_performance_start,
 *               period_of_performance_current_end,place_of_performance_state,
 *               place_of_performance_city,set_aside_type,set_aside_enriched,competition_type,
 *               number_of_offers,estimated_recompete_date,lead_time_months,
 *               recompete_likelihood,contract_type,quality_flag
 *   captured: 2026-09-22 (the IMI run date)
 *   rows    : 77 — every GA 2382xx row, including expired / grouped_synthetic ones.
 *
 * `inWindowRows()` reproduces the tool's own query predicate (quality_flag IS NULL,
 * today < PoP end <= today + 18 months) against FROZEN_NOW, so closing dates cannot make the
 * tests nondeterministic. The stored `estimated_recompete_date` / `lead_time_months` are the
 * DB-trigger values as captured (PoP end − 12 months) — the BEFORE state.
 *
 * `IDV_DETAIL_FA850124D0005` is the USASpending award detail for Robins Mech-Elec II (RCA's
 * holder IDV): GET https://api.usaspending.gov/api/v2/awards/CONT_IDV_FA850124D0005_9700/,
 * captured 2026-09-22 (Workstream D evidence: scratchpad/subunder/detail-FA850124D0005.json),
 * reduced to the AwardDetail fields the rollup reads. Cross-checked the same day against
 * spending_by_award "Last Date to Order" = 2029-04-23.
 */
import type { AwardDetail } from '@/lib/usaspending/award-detail';
import rowsJson from './imi-expiring-ga-2382.rows.json';

export const FROZEN_NOW = '2026-09-22T12:00:00.000Z';

export interface FixtureRow {
  contract_id: string;
  piid: string | null;
  incumbent_name: string | null;
  incumbent_uei: string | null;
  awarding_agency: string | null;
  awarding_sub_agency: string | null;
  naics_code: string | null;
  naics_description: string | null;
  psc_code: string | null;
  description: string | null;
  total_obligation: number | null;
  potential_total_value: number | null;
  period_of_performance_start: string | null;
  period_of_performance_current_end: string | null;
  place_of_performance_state: string | null;
  place_of_performance_city: string | null;
  set_aside_type: string | null;
  set_aside_enriched: string | null;
  competition_type: string | null;
  number_of_offers: number | null;
  estimated_recompete_date: string | null;
  lead_time_months: number | null;
  recompete_likelihood: string | null;
  contract_type: string | null;
  quality_flag: string | null;
}

export const IMI_GA_2382_ROWS = rowsJson as unknown as FixtureRow[];

/** The rows get_expiring_contracts(naics=2382, state=GA) would retrieve on FROZEN_NOW (18-month default). */
export function inWindowRows(now: string = FROZEN_NOW, months = 18): FixtureRow[] {
  const today = now.slice(0, 10);
  const max = new Date(now);
  max.setMonth(max.getMonth() + months);
  const maxStr = max.toISOString().slice(0, 10);
  return IMI_GA_2382_ROWS.filter((r) => {
    const end = r.period_of_performance_current_end || '';
    return r.quality_flag === null && end > today && end <= maxStr;
  });
}

export const IDV_DETAIL_FA850124D0005: AwardDetail = {
  awardId: 'FA850124D0005',
  generatedId: 'CONT_IDV_FA850124D0005_9700',
  description: 'MAINTENANCE, REPAIR, AND ALTERATION OF MECHANICAL, ELECTRICAL AND ELECTRICAL SUB-SYSTEMS AT ROBINS AFB IN ACCORDANCE WITH THE STATEMENT OF WORK.',
  recipientName: 'RCA CONTRACTING, INC.',
  recipientCity: '',
  recipientState: '',
  recipientCongressionalDistrict: '',
  recipientUei: 'TR1AV9J17C93',
  obligated: 0,
  currentValue: 0,
  ceiling: 0,
  parentIdvId: null,
  parentIdvPiid: null,
  popStart: '2024-04-24',
  popEnd: '2029-04-23',
  popPotentialEnd: '2029-04-23',
  naicsCode: '238220',
  naicsDescription: '',
  pscCode: '',
  pscDescription: '',
  awardingAgency: 'Department of Defense',
  awardingSubAgency: 'Department of the Air Force',
  awardingOffice: '',
  fundingAccount: null,
  usaSpendingUrl: 'https://www.usaspending.gov/award/CONT_IDV_FA850124D0005_9700',
  multipleOrSingleAward: 'MULTIPLE AWARD',
  setAsideDescription: 'HUBZONE SET-ASIDE',
};
