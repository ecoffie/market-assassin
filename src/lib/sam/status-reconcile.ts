/**
 * SAM notice status reconciliation (C, 2026-11-10) — deactivate only on authoritative SAM evidence.
 *
 * Record: tasks/sam-status-reconciliation-2026-11-10.md §3 + §5. The first successful full sync after
 * R1 (2026-11-10 01:00 UTC) showed that "SAM did not return it" is NOT evidence on its own: 5,965 active
 * rows posted inside the 30-day window were absent, and a live lookup of 10 of them returned none —
 * 3,907 were simply past their archive date, and 929 of the 963 that still looked open had a newer
 * version under the same solicitation that SAM DID return (search lists only the current version).
 *
 * A row is deactivated ONLY when one of these holds:
 *   R1  SAM returns it with active = No. This is the ordinary upsert (`samActiveFlag` below) — it is
 *       counted and reported here, never re-derived.
 *   R2  absent from a fully completed run whose posted-date window covers the row, AND its archive
 *       date has passed.
 *   R3  absent from a fully completed covering run, AND a strictly newer notice (later posted date)
 *       under the same CONFIRMED solicitation number (familyIdentityKey `sol:`) was returned in that
 *       same run. A blank / non-identifier solicitation number is never linked (title merges are
 *       forbidden), so such rows are held.
 * Anything else is HELD: left unchanged and reported with its reason.
 *
 * Safety: report-only by default (SAM_STATUS_RECONCILE unset), a per-run flip cap that applies NOTHING
 * when exceeded, an audit row for every decision written BEFORE any flip ("no audit, no flip"), and
 * compare-and-set writes that cannot touch a row this run re-synced.
 */
import { familyIdentityKey } from '@/lib/sam/solicitation-family';

export type StatusReconcileMode = 'report' | 'apply' | 'off';

/** SAM_STATUS_RECONCILE: 'apply' deactivates, 'off' skips; anything else (incl. unset) only reports. */
export function statusReconcileMode(raw: string | undefined): StatusReconcileMode {
  const v = (raw || '').trim().toLowerCase();
  return v === 'apply' || v === 'off' ? v : 'report';
}

/** A run that wants to flip more than this applies nothing and reports an anomaly. */
export const STATUS_FLIP_CAP = 2000;
export const STATUS_FLIP_CHUNK = 500;

/** R1 — the single place SAM's `active` field becomes our column (used by the sync's mapToDbRecord). */
export function samActiveFlag(v: unknown): boolean {
  return v === true || v === 'Yes' || v === 'yes' || v === 'true';
}

const DAY = 86_400_000;
const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * The posted-date window a run can be trusted to have COVERED. The SAM request is day-granular and
 * built from the server's calendar date, so both boundary days are excluded: a notice posted on the
 * first or last day may sit on either side of SAM's own cut. Returns ISO date strings (YYYY-MM-DD).
 */
export function coveredWindow(runStart: Date, lookbackDays: number): { from: string; to: string } {
  const today = dayStart(runStart);
  return {
    from: new Date(today - (lookbackDays - 1) * DAY).toISOString().slice(0, 10),
    to: new Date(today - DAY).toISOString().slice(0, 10),
  };
}

export interface ReturnedNotice { notice_id: string; solicitation_number: string | null; posted_date: string | null; active: boolean }

/** What a run saw: every notice SAM returned, plus whether the run qualifies as complete. */
export interface RunCoverage {
  runId: string | null;
  syncType: string;
  /** Every page fetched and written, nothing failed, fetched >= available, no record limit. */
  complete: boolean;
  window: { from: string; to: string };
  returned: Map<string, ReturnedNotice>;
}

export interface ActiveRow {
  id: string;
  notice_id: string;
  solicitation_number: string | null;
  posted_date: string | null;
  archive_date: string | null;
  response_deadline: string | null;
}

export type ReconcileRule = 'R2_absent_archive_passed' | 'R3_absent_superseded';
export type HoldReason = 'absent_open_no_newer_version' | 'absent_no_confirmed_solicitation' | 'absent_same_day_sibling_only';

export interface ReconcileDecision {
  opp_id: string;
  notice_id: string;
  decision: 'deactivate' | 'held';
  rule: ReconcileRule | null;
  hold_reason: HoldReason | null;
  evidence: {
    run_id: string | null;
    window: { from: string; to: string };
    posted_date: string | null;
    archive_date: string | null;
    response_deadline: string | null;
    solicitation_number: string | null;
    newer_notice_id?: string;
    newer_posted_date?: string | null;
  };
}

