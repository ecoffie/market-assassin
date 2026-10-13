/**
 * Target-centric public prime contract register, frozen at an as-of date.
 *
 * Pure: transactions in, register out. No I/O, no clock — the as-of date is an input,
 * so the same inputs always reproduce the same register.
 *
 * What it is: the public federal PRIME award record for a company as it could be known
 * on `asOf`. What it is not: revenue, backlog, or the target's contract register. Every
 * dollar is an obligation or an option value reported by an agency to FPDS.
 *
 * Rules (each one is a test in register.unit.test.ts):
 *  - dedupe on the FPDS transaction key; an identical duplicate is dropped and counted,
 *    a CONFLICTING duplicate fails closed (we cannot tell which one the agency meant)
 *  - an action counts only if action_date <= asOf AND (initial_report_date <= asOf, or the
 *    source carries no report date — counted and disclosed, never silently assumed)
 *  - obligated and option values are separate sums of per-action fields; never mixed
 *  - a sum over actions that are ALL null is null (unknown), not 0; a partial sum is
 *    returned with the count of null actions so the reader can see it is partial
 *  - "latest" fields (POP end, set-aside) come from the latest included action that
 *    carries a value; no value -> null
 */
import type { DiligenceTxn } from './transactions';

export type InclusionMode = 'reported_by_as_of' | 'action_dated_by_as_of';

export interface RegisterOptions {
  targetUei: string;
  asOf: string; // YYYY-MM-DD
  /** Affiliate UEIs to include, each tagged on its rows. The target's own UEI is always included. */
  affiliateUeis?: string[];
  /**
   * reported_by_as_of (default): the action must also have been REPORTED by asOf — what an
   * analyst could actually have seen. action_dated_by_as_of: economic as-of, ignores the
   * reporting lag. The difference is reported either way.
   */
  mode?: InclusionMode;
}

export interface SummedValue {
  value: number | null;
  /** Included actions whose field was null. > 0 with value != null means the sum is partial. */
  null_actions: number;
}

export interface RegisterRow {
  award_key: string;
  piid: string;
  kind: 'award' | 'idv';
  recipient_uei: string;
  recipient_name: string;
  relationship: 'target' | 'affiliate';
  award_type: string | null;
  idv_type: string | null;
  parent_piid: string | null;
  parent_award_type: string | null;
  parent_single_or_multiple: string | null;
  /** Derived only from the fields above; null when they do not establish it. */
  instrument: string | null;
  awarding_agency: string | null;
  awarding_sub_agency: string | null;
  awarding_office: string | null;
  naics: string | null;
  psc: string | null;
  description: string | null;
  set_aside_base: string | null;
  set_aside_latest: string | null;
  extent_competed_base: string | null;
  /** Latest CO business-size determination on an included action. */
  co_business_size_latest: string | null;
  /** Latest 8(a) participant flag on an included action. */
  c8a_participant_latest: string | null;
  obligated: SummedValue;
  base_and_exercised_options: SummedValue;
  base_and_all_options: SummedValue;
  pop_start: string | null;
  pop_current_end: string | null;
  pop_potential_end: string | null;
  ordering_period_end: string | null;
  /** active = POP current end on/after asOf; ended = before; unknown = no end date reported. */
  status_as_of: 'active' | 'ended' | 'unknown';
  first_action_date: string;
  last_action_date: string;
  action_count: number;
  actions_without_report_date: number;
  /** Provenance: the USASpending award page, keyed by the FPDS-derived award key. */
  source_url: string;
}

export interface RegisterResult {
  target_uei: string;
  as_of: string;
  mode: InclusionMode;
  rows: RegisterRow[];
  leakage: {
    max_included_action_date: string | null;
    max_included_report_date: string | null;
    excluded_actions_after_as_of: number;
    excluded_actions_reported_after_as_of: number;
    excluded_awards_entirely_after_as_of: number;
    included_actions_without_report_date: number;
  };
  dedupe: { input_rows: number; identical_duplicates_dropped: number };
  out_of_scope_ueis: Record<string, number>;
}

const VALUE_FIELDS = [
  'federal_action_obligation',
  'base_and_exercised_options_value',
  'base_and_all_options_value',
] as const;

