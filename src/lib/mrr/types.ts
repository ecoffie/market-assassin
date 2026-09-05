/**
 * Market Research Report (MRR) — Phase 1 vertical slice: shared types.
 *
 * The grounding model is a DISCRIMINATED UNION, not an optional-value object.
 * That is the whole point: `missing`, `failed`, `degraded` and `measured zero`
 * must not be able to collapse into one another. An optional `{value?: T}` shape
 * lets a failed query and a real zero serialize identically — which is the
 * `count ?? 0` data-fabrication class (Bug Prevention Rule #11) reappearing in a
 * document a contracting officer signs.
 *
 * Spec: WEEKEND.md "Grounding model"; docs/engineering/silent-failure-registry.md
 * ("no source ≠ zero", "no execution ≠ success").
 */

/** Where a rendered fact came from, and when. Required for every displayed value. */
export interface EvidenceRef {
  /** Human-readable source identity, e.g. "Mindy MCP get_keyword_coverage (USASpending)". */
  source: string;
  /** ISO-8601 UTC instant the value was retrieved. */
  retrievedAt: string;
  /** The EXACT arguments used, so a reviewer can re-run the query. */
  query: Record<string, unknown>;
  /** Optional deep link a reviewer can open (e.g. a USASpending award URL). */
  url?: string;
}

/**
 * One field's grounding state.
 *
 * - `value`      a real, sourced value.
 * - `true_zero`  a MEASURED zero. Distinct from missing; carries its own label.
 * - `unknown`    missing, failed, or ungrounded. NEVER rendered as 0.
 * - `degraded`   evidence exists but conflicts or is insufficient to assert.
 */
export type GroundedField<T> =
  | { state: 'value'; value: T; evidence: EvidenceRef }
  | { state: 'true_zero'; value: 0; label: string; evidence: EvidenceRef }
  | { state: 'unknown'; reason: string; attemptedEvidence?: EvidenceRef[] }
  | { state: 'degraded'; value?: T; reason: string; evidence: EvidenceRef[] };

/** The normalized requirement the orchestrator consumes. */
export interface Requirement {
  title: string;
  agency: string;
  sub_agency?: string;
  office?: string;
  naics?: string;
  psc?: string;
  keyword: string;
  est_value?: number;
  pop?: { start?: string; end?: string };
  place_of_performance_state?: string;
  description: string;
  /** A KO hypothesis. NEVER treated as fact — carried, never asserted. */
  set_aside_hint?: string;
  /** SAM solicitation number, when present — enables get_solicitation_incumbent. */
  solicitation_number?: string;
  /** SAM notice UUID, when present — enables get_solicitation_incumbent. */
  notice_id?: string;
}

/**
 * A normalized requirement PLUS the caller's untouched input.
 * WEEKEND.md Block 2: "Preserve the user's original inputs alongside normalized values."
 */
export interface NormalizedRequirement {
  normalized: Requirement;
  /** Verbatim input, before any normalization. */
  original: Record<string, unknown>;
  /** Field-level notes describing what normalization changed, for the appendix. */
  notes: string[];
}
