/**
 * Credit integrity — WHEN a metered call is allowed to cost credits.
 *
 * The customer contract (Poteto: Credit Integrity, 2026-09-22):
 *   "Charge me when Mindy successfully performs the requested research. Do not take
 *    my credits because my request was invalid or because Mindy's required
 *    dependency failed."
 *
 * runMeteredTool debits AFTER the tool runs, in one atomic RPC. There is no
 * pre-debit, so no refund / compensating credit is ever needed: a non-billable
 * outcome is simply never debited. That is why this module decides billability
 * and nothing else — it never moves money.
 *
 * Two gates:
 *   1. preflightPaidInput()  — BEFORE execution. A tool whose required identity can
 *      arrive under alternative names (so the JSON schema can mark neither required)
 *      declares the set here. None present → invalid_input, the tool never runs.
 *   2. classifyBillingOutcome() — AFTER execution, BEFORE the debit. Reads a
 *      structured terminal state from `_meta`, never customer-facing prose.
 */

export type BillingOutcome =
  | 'billable_success'
  | 'billable_no_result'
  | 'nonbillable_invalid_input'
  | 'nonbillable_system_failure';

const OUTCOMES: ReadonlySet<string> = new Set<BillingOutcome>([
  'billable_success',
  'billable_no_result',
  'nonbillable_invalid_input',
  'nonbillable_system_failure',
]);

export function isBillable(outcome: BillingOutcome): boolean {
  return outcome === 'billable_success' || outcome === 'billable_no_result';
}

/**
 * The billing decision for a completed tool run.
 *
 * Precedence:
 *   1. An explicit `_meta.billing_outcome` set by the tool — the tool knows whether
 *      it performed the job (e.g. market-report `measurement_failure`, which can be
 *      `grounded` on optional sections while the REQUIRED measurement failed).
 *   2. DEFECT-7 (2026-08-24), unchanged: degraded AND ungrounded → system failure.
 *   3. Otherwise billable. Zero rows is NOT an error — a valid "found nothing" is a
 *      paid research answer (billable_no_result).
 */
export function classifyBillingOutcome(result: unknown): BillingOutcome {
  const meta = (result as { _meta?: Record<string, unknown> } | null | undefined)?._meta;
  const explicit = meta?.billing_outcome;
  if (typeof explicit === 'string' && OUTCOMES.has(explicit)) return explicit as BillingOutcome;
  if (meta?.degraded === true && meta?.grounded !== true) return 'nonbillable_system_failure';
  return meta?.grounded === false ? 'billable_no_result' : 'billable_success';
}

/**
 * Paid tools whose job needs AT LEAST ONE of several alternative identifiers.
 *
 * The schema cannot express "one of", so it marks both optional — and the MCP
 * SDK's zod parse STRIPS unknown keys. Measured 2026-09-22: `solicitation=` (not a
 * schema key) was dropped to `{}`, the dossier returned an empty miss in 1 ms, and
 * 100 credits were debited. Declare the set here and the call is refused before it
 * runs. Only list a tool when it can do NO useful work without one of these.
 */
export const REQUIRED_ONE_OF: Readonly<Record<string, readonly string[]>> = {
  build_pursuit_dossier: ['solicitation_number', 'notice_id'],
};

export interface InputRejection {
  code: 'invalid_input';
  message: string;
}

/** Null when the call has enough input to attempt the paid job. */
export function preflightPaidInput(name: string, args: Record<string, unknown>): InputRejection | null {
  const oneOf = REQUIRED_ONE_OF[name];
  if (!oneOf) return null;
  const present = oneOf.some((k) => {
    const v = args?.[k];
    return typeof v === 'string' && v.trim().length > 0;
  });
  if (present) return null;
  return {
    code: 'invalid_input',
    message:
      `${name} needs one of: ${oneOf.join(', ')} (a non-empty string). ` +
      'None was provided — argument names outside the tool schema are ignored. ' +
      'The tool did not run and nothing was charged.',
  };
}