function sameTxn(a: DiligenceTxn, b: DiligenceTxn): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function dedupeTransactions(txns: DiligenceTxn[]): { txns: DiligenceTxn[]; dropped: number } {
  const seen = new Map<string, DiligenceTxn>();
  let dropped = 0;
  for (const t of txns) {
    const prior = seen.get(t.txn_key);
    if (!prior) {
      seen.set(t.txn_key, t);
      continue;
    }
    if (!sameTxn(prior, t)) {
      throw new Error(`conflicting duplicate transaction ${t.txn_key}: the source reports two different versions`);
    }
    dropped++;
  }
  return { txns: [...seen.values()], dropped };
}

function actionOrder(a: DiligenceTxn, b: DiligenceTxn): number {
  return (
    a.action_date.localeCompare(b.action_date) ||
    a.mod_number.localeCompare(b.mod_number) ||
    a.transaction_number.localeCompare(b.transaction_number, undefined, { numeric: true })
  );
}

function sum(actions: DiligenceTxn[], field: (typeof VALUE_FIELDS)[number]): SummedValue {
  let total = 0;
  let known = 0;
  let nulls = 0;
  for (const a of actions) {
    const v = a[field];
    if (v === null) nulls++;
    else {
      total += v;
      known++;
    }
  }
  // Round to cents: FPDS values are cents; float summing must not invent sub-cent noise.
  return { value: known === 0 ? null : Math.round(total * 100) / 100, null_actions: nulls };
}

