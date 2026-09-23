/**
 * find_opportunities — non-spatial Opportunity Map FIND composition.
 *
 * Composes three Maps horizons (Open now / Coming back / Coming soon) with
 * independent envelopes. One horizon failure never becomes a market-wide zero.
 * Does NOT change map viewport APIs. Cross-class dedupe is intentionally absent.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { recompeteRowAnnotations } from '@/lib/recompete/annotate';
import { parseAwardLineage, NOT_ORDER_UNDER_VEHICLE_OR } from '@/lib/recompete/award-lineage';
import {
  interpretMarket,
  evidenceWhy,
  plainEnglishInterpretation,
  type EvidenceClass,
  type MarketInterpretation,
} from '@/lib/opportunities/market-interpretation';
import {
  OPEN_FETCH_CAP,
  classifyOpenRecord,
  type OpenRelevanceClass,
  openEvidenceWhy,
  openEvidenceCounts,
  openRetrievalPsc,
} from '@/lib/opportunities/open-relevance';
// Canonical Mindy Discovery (2026-09-22, Phase B): MCP is the first production consumer.
// Meaning + eligibility come from the plan; this file owns only MCP surface policy + presentation.
import {
  buildDiscoveryPlan,
  applyOpenPlan,
  applyRecompetePlan,
  applyForecastPlan,
  rankRecords,
  matchesText,
  MCP_POLICY,
  type DiscoveryInput,
  type DiscoveryPlan,
  type SurfacePolicy,
  type ForecastCoverageGap,
} from '@/lib/discovery';
// Company-anchored FIND (IMI test, 2026-09-22). The anchor is a projection of lookup_sam_entity's
// canonical record; eligibility is a separate screen from relevance.
import {
  resolveCompanyAnchor,
  companyCodeRecall,
  companyRecallBasis,
  type CompanyAnchor,
  type CompanyAnchorResolution,
  type EntityLookup,
} from '@/lib/opportunities/company-anchor';
import {
  evaluateEligibility,
  evaluateRecompeteEligibility,
  unresolvedCompanyVerdict,
  type EligibilityStatus,
  type EligibilityVerdict,
} from '@/lib/opportunities/company-eligibility';
import {
  classifyComingBackEvidence,
  holderSignalWhy,
  buyerNameWhy,
  companyCodeWhy,
  type ComingBackClass,
  type MatchBasis,
} from '@/lib/opportunities/match-evidence';
// IMI Workstream C (2026-09-22): region (multi-state) + acquisition-stage intent.
import { normalizeStateCode } from '@/lib/utils/us-states';
import {
  parseStageGroup,
  stageOrExpr,
  unknownStageOrExpr,
  stageMatchFor,
  STAGE_GROUP_LABEL,
  ACQUISITION_STAGE_GROUPS,
  type AcquisitionStageGroup,
} from '@/lib/opportunities/acquisition-stage';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export type HorizonKey = 'open_now' | 'coming_back' | 'coming_soon';
export type HorizonStatus = 'grounded' | 'empty' | 'unavailable' | 'partial';

export type HandoffKey =
  | 'incumbent'
  | 'bid_fit'
  | 'dossier'
  | 'documents'
  | 'draft_response'
  | 'agency_intel'
  | 'contract_history'
  | 'recompete_planning'
  | 'market_intel'
  | 'prepare_positioning'
  | 'monitor_market'
  | 'monitor_notice';

export interface FindOpportunitiesInput {
  query: string;
  location?: string | null;
  agency?: string | null;
  set_aside?: string | null;
  timeframe?: {
    open_closing_days?: number | null;
    recompete_months?: number | null;
    forecast_include_past?: boolean | null;
  } | null;
  horizons?: Partial<Record<HorizonKey, boolean>> | null;
  limit_per_horizon?: number | null;
  advanced?: {
    naics?: string | null;
    psc?: string | null;
    keyword_exact?: string | null;
  } | null;
  /**
   * Optional SAM UEI. When present FIND is COMPANY-ANCHORED: the company's registered NAICS/PSC widen
   * recall (labelled company_registered_*, never DIRECT_MATCH) and every returned item carries an
   * `eligibility` verdict (ELIGIBLE | NOT_ELIGIBLE | UNKNOWN) judged separately from relevance.
   * Absent → the beginner first-turn FIND is unchanged.
   */
  uei?: string | null;
  /**
   * REGION: several states at once (["GA","AL","TN"], names or codes). ORed with each other and with
   * `location`. No radius math. Semantics per horizon are unchanged (Open = place of performance OR
   * buying office; Coming back = place of performance; Coming soon = pop_state). A value that is not
   * a US state is reported unresolved — it never widens the search to every state.
   */
  states?: string[] | string | null;
  /**
   * ACQUISITION STAGE intent (Open now only — it is a notice-type filter):
   *   MARKET_RESEARCH (RFI / sources sought) · VEHICLE_SOLICITATIONS (IDIQ/MACC/MATOC/JOC/SABER/BPA)
   *   · NON_FAR (CSO / OTA / BAA). Structured notice_type first, title keywords secondary; a notice
   *   with no recognised notice_type is excluded and counted, never guessed into a stage.
   */
  stage?: AcquisitionStageGroup | string | null;
}

/** Test/verification seams. Production passes nothing. */
export interface FindOpportunitiesDeps {
  client?: SupabaseClient;
  entityLookup?: EntityLookup;
}

export interface FindNextAction {
  prompt: string;
  tool?: string;
  credits?: number;
  requires_confirmation: boolean;
  suggested_args?: Record<string, unknown>;
  missing_inputs?: string[];
}

export interface HorizonItemBase {
  horizon: HorizonKey;
  title: string;
  buyer: string | null;
  location_label: string | null;
  relevant_date: string | null;
  relevant_date_label: string;
  value_label: string | null;
  source: string;
  why_this_matched: string;
  identity: { kind: string; id: string };
  evidence_class?: EvidenceClass | 'HOLDER_SIGNAL';
  /** What put this row in front of the customer (buy-side vs holder/buyer name vs company codes). */
  match_basis?: MatchBasis[];
  /** Company-anchored FIND only (input.uei). Separate from relevance. */
  eligibility?: EligibilityVerdict;
}

export type HorizonItem = HorizonItemBase & Record<string, unknown>;

export interface HorizonResult {
  status: HorizonStatus;
  matched_count: number | null;
  returned_count: number;
  items: HorizonItem[];
  source: string;
  as_of: string | null;
  filters_consumed: string[];
  filters_unsupported: string[];
  unmapped_count: number | null;
  error: { class: string; message: string } | null;
  allowed_handoffs: HandoffKey[];
  semantics_note: string | null;
  evidence_counts?: EvidenceCounts | null;
  /** Coming Soon only: forecast publisher coverage when it is not complete (canonical plan). */
  coverage?: { state: 'partial' | 'unestablished'; gaps: ForecastCoverageGap[] };
  /** Coming Back only: task/delivery orders the plan matched and excluded (null = count unavailable). Internal. */
  orders_excluded?: number | null;
  /** Company-anchored FIND only: verdict counts over the RETURNED items (not the matched population). */
  eligibility_counts?: Record<EligibilityStatus, number> | null;
  /** Stage-filtered FIND only (input.stage). Open now carries the counts; other horizons say "not applied". */
  stage?: HorizonStage | null;
}

export interface HorizonStage {
  group: AcquisitionStageGroup;
  label: string;
  applied: boolean;
  /**
   * Open now: notices that matched every OTHER filter but carry no recognisable notice_type, so they
   * were excluded from the stage filter. null = the count query failed (unknown, never 0).
   */
  excluded_unknown_stage_count: number | null;
  /** Signal split over the RETURNED items (structured notice_type vs secondary title keyword). */
  returned_by_signal: { structured_notice_type: number; title_keyword: number } | null;
  note: string;
}

export interface FindRegion {
  /** Every location token asked for (location + states), as typed. */
  requested: string[];
  /** Resolved 2-letter state codes — the filter actually applied. */
  states: string[];
  /** Tokens that are not a US state (e.g. "Robins AFB"). Never widen; reported, not guessed. */
  unresolved: string[];
}

export interface EvidenceCounts {
  DIRECT_MATCH: number;
  RELATED_MARKET_CANDIDATE: number;
  /** Coming back: rows whose ONLY evidence is the holder's name. Never part of DIRECT. */
  HOLDER_SIGNAL?: number;
  /** Company-anchored FIND: rows recalled only by the company's registered PSC/NAICS. */
  COMPANY_REGISTERED_CODE?: number;
}

export interface FindCompanySummary {
  uei: string;
  status: CompanyAnchorResolution['status'];
  legal_name: string | null;
  source: CompanyAnchor['source'] | null;
  as_of: string | null;
  note: string | null;
  /** Registered codes that widened recall (exact codes, not families). */
  recall_codes: { naics: string[]; psc: string[] } | null;
  /** Per-NAICS SAM size representation, verbatim tri-state. */
  size_by_naics: CompanyAnchor['size_by_naics'] | null;
  location: CompanyAnchor['location'] | null;
}

export interface FindOpportunitiesResult {
  query_summary: {
    query: string;
    location: string | null;
    agency: string | null;
    timeframe: FindOpportunitiesInput['timeframe'];
    set_aside: string | null;
    horizons_requested: HorizonKey[];
    interpreted_as: Record<HorizonKey, string>;
    /** Present when location/states were passed. */
    region?: FindRegion;
    /** Present when stage was passed. */
    stage?: AcquisitionStageGroup | null;
  };
  market_interpretation: MarketInterpretation;
  presentation_note: string;
  /** Present only when input.uei was passed. */
  company?: FindCompanySummary;
  horizons: Record<HorizonKey, HorizonResult>;
  summary: {
    open_now: { status: HorizonStatus; matched_count: number | null };
    coming_back: {
      status: HorizonStatus;
      matched_count: number | null;
      direct_match: number | null;
      related_market_candidate: number | null;
      /** Holder-name-only rows. A subcontracting lead to check, not demand for this work. */
      holder_signal: number | null;
    };
    coming_soon: { status: HorizonStatus; matched_count: number | null };
    headline: string;
    claim_hygiene: string;
  };
  _meta: {
    grounded: boolean;
    degraded: boolean;
    composition: 'opportunity_map_horizons_v1';
    expansion_note: string;
    watch_coverage: Array<'open_now' | 'coming_soon'>;
    find_shape: 'specific' | 'broad';
    /** Credit integrity: set only when the tool knows the request could not be performed as asked. */
    billing_outcome?: 'nonbillable_invalid_input';
    /** Which canonical discovery plan ran (audit trail; MCP is a consumer of src/lib/discovery). */
    discovery?: { plan_version: number; status: string; refinement: string | null; eligibility: string };
  };
  _next: FindNextAction[];
  presentation: {
    host_rules: string[];
    sections: Record<string, { display_title: string; provenance_label: string }>;
  };
}

