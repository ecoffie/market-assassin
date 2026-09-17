/**
 * PATHWAY FIT v0 — types (design: docs/PRD-pathway-fit-v0.md).
 * Thin two-sided matcher. No Talent. No vehicle-portfolio invention.
 */

export type PathwayDoorKind =
  | 'conventional_solicitation'
  | 'idv_task_order'
  | 'cso'
  | 'other_transaction'
  | 'set_aside'
  | 'consortium'
  | 'rapid_acquisition_office'
  | 'pae_portfolio'
  | 'other_mechanism';

export type PathwayDetermination =
  | 'SUPPORTED_FIT'
  | 'POSSIBLE_FIT'
  | 'NOT_ESTABLISHED'
  | 'NOT_APPLICABLE';

export type EvidenceClass =
  | 'government_public'
  | 'mindy_derived'
  | 'owner_asserted'
  | 'playbook_strategy';

export type ProofMissingCode =
  | 'vehicle_access_unverified'
  | 'demonstrable_product_unestablished'
  | 'measurable_outcome_unavailable'
  | 'delivery_speed_unavailable'
  | 'cso_topic_fit_weak'
  | 'socioeconomic_restriction_absent'
  | 'cert_self_identified_not_authoritative'
  | 'past_performance_weak_or_distant'
  | 'ot_nontraditional_status_unestablished'
  | 'buyer_door_not_observed'
  | 'company_identity_unresolved'
  | 'capability_relation_unestablished'
  | 'cai_door_not_yet_measurable'
  | 'other';

export interface PathwayCitation {
  source_kind: string;
  source_id: string | null;
  locator: string;
  as_of: string | null;
}

export interface CaiObservedPathway {
  kind: PathwayDoorKind;
  established: true;
  statement: string;
  citations: PathwayCitation[];
  evidence_count?: number;
  /** Optional restriction codes when kind=set_aside (e.g. SDVOSB, 8A). */
  set_aside_codes?: string[];
}

export interface CaiPotentialPathway {
  kind: PathwayDoorKind;
  reason?: string;
}

export interface CaiPackageSlim {
  scope: {
    agency: string;
    office?: string | null;
    capability: string;
    naics?: string[];
    psc?: string[];
    keywords?: string[];
  };
  pathways: {
    observed: CaiObservedPathway[];
    potential_not_established: CaiPotentialPathway[];
  };
  anchors?: {
    notice_ids?: string[];
    contract_ids?: string[];
    piids?: string[];
  };
  as_of?: string | null;
}

export interface CompanyAwardFact {
  id: string;
  title: string;
  agency: string;
  naics: string | null;
  psc?: string | null;
  amount: number;
  startDate: string | null;
  endDate: string | null;
  description?: string | null;
  /** Verified parent IDV / vehicle label when publicly known — rare in v0. */
  parent_idv?: string | null;
}

export interface CompanyCertFact {
  code: string;
  label: string;
  provenance_state: 'sba' | 'self' | 'vetcert' | 'unknown';
  authoritative: boolean;
}

export interface CompanyPublicRecord {
  uei: string | null;
  legal_name: string | null;
  cage: string | null;
  identity_source: 'sam_entity' | 'bq_recipient' | 'unresolved' | 'fixture';
  certifications: CompanyCertFact[];
  awards: CompanyAwardFact[];
  /**
   * Only populate when stranger-verifiable vehicle membership is known.
   * Empty in live v0 unless a specific award proves a named hold — never invent a portfolio.
   */
  verified_vehicle_holds: string[];
  /** Never infer from size/certs/age — only explicit public fact. */
  ot_nontraditional_established: boolean;
  /** Owner-asserted — display only; cannot upgrade determination. */
  owner_asserted?: {
    outcomes?: string[];
    claimed_vehicles?: string[];
    claimed_demo_ready?: boolean;
  };
}

export interface EvidenceItem {
  evidence_class: EvidenceClass;
  role: 'buyer_side' | 'company_side' | 'context';
  source_kind: string;
  source_id: string | null;
  locator: string;
  as_of: string | null;
  statement: string;
  provenance_state?: string | null;
  authoritative?: boolean;
}

export interface ProofLeadItem {
  kind: 'award' | 'certification' | 'entity' | 'notice' | 'other_public';
  label: string;
  piid?: string | null;
  customer?: string | null;
  work_description?: string | null;
  obligation?: number | null;
  period?: string | null;
  naics?: string | null;
  psc?: string | null;
  why_related: string;
  citations: EvidenceItem[];
}

export interface ProofMissingItem {
  code: ProofMissingCode;
  statement: string;
  blocks_upgrade_to?: 'SUPPORTED_FIT' | 'POSSIBLE_FIT' | null;
}

export interface AdditionalAdvantage {
  kind: 'certification' | 'geography' | 'other_public';
  statement: string;
  not_the_pathway_reason: true;
  citations: EvidenceItem[];
}

export interface RankComponents {
  buyer_certainty: 0 | 1 | 2;
  company_capability: 0 | 1 | 2;
  access_evidence: 0 | 1 | 2;
  recency_relevance: 0 | 1 | 2;
  missing_penalty: number;
  set_aside_opener_penalty: 0 | 5;
}

