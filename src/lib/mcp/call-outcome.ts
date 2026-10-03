/**
 * MCP call OUTCOME telemetry — what a tool call actually produced, recorded per call in
 * `mcp_call_log` (columns added by 20261002_mcp_call_log_outcome.sql).
 *
 * WHY THIS EXISTS (tool portfolio audit, 2026-10-02): `mcp_call_log.status` answers a
 * BILLING question (was it charged?), not a QUALITY question. Across 9,289 calls the log
 * had never recorded `failed`, because tools catch their own errors and return a normal
 * value. So `status='success'` meant "did not throw", and nobody could measure whether a
 * tool returned real data, an honest empty, a degraded partial, or a refusal. Every
 * per-tool quality number in that audit stopped at "didn't throw".
 *
 * THE RULE: never infer success from "didn't throw". The outcome is read ONLY from
 * structured fields a tool emits (`_meta.grounded`, `_meta.degraded`,
 * `_meta.billing_outcome`, `_meta.validation_error`, `ok`/`error`, a numeric `count`).
 * A result that carries none of them is recorded as `unclassified` — an honest "this
 * tool does not tell us" — never as grounded. The `unclassified` share per tool is
 * itself the worklist for tools that still need a `_meta` contract.
 *
 * `status` is unchanged and still drives billing dashboards. `outcome` is the new axis.
 */
import { classifyBillingOutcome, type BillingOutcome } from '@/lib/mcp/credit-integrity';

export type CallOutcome =
  /** Real data returned (`_meta.grounded === true`, or a positive structured count). */
  | 'grounded'
  /** A valid query that honestly found nothing. A paid research answer, not a failure. */
  | 'no_result'
  /** Mindy's upstream/dependency failed and nothing usable came back. */
  | 'degraded'
  /** The tool ran but declined: invalid/missing input, or the account is not set up. */
  | 'refused'
  /** The tool threw. */
  | 'error'
  /** Never ran: credits, tier gate, extraction guard, input preflight, billing account. */
  | 'blocked'
  /** Ran, but emitted no structured signal to classify. Not counted as success. */
  | 'unclassified';

export interface OutcomeTelemetry {
  outcome: CallOutcome;
  /** `_meta.grounded` when the tool reports it; null when it does not. */
  grounded: boolean | null;
  /** `_meta.degraded` when the tool reports it; null when it does not. */
  degraded: boolean | null;
  /** The billing decision for a tool that ran; null when it never ran. */
  billingOutcome: BillingOutcome | null;
  /** Short machine code (never free text, never user input). */
  errorCode: string | null;
}

const CODE = /^[a-z0-9_:.-]{1,64}$/i;

/** Accept only a short machine code; anything else (prose, user input) is dropped. */
function safeCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!CODE.test(t)) return null;
  // unknown_tool:<name> echoes the requested tool name — keep only the class.
  return t.startsWith('unknown_tool:') ? 'unknown_tool' : t;
}

/** Classify a tool that RAN and returned a value. */
export function classifyCallOutcome(result: unknown): OutcomeTelemetry {
  const r = (result ?? {}) as { ok?: unknown; error?: unknown; count?: unknown; _meta?: Record<string, unknown> };
  const meta = r._meta;
  const grounded = typeof meta?.grounded === 'boolean' ? meta.grounded : null;
  const degraded = typeof meta?.degraded === 'boolean' ? meta.degraded : null;
  const billingOutcome = classifyBillingOutcome(result);

  const errorCode =
    safeCode(r.error) ??
    safeCode(meta?.validation_error) ??
    (billingOutcome === 'nonbillable_not_configured' ? 'not_configured' : null);

  let outcome: CallOutcome;
  if (billingOutcome === 'nonbillable_invalid_input' || billingOutcome === 'nonbillable_not_configured') {
    outcome = 'refused';
  } else if (billingOutcome === 'nonbillable_system_failure') {
    outcome = 'degraded';
  } else if (grounded === true) {
    outcome = 'grounded';
  } else if (grounded === false) {
    outcome = degraded === true ? 'degraded' : 'no_result';
  } else if (typeof r.count === 'number' && Number.isFinite(r.count)) {
    // Tier-1/Tier-2 tools carry no _meta but do return a structured row count.
    outcome = r.count > 0 ? 'grounded' : 'no_result';
  } else {
    outcome = 'unclassified';
  }

  return { outcome, grounded, degraded, billingOutcome, errorCode };
}

/** A call that never ran (pre-check refusal). */
export function blockedOutcome(code: string): OutcomeTelemetry {
  return { outcome: 'blocked', grounded: null, degraded: null, billingOutcome: null, errorCode: safeCode(code) };
}

/** A call whose tool threw. The exception message is NOT stored (it can echo input). */
export function errorOutcome(): OutcomeTelemetry {
  return { outcome: 'error', grounded: null, degraded: null, billingOutcome: null, errorCode: 'tool_exception' };
}
