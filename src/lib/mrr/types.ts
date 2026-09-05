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

// ─── Phase 1 completion: corporate-family + §11 / §12 / §15 contracts ───
// Locked by the lead after first-wave research. Implementers MUST use these
// shapes; do not invent alternate grounding enums or silent parent matches.

/** How a corporate-family identity was (or was not) established. */
export type FamilyResolveMethod =
  | 'usaspending_parent_uei'
  | 'self_null_or_absent_parent'
  | 'conflicting_parent_uei'
  | 'malformed_uei'
  | 'lookup_failed'
  | 'not_found';

/**
 * Confidence in the family identity.
 * `unresolved` MUST exclude the firm from Rule-of-Two supplier counts.
 */
export type FamilyConfidence = 'high' | 'medium' | 'unresolved';

/** Evidence backing one family resolution decision. */
export interface CorporateFamilyEvidence {
  /** Never `recipients_rollup_merged` — name-merge is forbidden for MRR RoT. */
  source: 'bq.usaspending.awards' | 'bq.usaspending.recipients' | 'injected_fixture';
  query: Record<string, unknown>;
  parentUeiDistinct: string[];
  support: Array<{ parentUei: string | null; awardCount: number; parentName?: string | null }>;
  retrievedAt: string;
  warehouseAsOf: string | null;
}

/**
 * Canonical corporate-family identity SEPARATE from raw UEI evidence.
 * Raw award/supplier rows stay keyed by UEI; this is the dedup unit for §11/§12.
 */
export interface CorporateFamilyResolution {
  canonical: { familyKey: string; displayName: string | null } | null;
  memberUeis: string[];
  method: FamilyResolveMethod;
  confidence: FamilyConfidence;
  evidence: CorporateFamilyEvidence;
  asOf: string | null;
  rawUei: string;
  /** False when ambiguous, failed, or malformed — cannot satisfy Rule of Two. */
  ruleOfTwoEligible: boolean;
  ineligibleReason?: string;
}

/** One row in the §11 Potential Supplier table (post family resolution). */
export interface SupplierRow {
  /** Canonical family / vendor display name. */
  canonicalName: GroundedField<string>;
  /** Legal entity name at the UEI grain (may differ from canonical). */
  legalEntityName: GroundedField<string>;
  uei: GroundedField<string>;
  cage: GroundedField<string>;
  businessSize: GroundedField<string>;
  socioeconomic: GroundedField<string[]>;
  location: GroundedField<string>;
  poc: GroundedField<string>;
  capabilityEvidence: GroundedField<string>;
  relevantAwardEvidence: GroundedField<string>;
  resolutionConfidence: GroundedField<FamilyConfidence>;
  family: CorporateFamilyResolution;
}

/** Rule-of-Two determination vocabulary (aligned with assess_market_depth). */
export type RuleOfTwoDetermination = 'met' | 'not_met' | 'undetermined';

export type SocioDesignation = '8(a)' | 'HUBZone' | 'SDVOSB' | 'WOSB' | 'EDWOSB';

export interface SocioCount {
  designation: SocioDesignation;
  /** Distinct parent-deduplicated families carrying this designation. */
  familyCount: GroundedField<number>;
}

/**
 * Injectable parent-edge lookup for tests. Production default queries BQ awards.
 * MUST NOT use name/amount/keyword heuristics to create parent matches.
 */
export interface ParentEdgeLookupResult {
  ok: boolean;
  error?: string;
  asOf: string | null;
  parents: Array<{ parentUei: string; awardCount: number; parentName: string | null }>;
  /** Members under the resolved family key (optional; resolver may re-query). */
  members?: string[];
  memberNames?: Record<string, string>;
  retrievedAt: string;
}

export type ParentEdgeLookup = (uei: string) => Promise<ParentEdgeLookupResult>;
