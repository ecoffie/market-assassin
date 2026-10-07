/**
 * Retrieval completeness for a target register: measured against an independent
 * listing, never asserted. Pure.
 *
 * "Coverage" here means: of the awards USASpending's award search attributes to this UEI,
 * how many did the transaction download also return, and is every difference explained?
 * It does NOT mean "all of the company's federal work" — subcontracts, classified work and
 * pre-2007-10-01 history are outside both sources, and the report says so.
 */
import type { DiligenceTxn } from './transactions';
import type { LiveAwardListing } from './usaspending-source';
import type { RegisterResult } from './register';

export interface FamilyMember {
  uei: string;
  name: string;
  /** Actions on which the source reported the target as this UEI's parent. */
  actions_reporting_target_as_parent: number;
  first_parent_report: string | null;
  last_parent_report: string | null;
}

/** Affiliates = UEIs whose own actions report the target as their parent. Evidence-based, dated. */
export function findReportedSubsidiaries(txns: DiligenceTxn[], targetUei: string): FamilyMember[] {
  const by = new Map<string, FamilyMember>();
  for (const t of txns) {
    if (t.recipient_uei === targetUei || t.recipient_parent_uei !== targetUei) continue;
    const m = by.get(t.recipient_uei) ?? {
      uei: t.recipient_uei,
      name: t.recipient_name,
      actions_reporting_target_as_parent: 0,
      first_parent_report: null,
      last_parent_report: null,
    };
    m.actions_reporting_target_as_parent++;
    if (!m.first_parent_report || t.action_date < m.first_parent_report) m.first_parent_report = t.action_date;
    if (!m.last_parent_report || t.action_date > m.last_parent_report) m.last_parent_report = t.action_date;
    by.set(t.recipient_uei, m);
  }
  return [...by.values()].sort((a, b) => b.actions_reporting_target_as_parent - a.actions_reporting_target_as_parent);
}

export interface CompletenessReport {
  uei: string;
  live_listing: { contracts: number; idvs: number; total: number };
  download: { contracts: number; idvs: number; total: number; transactions: number };
  in_both: number;
  listed_not_downloaded: Array<{ award_key: string; start_date: string | null }>;
  downloaded_not_listed: string[];
  agreement_pct: number | null;
  as_of_denominator: number;
  register_rows: number;
  register_coverage_pct: number | null;
  verdict: 'complete' | 'incomplete';
  verdict_reason: string;
}

export function measureCompleteness(input: {
  uei: string;
  txns: DiligenceTxn[];
  live: LiveAwardListing[];
  register: RegisterResult;
}): CompletenessReport {
  const { uei } = input;
  const liveOwn = input.live.filter((l) => l.recipient_uei === uei);
  const liveKeys = new Map(liveOwn.map((l) => [l.generated_internal_id, l]));
  const own = input.txns.filter((t) => t.recipient_uei === uei);
  const dlKinds = new Map<string, 'award' | 'idv'>();
  for (const t of own) dlKinds.set(t.award_key, t.kind);

  const listedNotDownloaded = [...liveKeys.keys()]
    .filter((k) => !dlKinds.has(k))
    .map((k) => ({ award_key: k, start_date: liveKeys.get(k)!.start_date }));
  const downloadedNotListed = [...dlKinds.keys()].filter((k) => !liveKeys.has(k));
  const inBoth = [...dlKinds.keys()].filter((k) => liveKeys.has(k)).length;

  const ownRows = input.register.rows.filter((r) => r.recipient_uei === uei);
  // As-of denominator = awards in the download with at least one action the register's own
  // inclusion rule admits. Register rows must equal it exactly; anything else is a bug.
  const expected = new Set<string>();
  for (const t of own) {
    if (t.action_date > input.register.as_of) continue;
    if (input.register.mode === 'reported_by_as_of' && t.initial_report_date && t.initial_report_date > input.register.as_of) continue;
    expected.add(t.award_key);
  }

  const total = liveKeys.size;
  const agreement = total === 0 ? null : Math.round((inBoth / total) * 1000) / 10;
  const coverage = expected.size === 0 ? null : Math.round((ownRows.length / expected.size) * 1000) / 10;

  let verdict: CompletenessReport['verdict'] = 'complete';
  let reason = 'every listed award was downloaded and every admissible award is in the register';
  if (ownRows.length !== expected.size) {
    verdict = 'incomplete';
    reason = `register has ${ownRows.length} awards but ${expected.size} are admissible at the as-of date`;
  } else if (downloadedNotListed.length > 0) {
    verdict = 'incomplete';
    reason = `${downloadedNotListed.length} downloaded awards are absent from the award listing — sources disagree`;
  } else if (listedNotDownloaded.length > 0) {
    // A listed award with no downloaded action can only be legitimate if all of its actions
    // predate the download window; the caller must explain each one, so the verdict stays open.
    verdict = 'incomplete';
    reason = `${listedNotDownloaded.length} listed awards have no downloaded transaction`;
  }

  return {
    uei,
    live_listing: {
      contracts: liveOwn.filter((l) => l.group === 'contracts').length,
      idvs: liveOwn.filter((l) => l.group === 'idvs').length,
      total,
    },
    download: {
      contracts: [...dlKinds.values()].filter((k) => k === 'award').length,
      idvs: [...dlKinds.values()].filter((k) => k === 'idv').length,
      total: dlKinds.size,
      transactions: own.length,
    },
    in_both: inBoth,
    listed_not_downloaded: listedNotDownloaded,
    downloaded_not_listed: downloadedNotListed,
    agreement_pct: agreement,
    as_of_denominator: expected.size,
    register_rows: ownRows.length,
    register_coverage_pct: coverage,
    verdict,
    verdict_reason: reason,
  };
}
