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
import { describeUnrecognized, type UnrecognizedParam } from './unknown-params';

export type BillingOutcome =
  | 'billable_success'
  | 'billable_no_result'
  /** A useful but UNVERIFIED answer, charged the tool's reduced price (CANDIDATE_CREDITS). */
  | 'billable_candidate'
  | 'nonbillable_invalid_input'
  | 'nonbillable_not_configured'
  | 'nonbillable_system_failure'
  /** The tool ran and established that nothing defensible matched — not a sold answer. */
  | 'nonbillable_no_market';

const OUTCOMES: ReadonlySet<string> = new Set<BillingOutcome>([
  'billable_success',
  'billable_no_result',
  'billable_candidate',
  'nonbillable_invalid_input',
  'nonbillable_not_configured',
  'nonbillable_system_failure',
  'nonbillable_no_market',
]);

/**
 * Reduced price for a `billable_candidate` outcome, per tool. Owner decision 2026-10-04
 * (ChatGPT blocker #3, Option D, r = 10): capability_market_match charges 50 for a grounded
 * (company-corroborated) market, 10 for a useful candidate market, 0 for an empty or failed one.
 * A tool absent here is never charged a reduced price — its candidate outcome bills in full.
 */
export const CANDIDATE_CREDITS: Readonly<Record<string, number>> = {
  capability_market_match: 10,
};

/** The credits a completed, billable call is charged. Never more than the tool's base price. */
export function creditsForOutcome(tool: string, outcome: BillingOutcome, baseCredits: number): number {
  if (!isBillable(outcome)) return 0;
  if (outcome === 'billable_candidate') return Math.min(baseCredits, CANDIDATE_CREDITS[tool] ?? baseCredits);
  return baseCredits;
}

/**
 * Tier-1/Tier-2 tools (shared with Mindy Chat) report a refusal as
 * `{ ok: false, error: '<code>' }` and carry no `_meta`. Until 2026-10-02 those results
 * fell through to "billable" — `keyword_required`, `sam_unavailable`, `rate_limited`
 * and `lookup_failed` all cost the caller credits for work that never happened.
 *
 * Inventory of every `ok: false` code those modules return (tier1-tools.ts,
 * tier2-tools.ts), pinned by credit-integrity.unit.test.ts:
 *   invalid input  → keyword_required, naics_required, company_name_required,
 *                    naics_or_psc_required, unknown_set_aside, unknown_tool:<name>
 *   system failure → sam_unavailable, rate_limited, lookup_failed, and anything else
 * Unknown codes default to system failure: an unrecognised refusal is never billed.
 */
const INVALID_INPUT_ERROR = /(^|_)required$|^unknown_set_aside$|^unknown_tool:/;

export function errorCodeBillingOutcome(code: string): BillingOutcome {
  return INVALID_INPUT_ERROR.test(code) ? 'nonbillable_invalid_input' : 'nonbillable_system_failure';
}

export function isBillable(outcome: BillingOutcome): boolean {
  return outcome === 'billable_success' || outcome === 'billable_no_result' || outcome === 'billable_candidate';
}

/**
 * The billing decision for a completed tool run.
 *
 * Precedence:
 *   1. An explicit `_meta.billing_outcome` set by the tool — the tool knows whether
 *      it performed the job (e.g. market-report `measurement_failure`, which can be
 *      `grounded` on optional sections while the REQUIRED measurement failed).
 *   2. `_meta.validation_error` (pricing / incumbent-financials / regulatory-demand
 *      return it when no usable input was given) → invalid input. The tool did no
 *      research, so it is not a paid "found nothing".
 *   3. A Tier-1/Tier-2 refusal `{ ok: false, error: '<code>' }` → see
 *      errorCodeBillingOutcome().
 *   4. DEFECT-7 (2026-08-24), unchanged: degraded AND ungrounded → system failure.
 *   5. Otherwise billable. Zero rows is NOT an error — a valid "found nothing" is a
 *      paid research answer (billable_no_result).
 */
export function classifyBillingOutcome(result: unknown): BillingOutcome {
  const r = result as { ok?: unknown; error?: unknown; _meta?: Record<string, unknown> } | null | undefined;
  const meta = r?._meta;
  const explicit = meta?.billing_outcome;
  if (typeof explicit === 'string' && OUTCOMES.has(explicit)) return explicit as BillingOutcome;
  if (typeof meta?.validation_error === 'string' && meta.validation_error) return 'nonbillable_invalid_input';
  if (r?.ok === false && typeof r.error === 'string' && r.error) return errorCodeBillingOutcome(r.error);
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
  // Measured 2026-11-07, each with no identifier: returned in 0-1 ms having done no work, and
  // classified billable. Optional-filter tools that do real work unfiltered are deliberately
  // absent (search_federal_contacts, get_expiring_contracts, search_contractors...).
  get_contractor_award_history: ['company', 'uei'],
  get_award_detail: ['piid', 'id'],
  find_predecessor_award: ['naics_code', 'agency_name', 'title'],
  get_solicitation_incumbent: ['solicitation_number', 'notice_id'],
  lookup_sam_entity: ['uei', 'name'],
  match_company_to_pathways: ['uei', 'company_name', 'cage', 'cai'],
  understand_customer: ['notice_id', 'agency'],
  derive_company_keywords: ['description', 'past_performance', 'capabilities', 'code_titles'],
  extract_compliance_matrix: ['notice_id', 'rfp_text'],
  extract_statement_of_work: ['notice_id', 'rfp_text'],
  draft_proposal: ['notice_id', 'rfp_text'],
  search_agency_opps_by_office: ['agency', 'dodaac'],
  // A nationwide all-industry office ranking is refused by the tool itself; refuse it here first.
  get_buying_offices: ['state', 'naics', 'psc'],
  get_current_acquisition_intelligence: [
    'agency', 'office', 'dodaac', 'capability', 'keywords', 'naics', 'psc', 'notice_ids', 'contract_ids', 'piids',
  ],
};

/** A supplied value that can identify something: non-blank text, a non-empty list or object. */
function hasValue(v: unknown): boolean {
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return !!v && typeof v === 'object' && Object.keys(v).length > 0;
}

export interface InputRejection {
  code: 'invalid_input';
  message: string;
}

/** Null when the call has enough input to attempt the paid job. */
export function preflightPaidInput(
  name: string,
  args: Record<string, unknown>,
  unrecognized: readonly UnrecognizedParam[] = [],
): InputRejection | null {
  const oneOf = REQUIRED_ONE_OF[name];
  if (!oneOf) return null;
  if (oneOf.some((k) => hasValue(args?.[k]))) return null;
  const named = unrecognized.length ? `${describeUnrecognized(unrecognized)} ` : '';
  return {
    code: 'invalid_input',
    message:
      `${named}${name} needs one of: ${oneOf.join(', ')} (a non-empty value). ` +
      'None was provided — argument names outside the tool schema are ignored. ' +
      'The tool did not run and nothing was charged.',
  };
}