export interface ReconcilePlan {
  /** Not evaluated: why. Null when the run qualified. */
  skipped: string | null;
  deactivate: ReconcileDecision[];
  held: ReconcileDecision[];
  /** Returned by SAM in this run with active = No (R1, applied by the upsert itself). */
  samInactiveReturned: number;
  capExceeded: boolean;
}

const dateOnly = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : null);

/** Rows that are active, posted strictly inside the covered window, and were NOT returned this run. */
export function absentCandidates(rows: ActiveRow[], cov: RunCoverage): ActiveRow[] {
  return rows.filter((r) => {
    const p = dateOnly(r.posted_date);
    return !!p && p >= cov.window.from && p <= cov.window.to && !cov.returned.has(r.notice_id);
  });
}

/** Pure decision step. `rows` = active rows in the covered window (absence is checked here). */
export function planStatusReconcile(rows: ActiveRow[], cov: RunCoverage, now: Date, cap = STATUS_FLIP_CAP): ReconcilePlan {
  let samInactiveReturned = 0;
  for (const n of cov.returned.values()) if (!n.active) samInactiveReturned++;
  const empty = { deactivate: [], held: [], samInactiveReturned, capExceeded: false };
  if (cov.syncType !== 'full') return { skipped: `sync type ${cov.syncType} is not a full covering run`, ...empty };
  if (!cov.complete) return { skipped: 'run incomplete (failed page, short fetch or record limit) — no absence evidence', ...empty };

  // Newest returned notice per confirmed solicitation family.
  const newest = new Map<string, ReturnedNotice>();
  for (const n of cov.returned.values()) {
    const key = familyIdentityKey(n.solicitation_number, n.notice_id);
    if (!key.startsWith('sol:')) continue;
    const cur = newest.get(key);
    if (!cur || String(n.posted_date || '') > String(cur.posted_date || '')) newest.set(key, n);
  }

  const nowMs = now.getTime();
  const deactivate: ReconcileDecision[] = [];
  const held: ReconcileDecision[] = [];
  for (const r of absentCandidates(rows, cov)) {
    const evidence: ReconcileDecision['evidence'] = {
      run_id: cov.runId, window: cov.window, posted_date: dateOnly(r.posted_date), archive_date: r.archive_date,
      response_deadline: r.response_deadline, solicitation_number: r.solicitation_number,
    };
    const base = { opp_id: r.id, notice_id: r.notice_id };
    if (r.archive_date && new Date(r.archive_date).getTime() < nowMs) {
      deactivate.push({ ...base, decision: 'deactivate', rule: 'R2_absent_archive_passed', hold_reason: null, evidence });
      continue;
    }
    const key = familyIdentityKey(r.solicitation_number, r.notice_id);
    if (!key.startsWith('sol:')) {
      held.push({ ...base, decision: 'held', rule: null, hold_reason: 'absent_no_confirmed_solicitation', evidence });
      continue;
    }
    const sib = newest.get(key);
    const mine = dateOnly(r.posted_date) || '';
    const sibPosted = dateOnly(sib?.posted_date) || '';
    if (sib && sib.notice_id !== r.notice_id && sibPosted > mine) {
      deactivate.push({ ...base, decision: 'deactivate', rule: 'R3_absent_superseded', hold_reason: null,
        evidence: { ...evidence, newer_notice_id: sib.notice_id, newer_posted_date: sibPosted } });
      continue;
    }
    held.push({ ...base, decision: 'held', rule: null,
      hold_reason: sib && sib.notice_id !== r.notice_id && sibPosted === mine ? 'absent_same_day_sibling_only' : 'absent_open_no_newer_version', evidence });
  }
  return { skipped: null, deactivate, held, samInactiveReturned, capExceeded: deactivate.length > cap };
}

