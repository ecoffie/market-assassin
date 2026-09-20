/**
 * CAI v0 compose contract — Phase 1 (Owned Evidence Architecture).
 *
 * Executable types + routing + killer-rule helpers. No ingest. No FR/pain as
 * OBSERVED_CHANGE. Compose implementation may import this; MCP tool ships later.
 *
 * Product question:
 *   Given buyer + capability: what changed about how this customer is buying,
 *   and what should I do differently because of it?
 */

/** Epistemic class — every claim is exactly one. */
export type CaiEpistemicClass =
  | 'observed_change'
  | 'current_state'
  | 'supported_implication'
  | 'do_differently'
  | 'not_yet_measurable';

/**
 * Owned living sources allowed in CAI v0 compose.
 * Internal-first: read these corpora (and spend-query over MARKET_SPEND_WINDOW
 * for CURRENT_STATE concentration only). Live gap-fill only per routing rules.
 */
export type CaiSourceKind =
  | 'recompete_changes'
  | 'recompete_opportunities'
  | 'sam_opportunities'
  | 'agency_forecasts'
  | 'usaspending_spend'
  | 'idv_search'
  | 'federal_contacts'
  | 'dodaac_directory'
  | 'sam_events'
  | 'pursuit_change_log';

/** Explicitly forbidden as OBSERVED_CHANGE / CURRENT_STATE buyer-fact in v0. */
export const CAI_FORBIDDEN_SOURCES = [
  'agency_pain_points_json',
  'agency_budget_data_json',
  'federal_register_passthrough',
  'institute_gao_pilot',
  'sblo_static_roster',
  'podcast_playbook',
  'keyword_coverage_1fy_as_market_size',
] as const;

export type CaiForbiddenSource = (typeof CAI_FORBIDDEN_SOURCES)[number];

export type CaiEvidenceClass =
  | 'observed_internal'
  | 'observed_live'
  | 'curated'
  | 'derived'
  | 'owner_asserted'
  | 'supported_link'
  | 'candidate_link'
  | 'not_established';

export interface CaiCitation {
  source_kind: CaiSourceKind;
  source_id: string | null;
  locator: string;
  as_of: string | null;
  evidence_class: CaiEvidenceClass;
}

export interface CaiItem {
  id: string;
  epistemic: CaiEpistemicClass;
  statement: string;
  citations: CaiCitation[];
  caused_by?: string[];
  magnitude?: {
    label: string;
    value: number | null;
    unit: 'count' | 'usd' | 'percent' | 'days' | 'other';
    unknown?: boolean;
  } | null;
}

export type ObservedPathwayKind =
  | 'conventional_solicitation'
  | 'idv_task_order'
  | 'cso'
  | 'other_transaction'
  | 'set_aside';

export type PotentialPathwayKind =
  | 'consortium'
  | 'rapid_acquisition_office'
  | 'pae_portfolio'
  | 'other_mechanism';

export const CAI_POTENTIAL_PATHWAY_KINDS: readonly PotentialPathwayKind[] = [
  'consortium',
  'rapid_acquisition_office',
  'pae_portfolio',
  'other_mechanism',
] as const;

export interface ObservedPathway {
  kind: ObservedPathwayKind;
  established: true;
  statement: string;
  citations: CaiCitation[];
  evidence_count: number;
}

export interface PotentialPathwayNotEstablished {
  kind: PotentialPathwayKind;
  established: false;
  statement: string;
}

export interface CaiComposeInput {
  agency?: string | null;
  office?: string | null;
  dodaac?: string | null;
  capability?: string | null;
  keywords?: string[] | null;
  naics?: string[] | null;
  psc?: string[] | null;
  notice_ids?: string[] | null;
  contract_ids?: string[] | null;
  piids?: string[] | null;
  /** Lookback for OBSERVED_CHANGE. Default 90. Clamp [7, 365]. */
  window_days?: number | null;
}

