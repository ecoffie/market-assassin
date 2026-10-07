/**
 * Diligence transaction row — the ONLY shape the target register is built from.
 *
 * Source: USASpending "Contracts_PrimeTransactions" download (one row per FPDS action).
 *
 * Leakage-proof by construction: the download also carries award-level columns that
 * describe the award as it stands TODAY (total_dollars_obligated,
 * current_total_value_of_award, potential_total_value_of_award, total_outlayed_*).
 * Those are deliberately not parsed. Every as-of value is a sum or a latest-value of
 * PER-ACTION fields, restricted to actions on or before the as-of date.
 *
 * Measured 2026-10-07 on Halvik (H9240421F0077): Σ base_and_all_options_value over all
 * actions = $93,441,961.02 = the live award API's base_and_all_options, while the
 * row-level potential_total_value_of_award column read $76,233,453.52 (a stale
 * snapshot). So the per-action delta is the trustworthy field, and the snapshot column
 * is wrong even for current state.
 */

export interface DiligenceTxn {
  txn_key: string;
  award_key: string;
  piid: string;
  mod_number: string;
  transaction_number: string;
  kind: 'award' | 'idv';
  award_type: string | null;
  idv_type: string | null;
  idv_single_or_multiple: string | null;
  type_of_idc: string | null;
  parent_piid: string | null;
  parent_award_type: string | null;
  parent_single_or_multiple: string | null;
  action_date: string; // YYYY-MM-DD
  initial_report_date: string | null; // YYYY-MM-DD; null when the source omits it
  federal_action_obligation: number | null;
  base_and_exercised_options_value: number | null;
  base_and_all_options_value: number | null;
  pop_start: string | null;
  pop_current_end: string | null;
  pop_potential_end: string | null;
  ordering_period_end: string | null;
  recipient_uei: string;
  recipient_name: string;
  recipient_parent_uei: string | null;
  recipient_parent_name: string | null;
  cage_code: string | null;
  awarding_agency: string | null;
  awarding_sub_agency: string | null;
  awarding_office: string | null;
  set_aside: string | null;
  extent_competed: string | null;
  naics: string | null;
  psc: string | null;
  pricing: string | null;
  description: string | null;
  solicitation_identifier: string | null;
}

/** Columns this module refuses to read. Exported so a test can assert they never appear. */
export const CURRENT_STATE_COLUMNS = [
  'total_dollars_obligated',
  'current_total_value_of_award',
  'potential_total_value_of_award',
  'total_outlayed_amount_for_overall_award',
] as const;

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Empty stays null (unknown). "0" stays 0. Garbage throws — a silent NaN is worse than a stop. */
function num(v: unknown, field: string, key: string): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`non-numeric ${field}="${s}" on ${key}`);
  return n;
}

function day(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

export function parseTxnRow(r: Record<string, string>): DiligenceTxn {
  const key = str(r.contract_transaction_unique_key);
  const award = str(r.contract_award_unique_key);
  const action = day(r.action_date);
  const uei = str(r.recipient_uei);
  if (!key || !award || !action || !uei) {
    // Fail closed: a row we cannot identify or date cannot be placed before or after the cutoff.
    throw new Error(`unidentifiable transaction row: key=${key} award=${award} action_date=${r.action_date} uei=${uei}`);
  }
  const flag = str(r.award_or_idv_flag);
  return {
    txn_key: key,
    award_key: award,
    piid: str(r.award_id_piid) ?? '',
    mod_number: str(r.modification_number) ?? '0',
    transaction_number: str(r.transaction_number) ?? '0',
    kind: flag === 'IDV' ? 'idv' : 'award',
    award_type: str(r.award_type),
    idv_type: str(r.idv_type),
    idv_single_or_multiple: str(r.multiple_or_single_award_idv),
    type_of_idc: str(r.type_of_idc),
    parent_piid: str(r.parent_award_id_piid),
    parent_award_type: str(r.parent_award_type),
    parent_single_or_multiple: str(r.parent_award_single_or_multiple),
    action_date: action,
    initial_report_date: day(r.initial_report_date),
    federal_action_obligation: num(r.federal_action_obligation, 'federal_action_obligation', key),
    base_and_exercised_options_value: num(r.base_and_exercised_options_value, 'base_and_exercised_options_value', key),
    base_and_all_options_value: num(r.base_and_all_options_value, 'base_and_all_options_value', key),
    pop_start: day(r.period_of_performance_start_date),
    pop_current_end: day(r.period_of_performance_current_end_date),
    pop_potential_end: day(r.period_of_performance_potential_end_date),
    ordering_period_end: day(r.ordering_period_end_date),
    recipient_uei: uei,
    recipient_name: str(r.recipient_name) ?? '',
    recipient_parent_uei: str(r.recipient_parent_uei),
    recipient_parent_name: str(r.recipient_parent_name),
    cage_code: str(r.cage_code),
    awarding_agency: str(r.awarding_agency_name),
    awarding_sub_agency: str(r.awarding_sub_agency_name),
    awarding_office: str(r.awarding_office_name),
    set_aside: str(r.type_of_set_aside),
    extent_competed: str(r.extent_competed),
    naics: str(r.naics_code),
    psc: str(r.product_or_service_code),
    pricing: str(r.type_of_contract_pricing),
    description: str(r.prime_award_base_transaction_description) ?? str(r.transaction_description),
    solicitation_identifier: str(r.solicitation_identifier),
  };
}
