/**
 * Living GAO collector — the run's terminal outcome, as ONE pure decision.
 *
 * WHY THIS EXISTS (2026-11-23, Slack "GAO reconciliation failures / incomplete ingestion")
 * The route stamped the instance `content_stale` and fired `derived_pipeline_failure`
 * whenever `verifiedComplete` was false, but its OWN cron outcome ignored `partial`:
 * a run cut by the 240s budget self-reported `success`, answered HTTP 200 with
 * `success: true`, and left `cron_job_runs.error` NULL. The alert said "incomplete"
 * while the run history said "fine", and nothing recorded WHY.
 *
 * The rule: the cron outcome, the `success` flag, `status` and `verifiedComplete` are
 * all derived from the same facts here, so they cannot disagree. Every incomplete run
 * carries a concise reason (counts + first error messages per category).
 *
 * Vocabulary is the shared one `reportCronOutcome()` and the dispatcher already
 * understand (`src/lib/cron-self-report.ts`): `success` | `partial` | `error`.
 */
import { cronOutcomeHttpStatus, type CronOutcome } from '@/lib/cron-self-report';

/** Failure categories. Each is a different operational fact — never merged. */
export type GaoIssueCategory =
  | 'budget'            // run budget ran out before every document was processed
  | 'ingest_failed'     // ingestInstituteDocument returned an error
  | 'held_lookup_failed'// held IG id read failed (federal reports skipped)
  | 'reconcile_failed'  // reconcileUnresolvedGaoAgencies threw / a row read failed
  | 'blocked'           // derivation blocked (history unavailable / legacy reinjection)
  | 'source_down';      // an oversight.gov lane is down

const CATEGORY_ORDER: GaoIssueCategory[] = [
  'source_down', 'budget', 'ingest_failed', 'held_lookup_failed', 'reconcile_failed', 'blocked',
];

/** Keep at most this many example messages per category. */
export const MAX_MESSAGES_PER_CATEGORY = 2;
/** Each example message is trimmed to this length. */
export const MAX_MESSAGE_CHARS = 160;
/** The whole reason string never exceeds this (it lands in cron_job_runs.error). */
export const MAX_REASON_CHARS = 1000;

/** Accumulates issues across the run. Counts are exact; messages are examples. */
export class GaoRunIssues {
  private counts = new Map<GaoIssueCategory, number>();
  private messages = new Map<GaoIssueCategory, string[]>();

  add(category: GaoIssueCategory, message?: string | null): void {
    this.counts.set(category, (this.counts.get(category) ?? 0) + 1);
    if (!message) return;
    const list = this.messages.get(category) ?? [];
    const trimmed = trim(message);
    if (list.length < MAX_MESSAGES_PER_CATEGORY && !list.includes(trimmed)) list.push(trimmed);
    this.messages.set(category, list);
  }

  count(category: GaoIssueCategory): number {
    return this.counts.get(category) ?? 0;
  }

  /** Concise, deterministic summary: `category=N [first msg | second msg]; ...` */
  summary(): string | null {
    const parts: string[] = [];
    for (const c of CATEGORY_ORDER) {
      const n = this.count(c);
      if (n === 0) continue;
      const msgs = this.messages.get(c) ?? [];
      parts.push(msgs.length ? `${c}=${n} [${msgs.join(' | ')}]` : `${c}=${n}`);
    }
    if (parts.length === 0) return null;
    const joined = parts.join('; ');
    return joined.length > MAX_REASON_CHARS ? `${joined.slice(0, MAX_REASON_CHARS - 1)}…` : joined;
  }
}

function trim(message: string): string {
  const one = message.replace(/\s+/g, ' ').trim();
  return one.length > MAX_MESSAGE_CHARS ? `${one.slice(0, MAX_MESSAGE_CHARS - 1)}…` : one;
}

export interface GaoRunFacts {
  partial: boolean;
  failed: number;
  blocked: number;
  reconcileFailed: number;
  sourceDown: number;
  evidenceInserted: number;
  /** freshness.status from classifyGaoFreshness — only consulted for a clean, quiet run. */
  freshnessStatus: string;
}

export type GaoRunStatus = 'degraded' | 'upstream_quiet' | 'no_new_evidence' | 'advanced';

export interface GaoRunDecision {
  /** True only for a complete, clean reconciliation. Drives last_verified_ingest. */
  verifiedComplete: boolean;
  /** What reportCronOutcome records. Never `success` for an incomplete run. */
  outcome: CronOutcome;
  /** The response `success` flag — identical to `outcome === 'success'`. */
  success: boolean;
  status: GaoRunStatus;
  /** HTTP status of the response, aligned with the self-reported outcome so the
   *  dispatcher keeps the route's richer report (see dispatch-final-status.ts). */
  httpStatus: number;
}

export function decideGaoRunOutcome(f: GaoRunFacts): GaoRunDecision {
  const verifiedComplete = !f.partial && f.failed === 0 && f.blocked === 0
    && f.reconcileFailed === 0 && f.sourceDown === 0;
  const outcome: CronOutcome = verifiedComplete ? 'success' : 'partial';
  const status: GaoRunStatus = !verifiedComplete ? 'degraded'
    : f.evidenceInserted === 0
      ? (f.freshnessStatus === 'upstream_quiet' ? 'upstream_quiet' : 'no_new_evidence')
      : 'advanced';
  return {
    verifiedComplete,
    outcome,
    success: outcome === 'success',
    status,
    httpStatus: cronOutcomeHttpStatus(outcome),
  };
}