export interface CaiComposeResult {
  scope: {
    agency: string | null;
    office: string | null;
    dodaac: string | null;
    capability_label: string | null;
    keywords: string[];
    naics: string[];
    psc: string[];
    notice_ids: string[];
    contract_ids: string[];
    window_days: number;
    window_start: string;
    window_end: string;
  };
  presentation: {
    sections: Record<
      | 'what_changed'
      | 'what_we_are_seeing_now'
      | 'what_that_may_mean'
      | 'do_differently'
      | 'not_yet_measurable'
      | 'pathways',
      { display_title: string; provenance_label: string }
    >;
    host_rules: string[];
  };
  what_changed: CaiItem[];
  what_we_are_seeing_now: CaiItem[];
  what_that_may_mean: CaiItem[];
  do_differently: CaiItem[];
  not_yet_measurable: CaiItem[];
  pathways: {
    observed: ObservedPathway[];
    potential_not_established: PotentialPathwayNotEstablished[];
  };
  _next: Array<{
    prompt: string;
    requires_confirmation: boolean;
    tool?: string;
    credits?: number;
  }>;
  _meta: {
    grounded: boolean;
    degraded: boolean;
    journey: 'current_intelligence';
    epistemic_counts: Record<CaiEpistemicClass, number>;
    sources_queried: CaiSourceKind[];
    sources_failed: CaiSourceKind[];
    routing: CaiRoutingDecision[];
    next_outputs_not_yet: readonly [
      'pathway_recommendation',
      'talent_fit',
      'capability_statement',
      'response',
      'meeting_brief',
    ];
  };
}

export const CAI_SECTION_PRESENTATION = {
  what_changed: {
    display_title: 'What changed',
    provenance_label:
      "Observed deltas in Mindy's owned living data for this buyer + capability",
  },
  what_we_are_seeing_now: {
    display_title: "What we're seeing now",
    provenance_label:
      'Current concentration from owned opportunities, recompetes, 3-FY spend, vehicles, events, contacts',
  },
  what_that_may_mean: {
    display_title: 'What that may mean',
    provenance_label:
      'Supported implications — each tied to a cited change or current-state fact',
  },
  do_differently: {
    display_title: 'What you should do differently',
    provenance_label:
      'Actions only when caused by a cited change or current-state fact',
  },
  not_yet_measurable: {
    display_title: 'What Mindy cannot establish yet',
    provenance_label:
      'Gaps — including acquisition pathways without explicit evidence',
  },
  pathways: {
    display_title: 'Acquisition pathways (evidence only)',
    provenance_label:
      'Observed = explicitly established in records; potential = not established',
  },
} as const;

export const CAI_HOST_RULES: readonly string[] = [
  'Present sections under presentation.sections.*.display_title — never reframe curated research as buyer intent.',
  'Never invent a pathway (CSO, OT, consortium, rapid office, PAE) without a pathways.observed entry.',
  'Never center strategy on set-aside unless pathways.observed includes set_aside with citations for this scope.',
  'Every “do differently” line must mention what caused it (host should echo caused_by).',
  'Empty what_changed is honest — do not fill with pain points, Federal Register passthrough, or playbook.',
  'After this package, ask the capability/door question — do not ask set-aside-first.',
  'Do not present keyword-coverage 1-FY description totals as interchangeable with 3-FY market size.',
] as const;

export const CAI_NEXT_PROMPT = `Here's what changed around this market from Mindy's live records — and what I cannot yet establish about acquisition pathways.
Before I tell you how to position, let's determine which door the evidence says is actually open to you.
What capability can you deliver for this mission today, and what have you already done that proves it?`;

export const CAI_NEXT_OUTPUTS_NOT_YET = [
  'pathway_recommendation',
  'talent_fit',
  'capability_statement',
  'response',
  'meeting_brief',
] as const;

/** Minimum owned stack per compose section (Phase 1 — no strategic ingest). */
export const CAI_MINIMUM_STACK: Record<
  'what_changed' | 'what_we_are_seeing_now' | 'pathways',
  readonly CaiSourceKind[]
> = {
  what_changed: ['recompete_changes', 'pursuit_change_log'],
  what_we_are_seeing_now: [
    'sam_opportunities',
    'recompete_opportunities',
    'agency_forecasts',
    'usaspending_spend',
    'idv_search',
    'federal_contacts',
    'dodaac_directory',
    'sam_events',
  ],
  pathways: ['sam_opportunities', 'idv_search', 'recompete_opportunities'],
};

export type CaiRoutingAction =
  | 'use_owned'
  | 'owned_plus_live_verify'
  | 'gap_fill'
  | 'live_required'
  | 'not_established';

export interface CaiRoutingDecision {
  evidence_need:
    | 'change'
    | 'concentration'
    | 'spend'
    | 'pathway'
    | 'eligibility'
    | 'policy'
    | 'pricing'
    | 'company_fit';
  action: CaiRoutingAction;
  sources: CaiSourceKind[];
  reason: string;
}

/**
 * Internal-first routing for CAI compose evidence needs.
 * Policy/pricing/company_fit that lack owned living evidence → not_established
 * (do not call FR/CALC/EDGAR to fake completeness inside CAI).
 */