/** P2 — local presentation contract on the FIND result (CAI/PATHWAY pattern). */
export const HOST_RULES_FIND_FIRST_VALUE = [
  'FIRST VALUE: present this result immediately. Do not ask questions before showing it.',
  'HERE\'S WHERE I SEE THE MONEY — use presentation.sections titles in order: Open now, Coming back, Coming soon. Report each horizon\'s own status. An unavailable or failed horizon is a coverage gap — never zero / none / empty demand.',
  'WHERE I WOULD START: one evidence-supported point from the returned items (prefer a live Open hit if grounded; else Coming back; else Coming soon). Do not invent a solicitation for a recompete or forecast.',
  'WHY: 1–3 concise reasons from this result\'s evidence only.',
  'WHAT I CAN\'T ESTABLISH YET: one material limitation if any (sparse coverage, unavailable horizon, broad query).',
  'ONE FIND: this call is the first-value FIND. Do not call find_opportunities again before presenting. Do not fan out parallel FIND variants.',
  'Then ask at most ONE plain-English refinement (what they actually sell). WAIT. Do not auto-call understand_customer or get_current_acquisition_intelligence even if `_next` offers them — those are confirmation-gated after first value.',
  'Do not ask company identity, UEI, CAGE, certifications, clearance, FCL, set-aside, vehicle, or desired deliverable before presenting this. Do not expose NAICS/PSC/ATO/CNO/CEMA/CSO/OT/PAE/FCL in the refinement unless the user already used that word.',
  'Do not web-search or create an artifact on this turn. Do not ask market map vs access-path vs capability statement.',
  'Clearance is not a first-value question. Do not call it a hard gate because the buyer is SOCOM.',
  'EVIDENCE CLASS: DIRECT_MATCH is confirmed relevance to what they asked to sell. RELATED_MARKET_CANDIDATE is this buyer’s broader market that can contain that work. Never count related-market rows as confirmed cyber (or other capability) demand. Never mix the two into one “cyber contracts” number. Explain the distinction in plain English. Do not dump NAICS/PSC.',
  'COMING BACK SPLIT: when summary.coming_back has related_market_candidate > 0, say “N contracts with direct cybersecurity evidence and M related SOCOM IT contracts worth reviewing.” Never say “N+M cybersecurity recompetes/contracts.” presentation_note and summary.headline already split the counts — use them.',
  'INTERPRETATION: use presentation_note / market_interpretation.truth. Buyer alias (SOCOM = U.S. Special Operations Command) is spelling, not a wider department. Never say you searched all of DoD. Never claim the entire IT-services market is cybersecurity.',
  'COMING SOON UNAVAILABLE: if coming_soon status is unavailable because this buyer has no forecast publisher, that is coverage not established — not a measured zero. Do not invent forecast rows from parent-department feeds.',
  'COMING SOON PARTIAL: if coming_soon status is partial, its count covers only the buyers with a forecast publisher. Name the buyers listed in coverage.gaps as not measured — never say they have zero upcoming buys.',
  'HOLDER_SIGNAL: a Coming back row labelled HOLDER_SIGNAL matched only on the incumbent\'s NAME (e.g. a firm called “… Machining and Fabrication”). It is NOT a direct match and NOT demand for this work — never count it with DIRECT_MATCH. At most say the holder\'s name suggests related work worth checking; the contract itself (see naics_code / psc_code) may be something else entirely.',
] as const;

/** Added to host_rules ONLY for a company-anchored call (input.uei). The beginner first turn is unchanged. */
export const HOST_RULES_COMPANY_ANCHORED = [
  'COMPANY-ANCHORED: this FIND used the company\'s own SAM registration (see `company`). Items with match_basis company_registered_psc / company_registered_naics were recalled by a code the company REGISTERED — say so; they are not a match on the words typed and never a DIRECT_MATCH.',
  'ELIGIBILITY is separate from relevance. Report each item\'s eligibility.status with its reason: ELIGIBLE, NOT_ELIGIBLE (say why — e.g. not small under the notice NAICS), or UNKNOWN. Never turn UNKNOWN into eligible or not eligible. A missing set-aside is UNKNOWN, not unrestricted. Size is per NAICS — never call the company "small" in general.',
  'Coming back eligibility is always UNKNOWN: a recompete is not a live solicitation and its set-aside is not stated yet. Coming soon eligibility reflects the agency\'s ANTICIPATED set-aside only.',
] as const;

export const FIND_FIRST_VALUE_SECTIONS = {
  open_now: {
    display_title: 'Open now',
    provenance_label: 'Live solicitations for this query — grounded, empty, or unavailable (unavailable is not zero)',
  },
  coming_back: {
    display_title: 'Coming back',
    provenance_label: 'Contracts likely to recompete — not a live solicitation number',
  },
  coming_soon: {
    display_title: 'Coming soon',
    provenance_label: 'Agency forecasts / planned demand — not a live solicitation number',
  },
  start: {
    display_title: 'Where I would start',
    provenance_label: 'One item from the returned evidence — not a new lookup',
  },
  why: {
    display_title: 'Why',
    provenance_label: '1–3 reasons from this result only',
  },
  gaps: {
    display_title: "What I can't establish yet",
    provenance_label: 'Coverage gap or query limit — never fabricated as zero',
  },
  related: {
    display_title: 'Related market — not confirmed',
    provenance_label: 'RELATED_MARKET_CANDIDATE rows. Broader market at this buyer; not confirmed capability demand',
  },
} as const;

/** Added ONLY when input.stage was passed. */
export const HOST_RULES_STAGE = [
  'STAGE FILTER: Open now was filtered to the requested acquisition stage (see horizons.open_now.stage). Say which stage. Coming back and Coming soon are NOT stage-filtered (a recompete or forecast has no notice type) — present them as context, not as RFIs / vehicles / non-FAR notices.',
  'Each Open item carries acquisition_stage.signal: structured_notice_type (the SAM notice type says so) or title_keyword (secondary — only the title names it). Notices with no recognisable notice type were excluded and counted in excluded_unknown_stage_count — mention it when > 0; never call them zero.',
] as const;

/** Added ONLY when a location token could not be resolved to a US state. */
export const HOST_RULES_REGION = [
  'LOCATION: query_summary.region.unresolved lists places that are not a US state (e.g. a base name). They were NOT searched and no radius was applied — say which states were searched. If no state resolved, the location matched nothing; ask for the state instead of calling it zero demand.',
] as const;

export function buildFindPresentation(
  companyAnchored = false,
  extra: { stage?: boolean; regionUnresolved?: boolean } = {},
): FindOpportunitiesResult['presentation'] {
  return {
    host_rules: [
      ...HOST_RULES_FIND_FIRST_VALUE,
      ...(companyAnchored ? HOST_RULES_COMPANY_ANCHORED : []),
      ...(extra.stage ? HOST_RULES_STAGE : []),
      ...(extra.regionUnresolved ? HOST_RULES_REGION : []),
    ],
    sections: FIND_FIRST_VALUE_SECTIONS as FindOpportunitiesResult['presentation']['sections'],
  };
}

const OPEN_HANDOFFS: HandoffKey[] = [
  'incumbent', 'bid_fit', 'dossier', 'documents', 'draft_response',
  'agency_intel', 'market_intel', 'prepare_positioning', 'monitor_market', 'monitor_notice',
];
const BACK_HANDOFFS: HandoffKey[] = [
  'incumbent', 'agency_intel', 'contract_history', 'recompete_planning',
  'market_intel', 'prepare_positioning', 'monitor_market',
];
const SOON_HANDOFFS: HandoffKey[] = [
  'agency_intel', 'market_intel', 'prepare_positioning', 'monitor_market',
];

const WATCH_COVERAGE = ['open_now', 'coming_soon'] as const;