/** Compact report for the run response / sam_sync_runs.status_reconcile. */
export function summarizePlan(plan: ReconcilePlan, mode: StatusReconcileMode, sample = 20) {
  const by = <K extends string>(xs: ReconcileDecision[], f: (d: ReconcileDecision) => K) => {
    const out: Record<string, { count: number; sample: string[] }> = {};
    for (const d of xs) { const k = f(d); (out[k] ??= { count: 0, sample: [] }).count++; if (out[k].sample.length < sample) out[k].sample.push(d.notice_id); }
    return out;
  };
  return {
    mode,
    skipped: plan.skipped,
    samInactiveReturned: plan.samInactiveReturned,
    wouldDeactivate: plan.deactivate.length,
    held: plan.held.length,
    capExceeded: plan.capExceeded,
    cap: STATUS_FLIP_CAP,
    byRule: by(plan.deactivate, (d) => d.rule as string),
    byHoldReason: by(plan.held, (d) => d.hold_reason as string),
  };
}

/** Rollback for one run (also in the PR body). */
export const restoreStatement = (runId: string) =>
  `update sam_opportunities set active = true where id in (select opp_id from sam_status_decisions where run_id = '${runId}' and applied) and active = false;`;

export interface ReconcileDeps {
  /** Insert one audit row per decision (sam_status_decisions). */
  writeAudit(rows: Array<Record<string, unknown>>): PromiseLike<{ error: { message: string } | null }>;
  /** CAS flip: active=true AND not re-synced since runStartIso → false. Returns ids actually flipped. */
  flipChunk(ids: string[], runStartIso: string): PromiseLike<{ flipped: string[] | null; error: { message: string } | null }>;
  /** Mark the audit rows of flipped ids applied=true (the rollback record). */
  markApplied(runId: string, ids: string[]): PromiseLike<{ error: { message: string } | null }>;
}

export interface ReconcileOutcome {
  auditWritten: number | null;
  /** Rows actually deactivated. null = unknown (a write errored mid-way). */
  deactivated: number | null;
  applyBlocked: string | null;
  errors: string[];
}

export async function executeStatusReconcile(
  plan: ReconcilePlan, mode: StatusReconcileMode, runId: string | null, runStartIso: string, deps: ReconcileDeps,
): Promise<ReconcileOutcome> {
  const out: ReconcileOutcome = { auditWritten: null, deactivated: mode === 'apply' ? null : 0, applyBlocked: null, errors: [] };
  if (mode === 'off' || plan.skipped) { out.auditWritten = 0; out.deactivated = 0; return out; }

  const decisions = [...plan.deactivate, ...plan.held];
  const auditRows = decisions.map((d) => ({
    run_id: runId, opp_id: d.opp_id, notice_id: d.notice_id, mode, decision: d.decision, rule: d.rule,
    hold_reason: d.hold_reason, evidence: d.evidence, applied: false,
  }));
  let auditOk = !!runId;
  if (!runId) out.errors.push('no sync run id — audit not written');
  for (let i = 0; runId && i < auditRows.length; i += STATUS_FLIP_CHUNK) {
    const { error } = await deps.writeAudit(auditRows.slice(i, i + STATUS_FLIP_CHUNK));
    if (error) { auditOk = false; out.errors.push(`audit write failed after ${i} rows: ${error.message}`); break; }
    out.auditWritten = Math.min(i + STATUS_FLIP_CHUNK, auditRows.length);
  }
  if (auditOk && auditRows.length === 0) out.auditWritten = 0;

  if (mode !== 'apply') return out;
  if (plan.capExceeded) { out.applyBlocked = `cap exceeded: ${plan.deactivate.length} > ${STATUS_FLIP_CAP} — nothing applied`; out.deactivated = 0; return out; }
  if (!auditOk) { out.applyBlocked = 'audit not recorded — no audit, no flip'; out.deactivated = 0; return out; }

  let flipped = 0;
  const ids = plan.deactivate.map((d) => d.opp_id);
  for (let i = 0; i < ids.length; i += STATUS_FLIP_CHUNK) {
    const { flipped: got, error } = await deps.flipChunk(ids.slice(i, i + STATUS_FLIP_CHUNK), runStartIso);
    if (error || got == null) { out.errors.push(`flip failed after ${flipped} rows: ${error?.message ?? 'unknown result'}`); out.deactivated = null; return out; }
    flipped += got.length;
    if (got.length) {
      const { error: markErr } = await deps.markApplied(runId!, got);
      if (markErr) out.errors.push(`rollback mark failed for ${got.length} rows: ${markErr.message} (restore by decision='deactivate' for this run)`);
    }
  }
  out.deactivated = flipped;
  return out;
}