export interface PathwayDoorFit {
  door: PathwayDoorKind;
  door_label: string;
  determination: PathwayDetermination;
  buyer_evidence: EvidenceItem[];
  company_evidence: EvidenceItem[];
  why_this_fit: string | null;
  proof_to_lead_with: ProofLeadItem[];
  proof_missing: ProofMissingItem[];
  additional_advantages: AdditionalAdvantage[];
  safe_next_actions: string[];
  rank: { score: number; components: RankComponents };
}

export interface MatchCompanyToPathwaysInput {
  uei?: string;
  company_name?: string;
  cage?: string;
  /** Slim CAI package or full get_current_acquisition_intelligence result. */
  cai?: unknown;
  include_owner_asserted?: boolean;
}

export interface MatchCompanyToPathwaysResult {
  company: {
    uei: string | null;
    legal_name: string | null;
    cage: string | null;
    identity_source: CompanyPublicRecord['identity_source'];
    certifications: CompanyCertFact[];
  };
  buyer_context: {
    agency: string;
    office: string | null;
    capability: string;
    cai_as_of: string | null;
    observed_door_kinds: PathwayDoorKind[];
    not_yet_measurable_kinds: PathwayDoorKind[];
  };
  doors: PathwayDoorFit[];
  summary: {
    headline: string;
    no_proven_door: boolean;
    supported_count: number;
    possible_count: number;
    not_established_count: number;
    not_applicable_count: number;
  };
  owner_asserted_context?: {
    shown: boolean;
    items: Array<{ kind: string; statement: string }>;
    disclaimer: string;
  };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    journey: 'pathway_fit';
    epistemic_note: string;
    sources_queried: string[];
    sources_failed: string[];
    ranking_rule_version: 'pf_rank_v1';
    next_outputs_not_yet: string[];
    error?: string;
    /**
     * Canonical award-warehouse identity seam (#1548).
     * UEI is authoritative when well-formed. A company name is unique / ambiguous / none / degraded.
     * Ambiguous never auto-picks. none_in_award_corpus is not “no federal awards”.
     */
    identity_resolution?:
      | 'uei'
      | 'unique_name'
      | 'ambiguous'
      | 'none_in_award_corpus'
      | 'degraded'
      | 'malformed'
      | 'unresolved';
    identity_note?: string;
    identity_candidates?: Array<{
      name: string;
      uei: string;
      total_obligated: number;
      award_count: number;
    }>;
  };
  _next: Array<{
    prompt: string;
    requires_confirmation: boolean;
    tool?: string;
  }>;
  presentation: {
    host_rules: string[];
    sections: Record<string, { display_title: string; provenance_label: string }>;
  };
}

export const NYM_DOOR_KINDS: readonly PathwayDoorKind[] = [
  'consortium',
  'rapid_acquisition_office',
  'pae_portfolio',
  'other_mechanism',
] as const;

export const DOOR_LABELS: Record<PathwayDoorKind, string> = {
  conventional_solicitation: 'Open competition / posted solicitation path',
  idv_task_order: 'Existing contract vehicle / task-order path',
  cso: 'Commercial solutions / pitch-and-demo path',
  other_transaction: 'Other-transaction research path',
  set_aside: 'Socioeconomic-restricted path',
  consortium: 'Consortium path',
  rapid_acquisition_office: 'Rapid-acquisition office path',
  pae_portfolio: 'PAE / portfolio path',
  other_mechanism: 'Other acquisition mechanism',
};

export const HOST_RULES_PATHWAY_FIT = [
  'Every positive fit needs buyer_evidence AND company_evidence — never one-sided.',
  'Empty / no_proven_door is a COMPLETE SUCCESSFUL RESULT — intelligence, not a failure. Do not invent a door.',
  'When summary.no_proven_door is true, present: NO DOOR I CAN PROVE YET — "I don\'t have enough evidence to establish an acquisition door for this company yet." Then WHAT I CAN VERIFY, WHAT\'S MISSING (exact proof_missing), WHAT WOULD CHANGE THE ANSWER. Not apologetic.',
  'After no_proven_door: do NOT offer a research menu, restart FIND, search opportunities, research awards, inspect the company, offer dossier, offer monitor, or run more market research. Ask at most ONE proof_missing question, and only if answering it could change this determination. If _next is empty, STOP.',
  'Never claim win, pick, or vehicle bid rights without verified access evidence.',
  'Set-aside is never the automatic opener when other doors exist. Never ask set-aside-first after no_proven_door.',
  'Do not promote CAI NOT_YET_MEASURABLE doors (consortium, rapid, PAE).',
  'proof_to_lead_with = stranger-verifiable only; vault is labeled owner-asserted and does not upgrade.',
  'On a positive fit, ask one _next question from proof_missing — not a questionnaire, not set-aside-first.',
  'Customer need not know IDV/CSO/OT/NAICS jargon — use door_label language.',
] as const;

export const OWNER_ASSERTED_DISCLAIMER =
  'Owner-asserted company data is shown for context only. It does not upgrade pathway fit determinations in v0.';

/** Recency window for company capability (years). */
export const CAPABILITY_RECENCY_YEARS = 5;