function sb(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function clampLimit(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 5;
  return Math.min(Math.max(Math.floor(v), 1), 25);
}

function moneyLabel(n: unknown): string | null {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function locLabel(city: string | null | undefined, state: string | null | undefined): string | null {
  const c = (city || '').trim();
  const s = (state || '').trim();
  if (c && s) return `${c}, ${s}`;
  return s || c || null;
}

function unavailable(source: string, handoffs: HandoffKey[], message: string, unsupported: string[] = []): HorizonResult {
  return {
    status: 'unavailable',
    matched_count: null,
    returned_count: 0,
    items: [],
    source,
    as_of: null,
    filters_consumed: [],
    filters_unsupported: unsupported,
    unmapped_count: null,
    error: { class: 'query_failed', message },
    allowed_handoffs: handoffs,
    semantics_note: 'Source unavailable — do not treat as zero matches.',
  };
}

function emptyHorizon(
  source: string,
  handoffs: HandoffKey[],
  consumed: string[],
  unsupported: string[],
  asOf: string | null,
  note: string | null,
  unmapped: number | null = 0,
): HorizonResult {
  return {
    status: 'empty',
    matched_count: 0,
    returned_count: 0,
    items: [],
    source,
    as_of: asOf,
    filters_consumed: consumed,
    filters_unsupported: unsupported,
    unmapped_count: unmapped,
    error: null,
    allowed_handoffs: handoffs,
    semantics_note: note,
  };
}

async function tableAsOf(client: SupabaseClient, table: string, col: string): Promise<string | null> {
  try {
    const { data, error } = await client.from(table).select(col).order(col, { ascending: false }).limit(1);
    if (error || !data?.[0]) return null;
    const v = (data[0] as unknown as Record<string, unknown>)[col];
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

type InterpretedQuery = {
  /** What the customer asked, verbatim (presentation only — never re-parsed downstream). */
  searchText: string;
  /** The canonical discovery plan. Every horizon executes THIS; none re-reads the query. */
  plan: DiscoveryPlan;
  stateCode: string | null;
  agency: string;
  setAside: string;
  openClosingDays: number;
  recompeteMonths: number;
  forecastIncludePast: boolean;
  market: MarketInterpretation;
  interpreted: Record<HorizonKey, string>;
  /** Company-anchored FIND: the resolution (null when no uei was passed). */
  company: CompanyAnchorResolution | null;
  /** Region (location ∪ states), resolved. null when no location was asked. */
  region: FindRegion | null;
  /** Acquisition-stage intent (Open now only). 'invalid' = an unrecognised value (never silently ignored). */
  stage: AcquisitionStageGroup | 'invalid' | null;
  /**
   * The SAME plan without the company's codes — only when the company widened recall. Each horizon
   * also fetches it and unions the rows, so text/taxonomy matches can never be starved out of a
   * capped, date-ordered fetch window by the (often much larger) registered-code population.
   */
  basePlan: DiscoveryPlan | null;
};

/**
 * MCP's explicit SURFACE policy on top of the shared MCP_POLICY default. The customer's timeframe
 * narrows the horizons; it never changes what the query means.
 */
export function mcpDiscoveryPolicy(input: FindOpportunitiesInput): SurfacePolicy {
  const openClosingDays = Math.max(0, Number(input.timeframe?.open_closing_days) || 0);
  const recompeteMonths = Math.min(60, Math.max(1, Number(input.timeframe?.recompete_months) || 18));
  return {
    ...MCP_POLICY,
    open: { ...MCP_POLICY.open, ...(openClosingDays ? { closingDays: openClosingDays } : {}) },
    recompete: { windowMonths: recompeteMonths },
    forecast: { includePastFiscalYears: !!input.timeframe?.forecast_include_past },
  };
}

/**
 * MCP arguments → the canonical discovery input. `advanced.keyword_exact` is an EXACT phrase
 * request, so it reaches the plan quoted (the plan treats a fully quoted query as literal).
 */
/** Location separators a person types: "GA, AL", "GA/AL/TN", "Robins AFB / GA", "GA; TN". */
const LOCATION_SPLIT = /\s*[,;/|]\s*/;

/**
 * location ∪ states → resolved 2-letter codes + the tokens that are not a US state. Pure.
 * Returns null when no location was asked (the only case that may search every state).
 */
export function resolveRegion(input: Pick<FindOpportunitiesInput, 'location' | 'states'>): FindRegion | null {
  const fromStates = Array.isArray(input.states) ? input.states : input.states != null ? [input.states] : [];
  const tokens = [String(input.location || ''), ...fromStates.map((s) => String(s ?? ''))]
    .flatMap((t) => t.split(LOCATION_SPLIT))
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  const states: string[] = [];
  const unresolved: string[] = [];
  for (const t of tokens) {
    const code = normalizeStateCode(t);
    if (code) { if (!states.includes(code)) states.push(code); }
    else if (!unresolved.includes(t)) unresolved.push(t);
  }
  return { requested: tokens, states, unresolved };
}

/**
 * Asked for a location but none of it is a US state → a code no row carries. Every horizon then
 * fails CLOSED through its existing state handling (map-filters parseStateList → NO_MATCH sentinel;
 * recompete/forecast eq never matches). The PR #1435 lesson: an asked-for filter that resolves to
 * nothing must match nothing — never widen to the whole corpus.
 */
export const UNRESOLVED_REGION_SENTINEL = 'ZZ';

export function mcpDiscoveryInput(input: FindOpportunitiesInput, anchor?: CompanyAnchor | null): DiscoveryInput {
  const exact = String(input.advanced?.keyword_exact || '').replace(/"/g, ' ').trim();
  const company = companyCodeRecall(anchor);
  const region = resolveRegion(input);
  return {
    ...(company ? { company } : {}),
    query: exact ? `"${exact}"` : String(input.query || '').trim(),
    agency: String(input.agency || '').trim() || null,
    state: !region ? null : region.states.length ? region.states.join(',') : UNRESOLVED_REGION_SENTINEL,
    setAside: String(input.set_aside || '').trim() || null,
    naics: String(input.advanced?.naics || '').trim() || null,
    psc: String(input.advanced?.psc || '').trim() || null,
  };
}

function eligibilityLabel(plan: DiscoveryPlan): string {
  const m = plan.matcher;
  if (m.mode === 'exact_phrase') return `exact phrase "${m.phrase}"`;
  if (m.mode === 'code') return `code ${m.phrase}`;
  if (m.mode !== 'lexical') return 'no text concept';
  return m.alternatives
    .map((a) => `${a.eligibility === 'all' ? 'ALL' : 'ANY'}(${a.eligible.map((c) => c.label).join(' · ')})${a.rankOnly.length ? ` rank-only(${a.rankOnly.map((c) => c.label).join(' · ')})` : ''}`)
    .join(' OR ');
}

/** What the plan consumed — derived from the plan, never hand-maintained per horizon. */
function consumedFor(plan: DiscoveryPlan, horizon: HorizonKey, stage: AcquisitionStageGroup | 'invalid' | null = null): string[] {
  const out = [`canonical_discovery:v${plan.version}`, `eligibility:${eligibilityLabel(plan)}`];
  if (plan.buyers.length) out.push(`agency→identity_words(${plan.buyers.map((b) => b.requested).join('|')})`);
  if (plan.states.length) out.push(`location→${horizon === 'open_now' ? 'pop_or_office' : horizon === 'coming_back' ? 'place_of_performance_state' : 'pop_state'}(${plan.states.join('|')})`);
  if (stage && stage !== 'invalid' && horizon === 'open_now') out.push(`stage→${stage}(notice_type·title_secondary)`);
  if (plan.setAsides.length) out.push(`set_aside→${plan.setAsides.join('|')}`);
  if (plan.naics.length) out.push(`naics→${plan.naics.join('|')}`);
  if (plan.psc.length) out.push(`psc→${plan.psc.join('|')}`);
  if (plan.company) out.push(`company_registered_codes∪recall(naics:${plan.company.naics.length}${horizon === 'coming_soon' ? '' : `,psc:${plan.company.psc.length}`})`);
  if (plan.matcher.excluded.length) out.push(`exclude→${plan.matcher.excluded.map((c) => c.label).join('|')}`);
  if (plan.intent.stripped.length) out.push(`stripped→${plan.intent.stripped.join('|')}`);
  if (horizon === 'open_now') {
    out.push('status=active');
    if (plan.horizons.open.via === 'text_or_taxonomy') out.push('query→text∪direct_taxonomy');
    if (plan.policy.open.closingDays) out.push(`timeframe.open_closing_days=${plan.policy.open.closingDays}`);
  } else if (horizon === 'coming_back') {
    out.push('quality_flag=null', 'pop_end≥today', `recompete_via=${plan.horizons.recompete.via}`, `timeframe.recompete_months=${plan.policy.recompete.windowMonths}`);
  } else {
    out.push(plan.policy.forecast.includePastFiscalYears ? 'timeframe.forecast_include_past' : 'exclude_past_fy', `forecast_via=${plan.horizons.forecast.via}`);
  }
  out.push('rank→evidence_tier·breadth·score·date');
  return out;
}

/** Resolve the customer request through CANONICAL DISCOVERY (src/lib/discovery). */
function interpretQuery(input: FindOpportunitiesInput, company: CompanyAnchorResolution | null = null): InterpretedQuery {
  const policy = mcpDiscoveryPolicy(input);
  const plan = buildDiscoveryPlan(mcpDiscoveryInput(input, company?.anchor), policy);
  const basePlan = plan.company ? buildDiscoveryPlan(mcpDiscoveryInput(input, null), policy) : null;
  const keywordText = plan.intent.residualKind === 'keyword' ? plan.intent.residual.replace(/^"|"$/g, '') : '';
  const primaryAgency = String(input.agency || '').trim() || plan.buyers[0]?.requested || null;
  // Presentation + evidence labelling: the SAME capability the plan retrieved with, plus the buyer.
  const market = interpretMarket(keywordText, primaryAgency);
  const recompeteMonths = policy.recompete.windowMonths ?? 18;
  const elig = eligibilityLabel(plan);
  return {
    searchText: String(input.advanced?.keyword_exact || input.query || '').trim(),
    plan,
    stateCode: plan.states.filter((s) => s !== UNRESOLVED_REGION_SENTINEL).join(',') || null,
    agency: plan.buyers.map((b) => b.requested).join(', '),
    setAside: String(input.set_aside || '').trim() || plan.setAsides.join(','),
    openClosingDays: policy.open.closingDays || 0,
    recompeteMonths,
    forecastIncludePast: policy.forecast.includePastFiscalYears,
    market,
    company,
    basePlan,
    region: resolveRegion(input),
    stage: parseStageGroup(input.stage),
    interpreted: {
      open_now: `Canonical discovery (${plan.horizons.open.via}): ${elig}; buyer = whole-word identity on department OR sub_tier; geo = place-of-performance OR buying-office state; rank = evidence tier → breadth → score → deadline`,
      coming_back: `Canonical discovery (${plan.horizons.recompete.via}): ${elig}; buyer = awarding_agency OR awarding_sub_agency identity; geo = place_of_performance_state; window ≤${recompeteMonths}mo`,
      coming_soon: `Canonical discovery (${plan.horizons.forecast.via}): ${elig}; agency = forecast identity codes; geo = pop_state; ${policy.forecast.includePastFiscalYears ? 'past fiscal years INCLUDED (opt-in)' : 'current + future fiscal years'}; unresolved publisher → unavailable, not zero`,
    },
  };
}

/** A plan that cannot define a market (exclusion-only / nothing recognizable). Never a market zero. */
function blockedHorizon(source: string, handoffs: HandoffKey[], plan: DiscoveryPlan): HorizonResult {
  return {
    status: 'unavailable',
    matched_count: null,
    returned_count: 0,
    items: [],
    source,
    as_of: null,
    filters_consumed: [`canonical_discovery:v${plan.version}`, `status:${plan.status}`],
    filters_unsupported: [],
    unmapped_count: null,
    error: { class: plan.status, message: plan.refinement || 'The query needs a positive scope.' },
    allowed_handoffs: handoffs,
    semantics_note: 'Not searched: the request only excludes or names nothing searchable. This is a refinement ask — not zero demand.',
  };
}

const OPEN_TIER: Record<string, number> = { DIRECT_MATCH: 0, RELATED_MARKET_CANDIDATE: 1, COMPANY_CODE: 1.5, WEAK_NON_MARKET: 2 };

/**
 * MCP evidence label for an Open row. MCP's labeller (classifyOpenRecord) stays authoritative for
 * cyber (physical-security exclusion, related-market IT). Two gaps it had, both measured in the
 * Phase B replay, are closed from the canonical plan:
 *   - a plan with NO text concept (buyer / state / NAICS / set-aside only): every admitted row IS
 *     the requested market. The old labeller called all 280 VA notices for "veterans affairs"
 *     WEAK_NON_MARKET ("does not establish this market").
 *   - a non-cyber text query whose eligibility is satisfied in the row's VISIBLE text: that is
 *     direct textual evidence. The old labeller required every ≥3-letter token, so real
 *     "AI Governance" titles were WEAK (the 2-letter "ai" never counted).
 * A row admitted only via sow_text (not returned to the host) stays WEAK — the evidence isn't shown.
 */
function openEvidenceClass(row: Record<string, unknown>, plan: DiscoveryPlan, cap: MarketInterpretation['capability']): OpenRelevanceClass {
  const cls = classifyOpenRecord({
    title: String(row.title || ''),
    description: String(row.description || ''),
    naics_code: (row.naics_code as string) || '',
    psc_code: (row.psc_code as string) || '',
    department: String(row.department || ''),
    solicitation_number: String(row.solicitation_number || ''),
    response_deadline: (row.response_deadline as string) || null,
  }, cap);
  if (cls !== 'WEAK_NON_MARKET' || cap.kind === 'cyber_with_related_it') return cls;
  if (plan.matcher.mode === 'none') return 'DIRECT_MATCH';
  if (matchesText(plan.matcher, [row.title as string, row.description as string, row.department as string, row.solicitation_number as string])) return 'DIRECT_MATCH';
  return cls;
}

function codeIn(list: string[], value: unknown): boolean {
  const v = String(value || '').trim();
  if (!v || !list.length) return false;
  return list.some((c) => (c.length < 6 ? v.startsWith(c) : v === c));
}

export interface OpenLabel {
  cls: OpenRelevanceClass;
  basis: MatchBasis[];
  /** Sort tier: DIRECT 0 · RELATED 1 · company-code recall 1.5 · other 2. */
  tier: number;
}

/**
 * Open row → evidence class + WHAT established it. A DIRECT_MATCH must survive with the identity
 * fields (buying department, solicitation number) blanked: a match that exists only in the BUYER'S
 * NAME is the buyer's broader market (RELATED_MARKET_CANDIDATE, basis buyer_name), not the work.
 * (Code-mode queries keep solicitation_number — the user typed an identifier.) Rows recalled only by
 * the company's registered PSC/NAICS stay non-DIRECT and are labelled company_registered_*.
 */
export function labelOpenRow(
  row: Record<string, unknown>,
  plan: DiscoveryPlan,
  cap: MarketInterpretation['capability'],
  anchor?: CompanyAnchor | null,
): OpenLabel {
  let cls = openEvidenceClass(row, plan, cap);
  const basis: MatchBasis[] = [];
  if (cls === 'DIRECT_MATCH') {
    if (plan.matcher.mode === 'none') basis.push('structured_scope');
    else {
      const codeHit = codeIn([...cap.direct.naics, ...plan.naics], row.naics_code)
        || codeIn([...openRetrievalPsc(cap), ...plan.psc], row.psc_code);
      const keepId = plan.matcher.mode === 'code';
      const stripped = { ...row, department: '', sub_tier: '', solicitation_number: keepId ? row.solicitation_number : '' };
      if (codeHit) basis.push('buy_side_code');
      else if (openEvidenceClass(stripped, plan, cap) === 'DIRECT_MATCH') basis.push('buy_side_text');
      else { cls = 'RELATED_MARKET_CANDIDATE'; basis.push('buyer_name'); }
    }
  }
  const company = companyRecallBasis(row, anchor);
  if (company) basis.push(company);
  const tier = cls === 'WEAK_NON_MARKET' && company ? OPEN_TIER.COMPANY_CODE : OPEN_TIER[cls];
  return { cls, basis, tier };
}

function openWhy(label: OpenLabel, phrase: string, row: Record<string, unknown>): string {
  if (label.basis[0] === 'buyer_name') return buyerNameWhy(phrase);
  const company = label.basis.find((b) => b === 'company_registered_psc' || b === 'company_registered_naics') as
    | 'company_registered_psc' | 'company_registered_naics' | undefined;
  if (label.cls === 'WEAK_NON_MARKET' && company) return companyCodeWhy(company, row as { naics_code?: string; psc_code?: string });
  return openEvidenceWhy(label.cls, phrase);
}

function eligibilityFor(
  company: CompanyAnchorResolution | null,
  record: 'notice' | 'forecast' | 'recompete',
  row: Record<string, unknown>,
): EligibilityVerdict | undefined {
  if (!company) return undefined;
  if (!company.anchor) return unresolvedCompanyVerdict(company.note || company.status, record);
  if (record === 'recompete') {
    return evaluateRecompeteEligibility({ set_aside_type: row.set_aside_type as string, naics_code: row.naics_code as string }, company.anchor);
  }
  if (record === 'forecast') {
    return evaluateEligibility({ set_aside_description: row.set_aside_type as string, naics_code: row.naics_code as string }, company.anchor, 'forecast');
  }
  return evaluateEligibility({
    set_aside_code: row.set_aside_code as string,
    set_aside_description: row.set_aside_description as string,
    naics_code: row.naics_code as string,
  }, company.anchor, 'notice');
}

/**
 * Company-anchored recall is a UNION: rows the unanchored plan admits (text/taxonomy) + rows the
 * anchored plan admits. Base rows come first; the anchored fetch is de-duplicated against them.
 * A failed base fetch is not fatal — the anchored plan already includes those rows (it just may
 * have been capped), so we keep what we have.
 */
function unionRows(base: Array<Record<string, unknown>> | null, anchored: Array<Record<string, unknown>>, key: string): Array<Record<string, unknown>> {
  if (!base) return anchored;
  const seen = new Set(base.map((r) => String(r[key])));
  return [...base, ...anchored.filter((r) => !seen.has(String(r[key])))];
}

function eligibilityCounts(items: HorizonItem[], company: CompanyAnchorResolution | null): Record<EligibilityStatus, number> | null {
  if (!company) return null;
  const out: Record<EligibilityStatus, number> = { ELIGIBLE: 0, NOT_ELIGIBLE: 0, UNKNOWN: 0 };
  for (const it of items) if (it.eligibility) out[it.eligibility.status] += 1;
  return out;
}

async function queryOpenNow(
  client: SupabaseClient,
  p: InterpretedQuery,
  limit: number,
): Promise<HorizonResult> {
  const source = 'sam_opportunities';
  if (p.plan.status !== 'ok') return blockedHorizon(source, OPEN_HANDOFFS, p.plan);
  if (p.stage === 'invalid') {
    // An unrecognised stage is never ignored (ignoring it would silently widen to every stage).
    return {
      ...unavailable(source, OPEN_HANDOFFS, `stage must be one of ${ACQUISITION_STAGE_GROUPS.join(', ')}`, ['stage']),
      error: { class: 'validation_error', message: `stage must be one of ${ACQUISITION_STAGE_GROUPS.join(', ')}` },
      semantics_note: 'Not searched: the requested stage is not recognised. This is a refinement ask — not zero demand.',
    };
  }
  const stage = p.stage;
  const consumed = consumedFor(p.plan, 'open_now', stage);
  const unsupported: string[] = [];
  const asOf = await tableAsOf(client, source, 'updated_at');
  // Stage filter goes INTO the fetch (filter-before-rank): the capped deadline window must be drawn
  // from the requested stage, never filtered after the cap.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inStage = (q: any) => (stage ? q.or(stageOrExpr(stage)) : q);

  try {
    const cap = p.market.capability;
    const COLS =
      'notice_id, title, department, sub_tier, naics_code, psc_code, description, set_aside_code, set_aside_description, notice_type, response_deadline, ui_link, solicitation_number, pop_state, pop_city, office_address, map_lat, updated_at';

    // Candidate window: deadline-ordered, capped (OPEN_FETCH_CAP measured), then ranked.
    const fetchCap = Math.max(limit, OPEN_FETCH_CAP);
    const { data, count, error } = await inStage(applyOpenPlan(client.from(source).select(COLS, { count: 'exact' }), p.plan))
      .order('response_deadline', { ascending: true, nullsFirst: false })
      .limit(fetchCap);
    if (error) return unavailable(source, OPEN_HANDOFFS, error.message, unsupported);

    let unmapped: number | null = null;
    {
      const { count: uc, error: ue } = await inStage(applyOpenPlan(client.from(source).select('notice_id', { count: 'exact', head: true }), p.plan)).is('map_lat', null);
      if (!ue) unmapped = uc ?? null;
    }

    // Stage: how many notices matched everything else but have no recognisable notice type.
    // They are EXCLUDED (never guessed into a stage) and counted; a failed count is null, not 0.
    let stageInfo: HorizonStage | null = null;
    if (stage) {
      let excluded: number | null = null;
      const { count: xc, error: xe } = await applyOpenPlan(client.from(source).select('notice_id', { count: 'exact', head: true }), p.plan).or(unknownStageOrExpr());
      if (!xe && typeof xc === 'number') excluded = xc;
      stageInfo = {
        group: stage,
        label: STAGE_GROUP_LABEL[stage],
        applied: true,
        excluded_unknown_stage_count: excluded,
        returned_by_signal: null,
        note: 'Structured SAM notice_type first; title keywords are a secondary, word-bounded signal on a compatible notice type (see each item\'s acquisition_stage). Notices with no recognisable notice type are excluded and counted, never guessed.',
      };
    }

    let baseRows: Array<Record<string, unknown>> | null = null;
    if (p.basePlan) {
      const base = await inStage(applyOpenPlan(client.from(source).select(COLS), p.basePlan))
        .order('response_deadline', { ascending: true, nullsFirst: false })
        .limit(fetchCap);
      if (!base.error) baseRows = (base.data || []) as Array<Record<string, unknown>>;
    }
    const rows = unionRows(baseRows, (data || []) as Array<Record<string, unknown>>, 'notice_id');
    if (!rows.length) {
      const e = emptyHorizon(source, OPEN_HANDOFFS, consumed, unsupported, asOf, stage ? `No matching open ${STAGE_GROUP_LABEL[stage]} notices under these filters.` : 'No matching open solicitations under these filters.', unmapped);
      return stageInfo ? { ...e, stage: { ...stageInfo, returned_by_signal: { structured_notice_type: 0, title_keyword: 0 } } } : e;
    }

    // Stage 5 ranking: MCP evidence tier (surface labelling) → canonical breadth → score → deadline.
    const scores = new Map(rankRecords(p.plan, rows, ['title', 'description', 'department']).map((s) => [s.row, s]));
    const anchor = p.company?.anchor ?? null;
    const ranked = rows
      .map((r, i) => {
        const label = labelOpenRow(r, p.plan, cap, anchor);
        return { i, row: r, cls: label.cls, label, s: scores.get(r) };
      })
      .sort((a, b) => a.label.tier - b.label.tier
        || (b.s?.breadth ?? 0) - (a.s?.breadth ?? 0)
        || (b.s?.score ?? 0) - (a.s?.score ?? 0)
        || a.i - b.i);
    const evidence_counts: EvidenceCounts = openEvidenceCounts(ranked);
    if (p.company) evidence_counts.COMPANY_REGISTERED_CODE = ranked.filter((x) => x.label.tier === OPEN_TIER.COMPANY_CODE).length;
    const sliced = ranked.slice(0, limit);
    const phrase = p.searchText || 'this work';

    const items: HorizonItem[] = sliced.map(({ row: r, cls, label }) => {
      const office = r.office_address as { city?: string; state?: string } | null;
      const eligibility = eligibilityFor(p.company, 'notice', r);
      const st = String(r.pop_state || office?.state || '');
      const city = String(r.pop_city || office?.city || '');
      return {
        horizon: 'open_now',
        title: String(r.title || 'Untitled opportunity'),
        buyer: String(r.department || r.sub_tier || '') || null,
        location_label: locLabel(city, st),
        relevant_date: (r.response_deadline as string) || null,
        relevant_date_label: 'response_deadline',
        value_label: null,
        source,
        why_this_matched: openWhy(label, phrase, r),
        identity: { kind: 'notice_id', id: String(r.notice_id || '') },
        evidence_class: cls === 'WEAK_NON_MARKET' ? undefined : cls,
        match_basis: label.basis,
        ...(eligibility ? { eligibility } : {}),
        ...(stage ? { acquisition_stage: stageMatchFor(r, stage) } : {}),
        notice_id: String(r.notice_id || ''),
        solicitation_number: String(r.solicitation_number || '') || null,
        response_deadline: (r.response_deadline as string) || null,
        set_aside: (r.set_aside_description as string) || (r.set_aside_code as string) || null,
        sam_url: (r.ui_link as string) || null,
        notice_type: (r.notice_type as string) || null,
        naics_code: (r.naics_code as string) || null,
        psc_code: (r.psc_code as string) || null,
        sub_agency: (r.sub_tier as string) || null,
      };
    });

    return {
      status: 'grounded',
      matched_count: count ?? null,
      returned_count: items.length,
      items,
      source,
      as_of: asOf,
      filters_consumed: consumed,
      filters_unsupported: unsupported,
      unmapped_count: unmapped,
      error: null,
      allowed_handoffs: OPEN_HANDOFFS,
      semantics_note:
        'Canonical discovery eligibility (word-bounded). Ranked DIRECT_MATCH → RELATED_MARKET_CANDIDATE → other, then by how many of the query’s concepts a notice carries, then deadline. Geography: place of performance OR buying-office state.'
        + (p.company ? ' Company-anchored: rows recalled only by the company’s registered PSC/NAICS rank after related-market rows and are never DIRECT_MATCH. eligibility is a separate screen.' : ''),
      evidence_counts,
      ...(p.company ? { eligibility_counts: eligibilityCounts(items, p.company) } : {}),
      ...(stageInfo ? { stage: { ...stageInfo, returned_by_signal: stageSignalCounts(items) } } : {}),
    };
  } catch (e) {
    return unavailable(source, OPEN_HANDOFFS, (e as Error).message, unsupported);
  }
}

function stageSignalCounts(items: HorizonItem[]): HorizonStage['returned_by_signal'] {
  const out = { structured_notice_type: 0, title_keyword: 0 };
  for (const it of items) {
    const m = it.acquisition_stage as { signal?: keyof typeof out } | null | undefined;
    if (m?.signal) out[m.signal] += 1;
  }
  return out;
}

/**
 * Region + stage notes for the horizons that do not own them. Applied AFTER each horizon runs so the
 * horizon implementations stay untouched (Coming back / Coming soon are shared with other work).
 */
function annotateHorizon(key: HorizonKey, h: HorizonResult, p: InterpretedQuery): HorizonResult {
  const unsupported = [...h.filters_unsupported];
  if (p.region?.unresolved.length) {
    unsupported.push(`location not a US state: ${p.region.unresolved.map((u) => `"${u}"`).join(', ')} (no installation/radius lookup; ${p.region.states.length ? `searched ${p.region.states.join(', ')} only` : 'nothing searched — asked-for location matched no state'})`);
  }
  let stage = h.stage ?? null;
  if (p.stage && p.stage !== 'invalid' && key !== 'open_now') {
    unsupported.push(`stage:${p.stage} (a notice-type filter — applies to Open now only; this horizon is NOT stage-filtered)`);
    stage = {
      group: p.stage,
      label: STAGE_GROUP_LABEL[p.stage],
      applied: false,
      excluded_unknown_stage_count: null,
      returned_by_signal: null,
      note: key === 'coming_back'
        ? 'Not applied: a recompete is not a notice and has no notice type. Shown as context.'
        : 'Not applied: a forecast is not a notice and has no notice type. Shown as context.',
    };
  }
  if (unsupported.length === h.filters_unsupported.length && stage === (h.stage ?? null)) return h;
  return { ...h, filters_unsupported: unsupported, ...(stage ? { stage } : {}) };
}

async function queryComingBack(
  client: SupabaseClient,
  p: InterpretedQuery,
  limit: number,
): Promise<HorizonResult> {
  const source = 'recompete_opportunities';
  if (p.plan.status !== 'ok') return blockedHorizon(source, BACK_HANDOFFS, p.plan);
  const consumed = consumedFor(p.plan, 'coming_back');
  const unsupported = p.plan.notes.filter((n) => n.startsWith('recompete:')).map((n) => n.slice('recompete:'.length).trim());
  if (p.plan.psc.length && !p.plan.horizons.recompete.naics.length) unsupported.push('psc (recompete psc_code sparse; no NAICS crosswalk)');
  const asOf = await tableAsOf(client, source, 'last_synced_at');
  const cap = p.market.capability;
  const related = cap.related_market;

  try {
    const COLS =
      'contract_id,piid,incumbent_name,incumbent_uei,awarding_agency,awarding_sub_agency,naics_code,naics_description,psc_code,psc_description,description,potential_total_value,total_obligation,period_of_performance_current_end,place_of_performance_state,place_of_performance_city,set_aside_type,recompete_likelihood,map_lat,last_synced_at,contract_type';

    // MCP surface policy (unchanged): soonest-ending first; wider window only for related-market.
    const baseCap = Math.max(limit, related ? 200 : limit);
    // Company-anchored: registered codes can admit hundreds of rows ahead of the text matches in
    // end-date order, so the anchored window is wider (OPEN_FETCH_CAP) and the base plan is unioned.
    const fetchCap = p.basePlan ? Math.max(baseCap, OPEN_FETCH_CAP) : baseCap;
    // COMING BACK NEVER RETURNS ORDERS (Eric, 2026-09-22). A task/delivery order under a vehicle
    // is not re-competed on its own. The exclusion is applied INSIDE the fetch — before the row
    // cap, classification and ranking — so every slot goes to a standalone contract instead of
    // being spent on orders that would then be thrown away. Orders are not reclassified or moved
    // to Open; they are counted (orders_excluded) and dropped. Relevance/eligibility untouched.
    const { data, count, error } = await applyRecompetePlan(client.from(source).select(COLS, { count: 'exact' }), p.plan)
      .or(NOT_ORDER_UNDER_VEHICLE_OR)
      .order('period_of_performance_current_end', { ascending: true })
      .limit(fetchCap);
    if (error) return unavailable(source, BACK_HANDOFFS, error.message, unsupported);

    // Orders the same plan matched — measured, never inferred. null = the count query failed.
    let ordersExcluded: number | null = null;
    {
      const { count: all, error: ae } = await applyRecompetePlan(client.from(source).select('contract_id', { count: 'exact', head: true }), p.plan);
      if (!ae && typeof all === 'number' && typeof count === 'number') ordersExcluded = Math.max(0, all - count);
    }

    let unmapped: number | null = null;
    {
      const { count: uc, error: ue } = await applyRecompetePlan(client.from(source).select('contract_id', { count: 'exact', head: true }), p.plan)
        .or(NOT_ORDER_UNDER_VEHICLE_OR).is('map_lat', null);
      if (!ue) unmapped = uc ?? null;
    }

    let baseRows: Array<Record<string, unknown>> | null = null;
    if (p.basePlan) {
      const base = await applyRecompetePlan(client.from(source).select(COLS), p.basePlan)
        .or(NOT_ORDER_UNDER_VEHICLE_OR)
        .order('period_of_performance_current_end', { ascending: true })
        .limit(baseCap);
      if (!base.error) baseRows = (base.data || []) as Array<Record<string, unknown>>;
    }
    // Belt and braces: the same rule in JS (parseAwardLineage), so a row the SQL predicate let
    // through can still never become an individual Coming Back item.
    const unioned = unionRows(baseRows, (data || []) as Array<Record<string, unknown>>, 'contract_id');
    const rawRows = unioned.filter((r) => parseAwardLineage(r as { contract_id?: string; contract_type?: string }).award_kind !== 'order_under_vehicle');
    const ordersDroppedInJs = unioned.length - rawRows.length;
    // Ranking reads BUY-SIDE fields only — the holder's name must not lift a row (it used to).
    const scores = new Map(rankRecords(p.plan, rawRows, ['description', 'psc_description', 'naics_description', 'awarding_agency', 'awarding_sub_agency']).map((s) => [s.row, s]));
    const anchor = p.company?.anchor ?? null;
    const CB_TIER: Record<ComingBackClass | 'COMPANY_CODE', number> = { DIRECT_MATCH: 0, RELATED_MARKET_CANDIDATE: 1, HOLDER_SIGNAL: 2, COMPANY_CODE: 3 };
    const classified: Array<{ row: Record<string, unknown>; cls: ComingBackClass | null; basis: MatchBasis[]; i: number }> = [];
    const evidence_counts: EvidenceCounts = { DIRECT_MATCH: 0, RELATED_MARKET_CANDIDATE: 0, HOLDER_SIGNAL: 0 };
    rawRows.forEach((row, i) => {
      // Buy-side evidence decides DIRECT; the holder's name is its own signal (match-evidence.ts).
      // Physical-only rows in a cyber search still carry no class.
      const ev = classifyComingBackEvidence(row, p.plan, cap, anchor);
      if (ev.cls) {
        evidence_counts[ev.cls] = (evidence_counts[ev.cls] ?? 0) + 1;
        classified.push({ row, cls: ev.cls, basis: ev.basis, i });
      } else if (ev.basis.some((b) => b === 'company_registered_psc' || b === 'company_registered_naics')) {
        // Recalled ONLY by the company's registered codes: kept, labelled, never an evidence class.
        evidence_counts.COMPANY_REGISTERED_CODE = (evidence_counts.COMPANY_REGISTERED_CODE ?? 0) + 1;
        classified.push({ row, cls: null, basis: ev.basis, i });
      }
    });
    const tierOf = (c: ComingBackClass | null) => CB_TIER[c ?? 'COMPANY_CODE'];
    classified.sort((a, b) => {
      if (a.cls !== b.cls) return tierOf(a.cls) - tierOf(b.cls);
      const sa = scores.get(a.row); const sb2 = scores.get(b.row);
      return (sb2?.breadth ?? 0) - (sa?.breadth ?? 0) || a.i - b.i; // then soonest end (fetch order)
    });
    const sliced = classified.slice(0, limit);

    if (!sliced.length) {
      const excluded = ordersExcluded === null ? null : ordersExcluded + ordersDroppedInJs;
      const msg = excluded
        ? 'No standalone future recompetes under these filters — only task/delivery orders under existing vehicles matched, and those are not re-competed on their own.'
        : 'No matching future recompetes under these filters.';
      const empty = emptyHorizon(source, BACK_HANDOFFS, consumed, unsupported, asOf, msg, unmapped);
      return { ...empty, orders_excluded: excluded };
    }

    const phraseBack = p.searchText || 'this work';
    // Same corrected row as get_expiring_contracts (annotate.ts). Orders never reach here.
    const items: HorizonItem[] = sliced.map(({ row: r, cls, basis }) => {
      const a = recompeteRowAnnotations(r as Parameters<typeof recompeteRowAnnotations>[0]);
      return {
      horizon: 'coming_back',
      title: String(r.naics_description || r.incumbent_name || r.piid || 'Expiring contract'),
      buyer: String(r.awarding_sub_agency || r.awarding_agency || '') || null,
      location_label: locLabel(r.place_of_performance_city as string, r.place_of_performance_state as string),
      award_kind: a.award_kind,
      // Suggested capture start (derived rule), never a recompete date.
      capture_start_date: a.capture_start_date,
      capture_start_basis: a.capture_start_basis,
      relevant_date: (r.period_of_performance_current_end as string) || null,
      relevant_date_label: 'current_end',
      value_label: moneyLabel(r.potential_total_value) || moneyLabel(r.total_obligation),
      source,
      why_this_matched: cls === null
        ? companyCodeWhy(basis.includes('company_registered_psc') ? 'company_registered_psc' : 'company_registered_naics', r as { naics_code?: string; psc_code?: string }, 'contract')
        : cls === 'HOLDER_SIGNAL'
          ? holderSignalWhy(phraseBack, r as { incumbent_name?: string; naics_code?: string; psc_code?: string })
          : basis[0] === 'buyer_name' ? buyerNameWhy(phraseBack) : evidenceWhy(cls, phraseBack),
      identity: { kind: 'contract_id', id: String(r.contract_id || '') },
      ...(cls ? { evidence_class: cls } : {}),
      match_basis: basis,
      ...(p.company ? { eligibility: eligibilityFor(p.company, 'recompete', r) } : {}),
      contract_id: String(r.contract_id || ''),
      piid: String(r.piid || '') || null,
      incumbent_name: (r.incumbent_name as string) || null,
      incumbent_uei: (r.incumbent_uei as string) || null,
      current_end: (r.period_of_performance_current_end as string) || null,
      potential_total_value: r.potential_total_value ?? null,
      total_obligation: r.total_obligation ?? null,
      recompete_likelihood: (r.recompete_likelihood as string) || null,
      set_aside_type: (r.set_aside_type as string) || null,
      naics_code: (r.naics_code as string) || null,
      psc_code: (r.psc_code as string) || null,
      description: (r.description as string) || null,
      awarding_sub_agency: (r.awarding_sub_agency as string) || null,
      };
    });

    const note = related
      ? 'DIRECT_MATCH is confirmed capability relevance. RELATED_MARKET_CANDIDATE is this buyer’s broader IT market — not confirmed cybersecurity. Geography: place of performance only. Not a live solicitation. Watch/email for this horizon is not available yet.'
      : 'Geography: place of performance only (not buying-office). Not a live solicitation — do not draft a proposal as if an RFP exists. Watch/email for this horizon is not available yet.';
    const orderNote = ' Task/delivery orders under a contract vehicle are excluded — they are not re-competed on their own.';

    return {
      status: 'grounded',
      matched_count: count ?? null,
      returned_count: items.length,
      items,
      source,
      as_of: asOf,
      filters_consumed: consumed,
      filters_unsupported: unsupported,
      unmapped_count: unmapped,
      error: null,
      allowed_handoffs: BACK_HANDOFFS,
      semantics_note: note + ' DIRECT_MATCH requires buy-side evidence (description / PSC / NAICS). HOLDER_SIGNAL rows matched only on the holder\'s name.' + orderNote,
      evidence_counts,
      orders_excluded: ordersExcluded === null ? null : ordersExcluded + ordersDroppedInJs,
      ...(p.company ? { eligibility_counts: eligibilityCounts(items, p.company) } : {}),
    };
  } catch (e) {
    return unavailable(source, BACK_HANDOFFS, (e as Error).message, unsupported);
  }
}

async function queryComingSoon(
  client: SupabaseClient,
  p: InterpretedQuery,
  limit: number,
): Promise<HorizonResult> {
  const source = 'agency_forecasts';
  if (p.plan.status !== 'ok') return blockedHorizon(source, SOON_HANDOFFS, p.plan);
  const consumed = consumedFor(p.plan, 'coming_soon');
  const unsupported: string[] = [];
  const asOf = await tableAsOf(client, source, 'last_synced_at');

  try {
    // Forecast publisher coverage (canonical plan): no covered buyer → UNAVAILABLE, never a measured 0.
    const fcCov = p.plan.horizons.forecast;
    const gaps = fcCov.coverageGaps ?? [];
    for (const g of gaps) {
      p.market.truth.what_remains_unsupported.push(g.reason === 'unresolved_publisher'
        ? `no forecast publisher could be resolved for "${g.requested}"`
        : `forecast publisher coverage for ${g.label || g.requested} is not established`);
    }
    if (fcCov.coverage === 'unestablished') {
      const g = gaps[0];
      return {
        status: 'unavailable',
        matched_count: null,
        returned_count: 0,
        items: [],
        source,
        as_of: asOf,
        filters_consumed: [...consumed, gaps.some((x) => x.reason === 'unresolved_publisher') ? 'agency→forecast_publisher_unresolved' : 'agency→forecast_identity_no_publisher'],
        filters_unsupported: ['agency forecast publisher'],
        unmapped_count: null,
        coverage: { state: 'unestablished', gaps },
        error: {
          class: 'coverage_unestablished',
          message: g?.reason === 'unresolved_publisher'
            ? `No forecast publisher could be resolved for ${gaps.map((x) => `"${x.requested}"`).join(', ')}. Coverage is not established — not a measured zero.`
            : g?.note || `No forecast publisher for ${g?.label || 'this buyer'}. Coverage is not established — not a measured zero.`,
        },
        allowed_handoffs: SOON_HANDOFFS,
        semantics_note:
          'Coverage not established for this buyer in agency_forecasts. Do not treat as zero demand. Do not substitute parent-department forecasts.',
      };
    }

    const COLS =
      'id, title, description, department, source_agency, naics_code, naics_description, set_aside_type, estimated_value_min, estimated_value_max, estimated_value_range, anticipated_quarter, fiscal_year, anticipated_award_date, solicitation_date, pop_state, pop_city, map_lat, status, last_synced_at, contracting_office, incumbent_name';

    const { data, count, error } = await applyForecastPlan(client.from(source).select(COLS, { count: 'exact' }), p.plan).limit(Math.max(limit, p.basePlan ? OPEN_FETCH_CAP : 200));
    if (error) return unavailable(source, SOON_HANDOFFS, error.message, unsupported);

    let unmapped: number | null = null;
    {
      const { count: uc, error: ue } = await applyForecastPlan(client.from(source).select('id', { count: 'exact', head: true }), p.plan).is('map_lat', null);
      if (!ue) unmapped = uc ?? null;
    }

    type Row = Record<string, unknown>;
    let baseRows: Row[] | null = null;
    if (p.basePlan) {
      const base = await applyForecastPlan(client.from(source).select(COLS), p.basePlan).limit(Math.max(limit, 200));
      if (!base.error) baseRows = (base.data || []) as Row[];
    }
    const all = unionRows(baseRows, (data || []) as Row[], 'id') as Row[];
    const scores = new Map(rankRecords(p.plan, all, ['title', 'description', 'naics_description', 'department']).map((s) => [s.row, s]));
    const rows = [...all].sort((a, b) => {
      const bd = (scores.get(b)?.breadth ?? 0) - (scores.get(a)?.breadth ?? 0);
      if (bd) return bd;
      // MCP surface order (unchanged): soonest anticipated award first; undated last.
      const da = String(a.anticipated_award_date || '');
      const db = String(b.anticipated_award_date || '');
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    }).slice(0, limit);

    // Partial coverage: the count measures ONLY the covered buyers; the missing ones are named, never zero.
    const partial = fcCov.coverage === 'partial'
      ? {
        coverage: { state: 'partial' as const, gaps },
        partialNote: `Partial coverage: counts cover ${fcCov.forecastFilters.agency?.split('|').join(', ')} only. Not measured (no forecast publisher): ${gaps.map((x) => x.requested).join(', ')} — not a zero.`,
      }
      : null;
    if (partial) unsupported.push(`forecast publisher not established for: ${gaps.map((x) => x.requested).join(', ')}`);

    if (!rows.length) {
      const empty = emptyHorizon(
        source,
        SOON_HANDOFFS,
        consumed,
        unsupported,
        asOf,
        p.plan.policy.forecast.includePastFiscalYears
          ? 'No matching forecasts under these filters (past fiscal years included).'
          : 'No matching forecasts under these filters (current and future fiscal years).',
        unmapped,
      );
      return partial ? { ...empty, status: 'partial', coverage: partial.coverage, semantics_note: `${empty.semantics_note ?? ''} ${partial.partialNote}`.trim() } : empty;
    }

    const soonAnchor = p.company?.anchor ?? null;
    const items: HorizonItem[] = rows.map((r) => {
      const soonCompany = companyRecallBasis(r, soonAnchor);
      const soonText = p.plan.matcher.mode === 'none' || matchesText(p.plan.matcher, [r.title as string, r.description as string, r.naics_description as string]);
      const soonBasis: MatchBasis[] = [
        ...(p.plan.matcher.mode === 'none' ? ['structured_scope' as const] : soonText ? ['buy_side_text' as const] : []),
        ...(soonCompany ? [soonCompany] : []),
      ];
      const lo = moneyLabel(r.estimated_value_min);
      const hi = moneyLabel(r.estimated_value_max);
      const value =
        (r.estimated_value_range as string) ||
        (lo && hi ? (lo === hi ? hi : `${lo}–${hi}`) : hi || lo);
      return {
        horizon: 'coming_soon',
        title: String(r.title || 'Forecast opportunity'),
        buyer: String(r.department || r.source_agency || '') || null,
        location_label: locLabel(r.pop_city as string, r.pop_state as string),
        relevant_date: (r.anticipated_award_date as string) || null,
        relevant_date_label: 'anticipated_award_date',
        value_label: value || null,
        source,
        why_this_matched: !soonText && soonCompany
          ? companyCodeWhy(soonCompany, r as { naics_code?: string; psc_code?: string }, 'forecast')
          : p.searchText
            ? `Matched agency forecast for “${p.searchText}”`
            : 'Matched agency forecast',
        identity: { kind: 'forecast_id', id: String(r.id || '') },
        match_basis: soonBasis,
        ...(p.company ? { eligibility: eligibilityFor(p.company, 'forecast', r) } : {}),
        forecast_id: String(r.id || ''),
        anticipated_award_date: (r.anticipated_award_date as string) || null,
        solicitation_date: (r.solicitation_date as string) || null,
        fiscal_year: (r.fiscal_year as string) || null,
        anticipated_quarter: (r.anticipated_quarter as string) || null,
        acquisition_status: (r.status as string) || null,
        forecast_source_agency: (r.source_agency as string) || null,
        set_aside_type: (r.set_aside_type as string) || null,
        naics_code: (r.naics_code as string) || null,
        incumbent_name: (r.incumbent_name as string) || null,
        contracting_office: (r.contracting_office as string) || null,
      };
    });

    return {
      status: partial ? 'partial' : 'grounded',
      matched_count: count ?? null,
      returned_count: items.length,
      items,
      source,
      as_of: asOf,
      filters_consumed: consumed,
      filters_unsupported: unsupported,
      unmapped_count: unmapped,
      error: null,
      allowed_handoffs: SOON_HANDOFFS,
      ...(partial ? { coverage: partial.coverage } : {}),
      semantics_note:
        'Canonical discovery eligibility (word-bounded). Current and future fiscal years unless opted in. Ranked by how many of the query’s concepts a forecast carries, then anticipated award date. Geography: pop_state only; many forecasts have no location.'
        + (partial ? ` ${partial.partialNote}` : ''),
      ...(p.company ? { eligibility_counts: eligibilityCounts(items, p.company) } : {}),
    };
  } catch (e) {
    return unavailable(source, SOON_HANDOFFS, (e as Error).message, unsupported);
  }
}

function closesWithinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const delta = t - Date.now();
  return delta >= 0 && delta <= days * 86400_000;
}

/**
 * SPECIFIC = useful named open target → UNDERSTAND journey.
 * BROAD = market-shaped → monitor (with watch_coverage honesty).
 */
export function classifyFindShape(horizons: Record<HorizonKey, HorizonResult>): 'specific' | 'broad' {
  const open = horizons.open_now;
  if (open.status === 'grounded' && open.items.length > 0) {
    const top = open.items[0];
    const matched = open.matched_count;
    // Narrow open set or imminent deadline → UNDERSTAND journey.
    if (closesWithinDays(top.relevant_date, 30)) return 'specific';
    if (typeof matched === 'number' && matched > 0 && matched <= 8) return 'specific';
  }
  return 'broad';
}

export function buildFindNext(
  shape: 'specific' | 'broad',
  horizons: Record<HorizonKey, HorizonResult>,
): FindNextAction[] {
  const hasOpenHit =
    horizons.open_now.status === 'grounded' && horizons.open_now.items.length > 0;
  // Potato v1: an open hit continues UNDERSTAND even when the market is broad.
  // Do not skip the journey to MONITOR-only because matched_count > 8.
  if (shape === 'specific' || hasOpenHit) {
    const top = horizons.open_now.items[0];
    const noticeId =
      (typeof top?.notice_id === 'string' && top.notice_id) ||
      (top?.identity?.kind === 'notice_id' ? top.identity.id : '') ||
      '';
    const agency = typeof top?.buyer === 'string' ? top.buyer : '';
    const suggested_args: Record<string, unknown> = {};
    const missing_inputs: string[] = [];
    if (noticeId) suggested_args.notice_id = noticeId;
    else missing_inputs.push('notice_id');
    if (agency) suggested_args.agency = agency;
    else if (!noticeId) missing_inputs.push('agency');
    const primary: FindNextAction = {
      prompt: 'Want me to show you what this customer cares about and what you should say to them?',
      tool: 'understand_customer',
      credits: 5,
      requires_confirmation: true,
      suggested_args,
      missing_inputs,
    };
    const secondary: FindNextAction = {
      prompt:
        'Want me to monitor this market for new and upcoming opportunities? ' +
        '(Watch covers Open now + Coming soon — Coming back / recompetes are not emailed yet.)',
      tool: 'schedule_market_search',
      credits: 0,
      requires_confirmation: true,
      suggested_args: { watch_coverage: [...WATCH_COVERAGE] },
    };
    return [primary, secondary];
  }

  return [
    {
      prompt: 'Want me to show you what’s changed about how this buyer is buying this work?',
      tool: 'get_current_acquisition_intelligence',
      credits: 8,
      requires_confirmation: true,
    },
    {
      prompt:
        'Want me to monitor this market for new and upcoming opportunities? ' +
        '(Watch covers Open now + Coming soon — Coming back / recompetes are not emailed yet.)',
      tool: 'schedule_market_search',
      credits: 0,
      requires_confirmation: true,
      suggested_args: { watch_coverage: [...WATCH_COVERAGE] },
    },
  ];
}

export function comingBackSummary(h: HorizonResult): FindOpportunitiesResult['summary']['coming_back'] {
  const ev = h.evidence_counts;
  return {
    status: h.status,
    matched_count: h.matched_count,
    direct_match: ev?.DIRECT_MATCH ?? null,
    related_market_candidate: ev?.RELATED_MARKET_CANDIDATE ?? null,
    holder_signal: ev ? ev.HOLDER_SIGNAL ?? 0 : null,
  };
}

/** Host-facing Coming back sentence. Never collapses DIRECT+RELATED into one capability count. */
export function comingBackHostClaim(
  phrase: string,
  ev: EvidenceCounts | null | undefined,
): string {
  const p = (phrase || 'this market').trim();
  if (!ev) return '';
  const holder = ev.HOLDER_SIGNAL
    ? ` ${ev.HOLDER_SIGNAL} more matched only on the holder's name — holder signals, not ${p} demand.`
    : '';
  if (ev.RELATED_MARKET_CANDIDATE > 0) {
    return (
      `I found ${ev.DIRECT_MATCH} contracts with direct ${p} evidence and ` +
      `${ev.RELATED_MARKET_CANDIDATE} related-market candidates worth reviewing. ` +
      `Do not call the combined ${ev.DIRECT_MATCH + ev.RELATED_MARKET_CANDIDATE} "${p} contracts".` + holder
    );
  }
  return `I found ${ev.DIRECT_MATCH} coming-back contracts with direct ${p} evidence.` + holder;
}

export function headlineFor(horizons: Record<HorizonKey, HorizonResult>): string {
  const part = (key: HorizonKey, label: string) => {
    const h = horizons[key];
    if (h.status === 'unavailable') return `${label} unavailable`;
    if (h.status === 'empty') return `0 ${label}`;
    const n = h.matched_count;
    const ev = h.evidence_counts;
    if (ev && (ev.DIRECT_MATCH + ev.RELATED_MARKET_CANDIDATE + (ev.HOLDER_SIGNAL ?? 0)) > 0) {
      return `${n == null ? '?' : n.toLocaleString()} ${label} (${ev.DIRECT_MATCH} direct · ${ev.RELATED_MARKET_CANDIDATE} related-market${ev.HOLDER_SIGNAL ? ` · ${ev.HOLDER_SIGNAL} holder-name only` : ''})`;
    }
    if (n == null) return `${label} count unknown`;
    if (h.status === 'partial' && h.coverage) return `${n.toLocaleString()} ${label} (partial — not measured: ${h.coverage.gaps.map((g) => g.requested).join(', ')})`;
    return `${n.toLocaleString()} ${label}`;
  };
  return [
    part('open_now', 'open now'),
    part('coming_back', 'coming back'),
    part('coming_soon', 'coming soon'),
  ].join(' · ');
}

function companySummary(c: CompanyAnchorResolution, plan: DiscoveryPlan): FindCompanySummary {
  const a = c.anchor;
  return {
    uei: c.uei,
    status: c.status,
    legal_name: a?.legal_name ?? null,
    source: a?.source ?? null,
    as_of: a?.as_of ?? null,
    note: c.note,
    recall_codes: plan.company ?? null,
    size_by_naics: a ? a.size_by_naics : null,
    location: a?.location ?? null,
  };
}

export async function findOpportunities(
  input: FindOpportunitiesInput,
  deps: FindOpportunitiesDeps = {},
): Promise<FindOpportunitiesResult> {
  const query = String(input.query || '').trim();
  if (!query && !input.advanced?.naics && !input.advanced?.keyword_exact) {
    const empty = (source: string, handoffs: HandoffKey[]): HorizonResult =>
      unavailable(source, handoffs, 'query_required');
    const horizons: Record<HorizonKey, HorizonResult> = {
      open_now: empty('sam_opportunities', OPEN_HANDOFFS),
      coming_back: empty('recompete_opportunities', BACK_HANDOFFS),
      coming_soon: empty('agency_forecasts', SOON_HANDOFFS),
    };
    // Validation failure is not a market zero — mark as degraded empty compose.
    for (const k of Object.keys(horizons) as HorizonKey[]) {
      horizons[k] = {
        ...horizons[k],
        status: 'unavailable',
        error: { class: 'validation_error', message: 'query is required' },
        semantics_note: 'Pass a plain-English query (what you sell / what to find).',
      };
    }
    return {
      query_summary: {
        query: '',
        location: null,
        agency: null,
        timeframe: input.timeframe ?? null,
        set_aside: null,
        horizons_requested: ['open_now', 'coming_back', 'coming_soon'],
        interpreted_as: {
          open_now: 'n/a',
          coming_back: 'n/a',
          coming_soon: 'n/a',
        },
      },
      market_interpretation: interpretMarket('', null),
      presentation_note: '',
      horizons,
      summary: {
        open_now: { status: 'unavailable', matched_count: null },
        coming_back: {
          status: 'unavailable',
          matched_count: null,
          direct_match: null,
          related_market_candidate: null,
          holder_signal: null,
        },
        coming_soon: { status: 'unavailable', matched_count: null },
        headline: 'query required',
        claim_hygiene:
          'Counts are per-horizon matches under this query — not unique procurements across horizons.',
      },
      _meta: {
        grounded: false,
        degraded: true,
        composition: 'opportunity_map_horizons_v1',
        expansion_note: 'Cross-class deduplicated procurement identity is unknown.',
        watch_coverage: [...WATCH_COVERAGE],
        find_shape: 'broad',
      },
      _next: [],
      presentation: buildFindPresentation(),
    };
  }

  const hz = input.horizons || {};
  const requested: HorizonKey[] = (
    ['open_now', 'coming_back', 'coming_soon'] as HorizonKey[]
  ).filter((k) => hz[k] !== false);

  const limit = clampLimit(input.limit_per_horizon);
  // Company-anchored FIND: resolve BEFORE the plan so registered codes can widen recall. A failed
  // lookup never blocks FIND — it runs unanchored and every item's eligibility says why it is UNKNOWN.
  const uei = String(input.uei || '').trim();
  const company = uei ? await resolveCompanyAnchor(uei, deps.entityLookup) : null;
  const interpreted = interpretQuery({ ...input, query: query || String(input.advanced?.keyword_exact || '') }, company);
  const client = deps.client ?? sb();

  const run = async (key: HorizonKey): Promise<HorizonResult> => {
    if (!requested.includes(key)) {
      return emptyHorizon(
        key === 'open_now' ? 'sam_opportunities' : key === 'coming_back' ? 'recompete_opportunities' : 'agency_forecasts',
        key === 'open_now' ? OPEN_HANDOFFS : key === 'coming_back' ? BACK_HANDOFFS : SOON_HANDOFFS,
        ['horizon_disabled'],
        [],
        null,
        'Horizon not requested.',
        null,
      );
    }
    const h = key === 'open_now'
      ? await queryOpenNow(client, interpreted, limit)
      : key === 'coming_back'
        ? await queryComingBack(client, interpreted, limit)
        : await queryComingSoon(client, interpreted, limit);
    return annotateHorizon(key, h, interpreted);
  };

  const [open_now, coming_back, coming_soon] = await Promise.all([
    run('open_now'),
    run('coming_back'),
    run('coming_soon'),
  ]);

  const horizons = { open_now, coming_back, coming_soon };
  const shape = classifyFindShape(horizons);
  const grounded = Object.values(horizons).some((h) => h.status === 'grounded');
  const degraded = Object.values(horizons).some((h) => h.status === 'unavailable' || h.status === 'partial');
  const mi = interpreted.market;
  mi.truth.records = {
    DIRECT_MATCH: coming_back.items.filter((i) => i.evidence_class === 'DIRECT_MATCH').map((i) => String(i.identity.id)),
    RELATED_MARKET_CANDIDATE: coming_back.items
      .filter((i) => i.evidence_class === 'RELATED_MARKET_CANDIDATE')
      .map((i) => String(i.identity.id)),
  };
  const blocked = interpreted.plan.status !== 'ok';
  const relatedNote = mi.retrieval_plan.related_market_applied
    ? 'Related-market rows are labeled RELATED_MARKET_CANDIDATE and are not confirmed capability demand. '
    : '';

  return {
    query_summary: {
      query: interpreted.searchText,
      location: interpreted.stateCode,
      agency: interpreted.agency || null,
      timeframe: {
        open_closing_days: interpreted.openClosingDays || null,
        recompete_months: interpreted.recompeteMonths,
        forecast_include_past: interpreted.forecastIncludePast,
      },
      set_aside: interpreted.setAside || null,
      horizons_requested: requested,
      interpreted_as: interpreted.interpreted,
      ...(interpreted.region ? { region: interpreted.region } : {}),
      ...(input.stage != null && String(input.stage).trim() ? { stage: interpreted.stage === 'invalid' ? null : interpreted.stage } : {}),
    },
    market_interpretation: mi,
    ...(company ? { company: companySummary(company, interpreted.plan) } : {}),
    presentation_note: blocked
      ? `${interpreted.plan.refinement} Ask the customer for it — do not present this as zero opportunities.`
      : [plainEnglishInterpretation(mi), comingBackHostClaim(interpreted.searchText, coming_back.evidence_counts)]
        .filter(Boolean)
        .join(' '),
    horizons,
    summary: {
      open_now: { status: open_now.status, matched_count: open_now.matched_count },
      coming_back: comingBackSummary(coming_back),
      coming_soon: { status: coming_soon.status, matched_count: coming_soon.matched_count },
      headline: headlineFor(horizons),
      claim_hygiene:
        relatedNote +
        'Counts are per-horizon matches under this query — not unique procurements across horizons. Do not call combined raw rows unique opportunities. Do not count RELATED_MARKET_CANDIDATE as confirmed cybersecurity demand.',
    },
    _meta: {
      grounded,
      degraded,
      composition: 'opportunity_map_horizons_v1',
      expansion_note: mi.retrieval_plan.related_market_applied
        ? `Related-market expansion recorded: ${mi.retrieval_plan.related_market_reason}`
        : 'Cross-class deduplicated procurement identity is unknown. Buyer alias normalization is not expansion.',
      watch_coverage: [...WATCH_COVERAGE],
      find_shape: shape,
      // A request that cannot define a market is not research performed — never charged.
      ...(blocked ? { billing_outcome: 'nonbillable_invalid_input' as const } : {}),
      discovery: {
        plan_version: interpreted.plan.version,
        status: interpreted.plan.status,
        refinement: interpreted.plan.refinement,
        eligibility: eligibilityLabel(interpreted.plan),
      },
    },
    _next: grounded ? buildFindNext(shape, horizons) : [],
    presentation: buildFindPresentation(!!company, {
      stage: !!interpreted.stage && interpreted.stage !== 'invalid',
      regionUnresolved: !!interpreted.region?.unresolved.length,
    }),
  };
}