function latest<K extends keyof DiligenceTxn>(ordered: DiligenceTxn[], field: K): DiligenceTxn[K] | null {
  for (let i = ordered.length - 1; i >= 0; i--) {
    const v = ordered[i][field];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

function first<K extends keyof DiligenceTxn>(ordered: DiligenceTxn[], field: K): DiligenceTxn[K] | null {
  for (const t of ordered) {
    const v = t[field];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

/** Instrument from FPDS fields only. Restricted vs unrestricted MAC is NOT established here. */
export function deriveInstrument(t: {
  kind: 'award' | 'idv';
  award_type: string | null;
  idv_type: string | null;
  parent_piid: string | null;
  parent_award_type: string | null;
  parent_single_or_multiple: string | null;
  idv_single_or_multiple?: string | null;
}): string | null {
  if (t.kind === 'idv') {
    if (!t.idv_type) return null;
    const sm = t.idv_single_or_multiple ? ` (${t.idv_single_or_multiple.toLowerCase()})` : '';
    return `vehicle held: ${t.idv_type.toLowerCase()}${sm}`;
  }
  if (t.parent_piid) {
    const sm = t.parent_single_or_multiple?.toLowerCase() ?? null;
    switch (t.parent_award_type) {
      case 'GWAC':
        return 'order under a GWAC';
      case 'FSS':
        return 'order under a GSA Schedule (FSS)';
      case 'BPA':
        return sm ? `call under a ${sm} BPA` : 'call under a BPA';
      case 'IDC':
        return sm ? `order under a ${sm} IDIQ` : 'order under an IDIQ';
      case 'BOA':
        return 'order under a BOA';
      default:
        return null; // has a parent, but the source did not say what kind
    }
  }
  return t.award_type ? `standalone ${t.award_type.toLowerCase()}` : null;
}

export function buildRegister(input: DiligenceTxn[], opts: RegisterOptions): RegisterResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.asOf)) throw new Error(`asOf must be YYYY-MM-DD, got ${opts.asOf}`);
  const mode = opts.mode ?? 'reported_by_as_of';
  const inScope = new Set([opts.targetUei, ...(opts.affiliateUeis ?? [])]);

  const { txns, dropped } = dedupeTransactions(input);
  const outOfScope: Record<string, number> = {};
  const byAward = new Map<string, DiligenceTxn[]>();
  for (const t of txns) {
    if (!inScope.has(t.recipient_uei)) {
      outOfScope[t.recipient_uei] = (outOfScope[t.recipient_uei] ?? 0) + 1;
      continue;
    }
    const list = byAward.get(t.award_key) ?? [];
    list.push(t);
    byAward.set(t.award_key, list);
  }

  let afterAsOf = 0;
  let reportedAfter = 0;
  let awardsEntirelyAfter = 0;
  let noReportDate = 0;
  let maxAction: string | null = null;
  let maxReport: string | null = null;
  const rows: RegisterRow[] = [];

  for (const [awardKey, all] of byAward) {
    const included: DiligenceTxn[] = [];
    for (const t of all) {
      if (t.action_date > opts.asOf) {
        afterAsOf++;
        continue;
      }
      if (mode === 'reported_by_as_of' && t.initial_report_date && t.initial_report_date > opts.asOf) {
        reportedAfter++;
        continue;
      }
      included.push(t);
    }
    if (included.length === 0) {
      awardsEntirelyAfter++;
      continue;
    }
    included.sort(actionOrder);
    const base = included[0];
    const lastAction = included[included.length - 1].action_date;
    const withoutReport = included.filter((t) => !t.initial_report_date).length;
    noReportDate += withoutReport;
    if (!maxAction || lastAction > maxAction) maxAction = lastAction;
    for (const t of included) {
      if (t.initial_report_date && (!maxReport || t.initial_report_date > maxReport)) maxReport = t.initial_report_date;
    }

    const popEnd = latest(included, 'pop_current_end') as string | null;
    const parent = {
      parent_piid: first(included, 'parent_piid') as string | null,
      parent_award_type: first(included, 'parent_award_type') as string | null,
      parent_single_or_multiple: first(included, 'parent_single_or_multiple') as string | null,
    };
    const kind = base.kind;
    const awardType = first(included, 'award_type') as string | null;
    const idvType = first(included, 'idv_type') as string | null;

    rows.push({
      award_key: awardKey,
      piid: base.piid,
      kind,
      recipient_uei: base.recipient_uei,
      recipient_name: base.recipient_name,
      relationship: base.recipient_uei === opts.targetUei ? 'target' : 'affiliate',
      award_type: awardType,
      idv_type: idvType,
      ...parent,
      instrument: deriveInstrument({
        kind,
        award_type: awardType,
        idv_type: idvType,
        idv_single_or_multiple: first(included, 'idv_single_or_multiple') as string | null,
        ...parent,
      }),
      awarding_agency: base.awarding_agency,
      awarding_sub_agency: base.awarding_sub_agency,
      awarding_office: base.awarding_office,
      naics: first(included, 'naics') as string | null,
      psc: first(included, 'psc') as string | null,
      description: base.description,
      set_aside_base: base.set_aside,
      set_aside_latest: latest(included, 'set_aside') as string | null,
      extent_competed_base: base.extent_competed,
      co_business_size_latest: latest(included, 'co_business_size') as string | null,
      c8a_participant_latest: latest(included, 'c8a_participant') as string | null,
      obligated: sum(included, 'federal_action_obligation'),
      base_and_exercised_options: sum(included, 'base_and_exercised_options_value'),
      base_and_all_options: sum(included, 'base_and_all_options_value'),
      pop_start: first(included, 'pop_start') as string | null,
      pop_current_end: popEnd,
      pop_potential_end: latest(included, 'pop_potential_end') as string | null,
      ordering_period_end: latest(included, 'ordering_period_end') as string | null,
      status_as_of: popEnd === null ? 'unknown' : popEnd >= opts.asOf ? 'active' : 'ended',
      first_action_date: base.action_date,
      last_action_date: lastAction,
      action_count: included.length,
      actions_without_report_date: withoutReport,
      source_url: `https://www.usaspending.gov/award/${encodeURIComponent(awardKey)}`,
    });
  }

  rows.sort((a, b) => a.award_key.localeCompare(b.award_key));
  return {
    target_uei: opts.targetUei,
    as_of: opts.asOf,
    mode,
    rows,
    leakage: {
      max_included_action_date: maxAction,
      max_included_report_date: maxReport,
      excluded_actions_after_as_of: afterAsOf,
      excluded_actions_reported_after_as_of: reportedAfter,
      excluded_awards_entirely_after_as_of: awardsEntirelyAfter,
      included_actions_without_report_date: noReportDate,
    },
    dedupe: { input_rows: input.length, identical_duplicates_dropped: dropped },
    out_of_scope_ueis: outOfScope,
  };
}

/**
 * Leakage proof. Throws if anything in the register is dated after asOf. Run it on every
 * register before it is written anywhere; the script refuses to emit a register that fails.
 */
export function assertNoPostAsOfLeakage(result: RegisterResult): void {
  const { as_of, rows, leakage, mode } = result;
  if (leakage.max_included_action_date && leakage.max_included_action_date > as_of) {
    throw new Error(`leakage: included action dated ${leakage.max_included_action_date} > ${as_of}`);
  }
  if (mode === 'reported_by_as_of' && leakage.max_included_report_date && leakage.max_included_report_date > as_of) {
    throw new Error(`leakage: included action reported ${leakage.max_included_report_date} > ${as_of}`);
  }
  for (const r of rows) {
    if (r.first_action_date > as_of || r.last_action_date > as_of) {
      throw new Error(`leakage: ${r.award_key} carries an action after ${as_of}`);
    }
  }
}
