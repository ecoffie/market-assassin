/**
 * Outcome of ONE precompute-briefings invocation — "no execution ≠ success".
 *
 * Measured 2026-09-26: 88 consecutive daily runs (2026-06-30 → 09-26) generated 0 templates
 * because every LLM provider returned 404 model_not_found, while the route answered 200
 * `success: true` and `cron_job_runs` recorded 86 × success/200. The dispatcher records any
 * non-2xx as `status='error'`, so the only way that failure becomes visible is the HTTP status.
 *
 * Semantics (one invocation; the self-chain is several invocations):
 *   nothing_to_do  — no profile needed a template (all exist / none found)      → 200
 *   deferred       — work exists but none was STARTED (time budget spent first)  → 200
 *   ok             — every started attempt produced a stored template            → 200
 *   partial        — some succeeded, some failed: real progress, surfaced        → 200, partial:true
 *   all_failed     — ≥1 attempt started and NONE succeeded                       → 502
 *
 * all_failed also STOPS the self-chain: re-firing into the same provider failure would repeat it
 * up to (profiles + 5) links a night. Repairing the model configuration is a separate change.
 */

export type PrecomputeVerdict = 'nothing_to_do' | 'deferred' | 'ok' | 'partial' | 'all_failed';

export interface PrecomputeAttempts {
  /** profiles needing a template this invocation (after skipping existing ones) */
  pending: number;
  /** generations STARTED this invocation */
  attempted: number;
  succeeded: number;
  failed: number;
}

export function precomputeVerdict(a: PrecomputeAttempts): PrecomputeVerdict {
  if (a.pending === 0) return 'nothing_to_do';
  if (a.attempted === 0) return 'deferred';
  if (a.succeeded === 0) return 'all_failed';
  if (a.failed > 0) return 'partial';
  return 'ok';
}

export function precomputeHttpStatus(v: PrecomputeVerdict): 200 | 502 {
  return v === 'all_failed' ? 502 : 200;
}

/** Keep chaining only while this invocation made progress or never got to try. */
export function shouldSelfChain(input: { stoppedEarly: boolean; remaining: number; verdict: PrecomputeVerdict }): boolean {
  return input.stoppedEarly && input.remaining > 0 && input.verdict !== 'all_failed';
}

/** Provider errors are long JSON blobs; keep the first few, each bounded, so a response stays readable. */
export function summarizeErrors(errors: string[], max = 5, maxLen = 400): string[] {
  return errors.slice(0, max).map((e) => (e.length > maxLen ? `${e.slice(0, maxLen)}…` : e));
}