export function routeCaiEvidenceNeed(
  need: CaiRoutingDecision['evidence_need'],
): CaiRoutingDecision {
  switch (need) {
    case 'change':
      return {
        evidence_need: need,
        action: 'use_owned',
        sources: ['recompete_changes', 'pursuit_change_log'],
        reason:
          'Owned recompete_changes (+ caller-linked pursuit_change_log) are the only OBSERVED_CHANGE sources in v0',
      };
    case 'concentration':
      return {
        evidence_need: need,
        action: 'use_owned',
        sources: [
          'sam_opportunities',
          'recompete_opportunities',
          'agency_forecasts',
          'federal_contacts',
          'dodaac_directory',
          'sam_events',
        ],
        reason: 'Owned living procurement + org mirrors',
      };
    case 'spend':
      return {
        evidence_need: need,
        action: 'owned_plus_live_verify',
        sources: ['usaspending_spend'],
        reason:
          'CURRENT_STATE $ uses MARKET_SPEND_WINDOW (3-FY). Never substitute keyword_coverage 1-FY totals.',
      };
    case 'pathway':
      return {
        evidence_need: need,
        action: 'use_owned',
        sources: ['sam_opportunities', 'idv_search', 'recompete_opportunities'],
        reason: 'Observe only when establishment tests pass; else NYM',
      };
    case 'eligibility':
      return {
        evidence_need: need,
        action: 'owned_plus_live_verify',
        sources: ['sam_opportunities'],
        reason:
          'Set-aside on scoped notices is owned; consequential entity standing is outside CAI v0 (live verify elsewhere)',
      };
    case 'policy':
      return {
        evidence_need: need,
        action: 'not_established',
        sources: [],
        reason:
          'FR/IG/legislation/appropriations not persisted for CAI — emit not_yet_measurable, do not gap-fill with passthrough',
      };
    case 'pricing':
      return {
        evidence_need: need,
        action: 'not_established',
        sources: [],
        reason: 'CALC is LIVE_REQUIRED but out of CAI journey — do not compose rates into buyer-change',
      };
    case 'company_fit':
      return {
        evidence_need: need,
        action: 'not_established',
        sources: [],
        reason: 'Company fit is PATHWAY/TALENT next — not CAI v0',
      };
  }
}

export function clampCaiWindowDays(raw: number | null | undefined): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 90;
  return Math.min(365, Math.max(7, Math.round(n)));
}

export function isCaiForbiddenSource(source: string): source is CaiForbiddenSource {
  return (CAI_FORBIDDEN_SOURCES as readonly string[]).includes(source);
}

/**
 * Killer rule: do_differently / supported_implication must cite caused_by ids
 * that exist on OBSERVED_CHANGE or CURRENT_STATE items.
 */
export function passesCaiKillerRule(opts: {
  item: Pick<CaiItem, 'epistemic' | 'caused_by'>;
  allowedCauseIds: ReadonlySet<string>;
}): boolean {
  if (
    opts.item.epistemic !== 'do_differently' &&
    opts.item.epistemic !== 'supported_implication'
  ) {
    return true;
  }
  const causes = opts.item.caused_by || [];
  if (causes.length === 0) return false;
  return causes.every((id) => opts.allowedCauseIds.has(id));
}

/** Drop actions/implications that fail the killer rule. */
export function filterByCaiKillerRule(
  items: CaiItem[],
  causePool: CaiItem[],
): CaiItem[] {
  const allowed = new Set(
    causePool
      .filter(
        (i) =>
          i.epistemic === 'observed_change' || i.epistemic === 'current_state',
      )
      .map((i) => i.id),
  );
  return items.filter((item) =>
    passesCaiKillerRule({ item, allowedCauseIds: allowed }),
  );
}

export function potentialPathwayStatement(
  agency: string,
  kind: PotentialPathwayKind,
  capability: string,
): string {
  const labels: Record<PotentialPathwayKind, string> = {
    consortium: 'consortium',
    rapid_acquisition_office: 'rapid-acquisition office',
    pae_portfolio: 'PAE / portfolio ownership structure',
    other_mechanism: 'non-standard acquisition mechanism',
  };
  return `I cannot yet establish whether ${agency} intends to use a ${labels[kind]} for this ${capability} requirement from Mindy’s live records.`;
}

export function buildDefaultPotentialNotEstablished(
  agency: string | null,
  capability: string | null,
): PotentialPathwayNotEstablished[] {
  const a = agency?.trim() || 'this buyer';
  const c = capability?.trim() || 'capability';
  return CAI_POTENTIAL_PATHWAY_KINDS.map((kind) => ({
    kind,
    established: false,
    statement: potentialPathwayStatement(a, kind, c),
  }));
}
