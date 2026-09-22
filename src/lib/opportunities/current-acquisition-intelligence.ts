/**
 * Current Acquisition Intelligence v0 — compose (no LLM, LIVE sources only).
 *
 * Answers: what changed about how this buyer is buying for a capability scope,
 * and what to do differently — with cited OBSERVED_CHANGE / CURRENT_STATE facts only.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { classifyNoticeType } from '@/lib/utils/notice-type';
import { agencyOrExpr, multiAgency, applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { queryExpiringContracts, parseNaicsCodes } from '@/lib/recompete/query';
import { queryFederalEvents } from '@/lib/events/query';
import { termOfArtNaicsCodes } from '@/lib/market/sector-expansions';

/** Vercel env pull sometimes embeds literal `\n` inside quoted values. */
function sanitizeEnvValue(v: string | undefined): string {
  return String(v ?? '')
    .replace(/\\n/g, '')
    .replace(/\\r/g, '')
    .replace(/\r?\n/g, '')
    .trim();
}

/** Apply once so downstream libs (recompete/query, events) see clean credentials. */
export function sanitizeSupabaseEnv(): void {
  const url = sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = sanitizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (url) process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  if (key) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
}

sanitizeSupabaseEnv();

/** Eric override — not set-aside-first. */
export const CAI_NEXT_PROMPT =
  'Want me to figure out which of these doors your company can actually walk through and what proof you should lead with?';

/** Wired once PATHWAY FIT ships — host confirmation still required. */
export const CAI_NEXT = {
  prompt: CAI_NEXT_PROMPT,
  requires_confirmation: true as const,
  tool: 'match_company_to_pathways' as const,
};

export type CaiEpistemicClass =
  | 'observed_change'
  | 'current_state'
  | 'supported_implication'
  | 'do_differently'
  | 'not_yet_measurable';

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

export interface CaiCitation {
  source_kind: CaiSourceKind;
  source_id: string | null;
  locator: string;
  as_of: string | null;
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

export interface CurrentAcquisitionIntelligenceInput {
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
  window_days?: number | null;
}

export interface CurrentAcquisitionIntelligenceResult {
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
    sections: {
      what_changed: { display_title: string; provenance_label: string };
      what_we_are_seeing_now: { display_title: string; provenance_label: string };
      what_that_may_mean: { display_title: string; provenance_label: string };
      do_differently: { display_title: string; provenance_label: string };
      not_yet_measurable: { display_title: string; provenance_label: string };
      pathways: { display_title: string; provenance_label: string };
    };
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
    next_outputs_not_yet: [
      'pathway_recommendation',
      'talent_fit',
      'capability_statement',
      'response',
      'meeting_brief',
    ];
  };
}

const HOST_RULES = [
  'Present sections under presentation.sections.*.display_title — never reframe curated research as buyer intent.',
  'Never invent a pathway (CSO, OT, consortium, rapid office, PAE) without an pathways.observed entry.',
  'Never center strategy on set-aside unless pathways.observed includes set_aside with citations for this scope.',
  'Every "do differently" line must mention what caused it (host should echo caused_by).',
  'Empty what_changed is honest — do not fill with pain points or playbook.',
  'Empty what_that_may_mean / do_differently means invent NOTHING — do not invent recommendations, strategy, or urgency.',
  'Never describe an unavailable or failed horizon (_meta.sources_failed) as zero / none / empty demand — say unavailable or not measured.',
  'pathways.observed = language/labels on scoped LIVE records only. Do NOT treat historical vehicle usage as certainty about future acquisition.',
  'Ban absolute transitions unless the package citations explicitly establish them — e.g. "the competition already happened", "the binding constraint is", "whatever replaces X is where the money goes next".',
  'After this package, ask the capability/door question — do not ask set-aside-first.',
] as const;

/** Absolute future/certainty claims banned unless evidence explicitly establishes them. */
export const CAI_BANNED_ABSOLUTE_PATTERNS: RegExp[] = [
  /\bthe competition already happened\b/i,
  /\bthe binding constraint is\b/i,
  /\bwhatever replaces\b.+\bwhere the money goes next\b/i,
  /\bwill (definitely|certainly|inevitably)\b/i,
  /\bis (definitely|certainly) (how|where|the)\b/i,
  /\bfuture buys? will (use|require|go through)\b/i,
];

export function statementViolatesAbsoluteFutureClaim(statement: string): boolean {
  return CAI_BANNED_ABSOLUTE_PATTERNS.some((re) => re.test(statement));
}

/** Drop implication/action statements that smuggle absolute future certainty. */
export function scrubAbsoluteFutureClaims(items: CaiItem[]): CaiItem[] {
  return items.filter((item) => !statementViolatesAbsoluteFutureClaim(item.statement));
}

const PRESENTATION = {
  what_changed: {
    display_title: 'What changed',
    provenance_label: 'Observed deltas in Mindy’s live data for this buyer + capability',
  },
  what_we_are_seeing_now: {
    display_title: 'What we’re seeing now',
    provenance_label: 'Current concentration from live opportunities, recompetes, spend, vehicles',
  },
  what_that_may_mean: {
    display_title: 'What that may mean',
    provenance_label: 'Supported implications — each tied to a cited change or current-state fact',
  },
  do_differently: {
    display_title: 'What you should do differently',
    provenance_label: 'Actions only when caused by a cited change or current-state fact',
  },
  not_yet_measurable: {
    display_title: 'What Mindy cannot establish yet',
    provenance_label: 'Gaps — including acquisition pathways without explicit evidence',
  },
  pathways: {
    display_title: 'Acquisition pathways (evidence only)',
    provenance_label:
      'Observed = mechanism language/labels on scoped LIVE records only — not a forecast of future buys; potential = not established',
  },
} as const;

const POTENTIAL_PATHWAY_LABELS: Record<PotentialPathwayKind, string> = {
  consortium: 'consortium',
  rapid_acquisition_office: 'rapid-acquisition office',
  pae_portfolio: 'PAE portfolio vehicle',
  other_mechanism: 'untyped innovation pathway',
};

const ALL_POTENTIAL_KINDS: PotentialPathwayKind[] = [
  'consortium',
  'rapid_acquisition_office',
  'pae_portfolio',
  'other_mechanism',
];

export interface PathwayEvidenceRow {
  notice_type?: string | null;
  title?: string | null;
  description?: string | null;
  set_aside_type?: string | null;
  set_aside_code?: string | null;
  contract_type?: string | null;
  source_kind: CaiSourceKind;
  source_id: string | null;
  locator: string;
  as_of: string | null;
}

/** Killer rule — drop implications/actions with missing or invalid caused_by. */
export function applyCausalKillerRule(items: {
  what_changed: CaiItem[];
  what_we_are_seeing_now: CaiItem[];
  what_that_may_mean: CaiItem[];
  do_differently: CaiItem[];
}): { what_that_may_mean: CaiItem[]; do_differently: CaiItem[] } {
  const allowedIds = new Set<string>();
  for (const item of [...items.what_changed, ...items.what_we_are_seeing_now]) {
    if (item.citations?.length) allowedIds.add(item.id);
  }
  const keep = (list: CaiItem[]) =>
    list.filter((item) => {
      const causedBy = item.caused_by ?? [];
      if (!causedBy.length) return false;
      return causedBy.every((id) => allowedIds.has(id));
    });
  return {
    what_that_may_mean: keep(items.what_that_may_mean),
    do_differently: keep(items.do_differently),
  };
}

export function textEstablishesCso(text: string): boolean {
  const t = text.toLowerCase();
  return /commercial solutions opening/.test(t) || /\bcso\b/.test(t);
}

export function textEstablishesOtherTransaction(text: string): boolean {
  const t = text.toLowerCase();
  if (/other transaction/.test(t)) return true;
  if (/\bota\b/.test(t)) {
    return /\b(agreement|authority|prototype|transaction)\b/.test(t);
  }
  return false;
}

/** Standard FAR-style solicitation — not Special Notice keyword fishing alone. */
export function isConventionalSolicitationNoticeType(
  noticeType?: string | null,
  title?: string | null,
): boolean {
  if (!noticeType?.trim()) return false;
  const info = classifyNoticeType(noticeType, title);
  if (info.respondability === 'none' || info.respondability === 'response') return false;
  const t = noticeType.toLowerCase();
  if (t.includes('special')) {
    return Boolean(info.label?.includes('RPP'));
  }
  return (
    t.includes('solicitation') ||
    t.includes('combined') ||
    t.includes('rfp') ||
    t.includes('rfq') ||
    t.includes('bundle') ||
    t.includes('consolidat')
  );
}

/** Observed pathway kinds that must never ship without live evidence — reject as observed. */
export function rejectUnsupportedObservedPathway(kind: string): boolean {
  return (
    kind === 'consortium' ||
    kind === 'rapid_acquisition_office' ||
    kind === 'pae_portfolio' ||
    kind === 'other_mechanism'
  );
}

export function classifyObservedPathways(
  rows: PathwayEvidenceRow[],
  agencyLabel: string,
  capabilityLabel: string,
): {
  observed: ObservedPathway[];
  potential_not_established: PotentialPathwayNotEstablished[];
} {
  const observed: ObservedPathway[] = [];
  const citationsFor = (pred: (r: PathwayEvidenceRow) => boolean): CaiCitation[] =>
    rows
      .filter(pred)
      .slice(0, 5)
      .map((r) => ({
        source_kind: r.source_kind,
        source_id: r.source_id,
        locator: r.locator,
        as_of: r.as_of,
      }));

  const conventionalRows = rows.filter((r) =>
    isConventionalSolicitationNoticeType(r.notice_type, r.title),
  );
  if (conventionalRows.length) {
    observed.push({
      kind: 'conventional_solicitation',
      established: true,
      statement: `${agencyLabel} has conventional solicitations posted in Mindy’s live SAM records for ${capabilityLabel}. This is record evidence in this scope — not proof that future buys will use the same mechanism.`,
      citations: citationsFor((r) => isConventionalSolicitationNoticeType(r.notice_type, r.title)),
      evidence_count: conventionalRows.length,
    });
  }

  const idvRows = rows.filter((r) => {
    const blob = `${r.notice_type || ''} ${r.title || ''} ${r.description || ''}`.toLowerCase();
    return (
      blob.includes('task order') ||
      blob.includes('delivery order') ||
      blob.includes('bpa call') ||
      blob.includes('blanket purchase')
    );
  });
  if (idvRows.length) {
    observed.push({
      kind: 'idv_task_order',
      established: true,
      statement: `Task-order / IDV / BPA activity appears in scoped recompete records for ${capabilityLabel}. Record evidence only — not certainty that the next buy will ride the same vehicle.`,
      citations: citationsFor((r) => {
        const blob = `${r.notice_type || ''} ${r.title || ''} ${r.description || ''}`.toLowerCase();
        return (
          blob.includes('task order') ||
          blob.includes('delivery order') ||
          blob.includes('bpa call') ||
          blob.includes('blanket purchase')
        );
      }),
      evidence_count: idvRows.length,
    });
  }

  const csoRows = rows.filter((r) => {
    const blob = `${r.title || ''} ${r.description || ''} ${r.notice_type || ''}`;
    return textEstablishesCso(blob);
  });
  if (csoRows.length) {
    observed.push({
      kind: 'cso',
      established: true,
      statement: `Commercial Solutions Opening language appears on scoped SAM notices for ${capabilityLabel}. That establishes CSO on these records — not that future cybersecurity buys will use CSO.`,
      citations: citationsFor((r) => textEstablishesCso(`${r.title || ''} ${r.description || ''} ${r.notice_type || ''}`)),
      evidence_count: csoRows.length,
    });
  }

  const otRows = rows.filter((r) => {
    const blob = `${r.title || ''} ${r.description || ''} ${r.notice_type || ''}`;
    return textEstablishesOtherTransaction(blob);
  });
  if (otRows.length) {
    observed.push({
      kind: 'other_transaction',
      established: true,
      statement: `Other-transaction language appears on scoped records for ${capabilityLabel}. Record evidence only — not a prediction that the next acquisition will be OT.`,
      citations: citationsFor((r) =>
        textEstablishesOtherTransaction(`${r.title || ''} ${r.description || ''} ${r.notice_type || ''}`),
      ),
      evidence_count: otRows.length,
    });
  }

  const setAsideRows = rows.filter((r) => Boolean((r.set_aside_type || r.set_aside_code || '').trim()));
  if (setAsideRows.length) {
    observed.push({
      kind: 'set_aside',
      established: true,
      statement: `Explicit set-aside labels appear on scoped notices or awards for ${capabilityLabel}. Labels on these records are not a guarantee about how the next buy will be competed.`,
      citations: citationsFor((r) => Boolean((r.set_aside_type || r.set_aside_code || '').trim())),
      evidence_count: setAsideRows.length,
    });
  }

  const observedKinds = new Set(observed.map((o) => o.kind));
  const potential_not_established: PotentialPathwayNotEstablished[] = ALL_POTENTIAL_KINDS.map((kind) => ({
    kind,
    established: false,
    statement: `I cannot yet establish whether ${agencyLabel} intends to use a ${POTENTIAL_PATHWAY_LABELS[kind]} for this ${capabilityLabel} requirement from Mindy’s live records.`,
  }));

  // Strip any mistakenly observed unsupported kinds (defense in depth for tests).
  const filteredObserved = observed.filter((o) => !rejectUnsupportedObservedPathway(o.kind));

  return { observed: filteredObserved, potential_not_established };
}

function sb(): SupabaseClient {
  sanitizeSupabaseEnv();
  return createClient(
    sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL),
    sanitizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
}

function clampWindowDays(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 90;
  return Math.min(Math.max(Math.round(v), 7), 365);
}

function uniqStrings(vals: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of vals) {
    const s = (v || '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function extractKeywords(input: CurrentAcquisitionIntelligenceInput): string[] {
  const fromList = uniqStrings(input.keywords ?? []);
  if (fromList.length) return fromList;
  const cap = (input.capability || '').trim();
  if (cap) return cap.split(/\s+/).filter((w) => w.length > 2);
  return [];
}

function resolveNaics(input: CurrentAcquisitionIntelligenceInput, capability: string): string[] {
  const explicit = parseNaicsCodes(input.naics ?? []);
  if (explicit.length) return explicit;
  const toa = termOfArtNaicsCodes(capability);
  return toa ?? [];
}

function emptyResult(
  scope: CurrentAcquisitionIntelligenceResult['scope'],
  note: string,
): CurrentAcquisitionIntelligenceResult {
  const agency = scope.agency || 'this buyer';
  const capability = scope.capability_label || 'this capability';
  const pathways = classifyObservedPathways([], agency, capability);
  return {
    scope,
    presentation: { sections: PRESENTATION, host_rules: [...HOST_RULES] },
    what_changed: [],
    what_we_are_seeing_now: [],
    what_that_may_mean: [],
    do_differently: [],
    not_yet_measurable: [
      {
        id: 'nym_scope',
        epistemic: 'not_yet_measurable',
        statement: note,
        citations: [],
      },
      ...pathways.potential_not_established.map((p, i) => ({
        id: `nym_path_${i + 1}`,
        epistemic: 'not_yet_measurable' as const,
        statement: p.statement,
        citations: [],
      })),
    ],
    pathways,
    _next: [{ ...CAI_NEXT }],
    _meta: {
      grounded: false,
      degraded: false,
      journey: 'current_intelligence',
      epistemic_counts: {
        observed_change: 0,
        current_state: 0,
        supported_implication: 0,
        do_differently: 0,
        not_yet_measurable: 1 + pathways.potential_not_established.length,
      },
      sources_queried: [],
      sources_failed: [],
      next_outputs_not_yet: [
        'pathway_recommendation',
        'talent_fit',
        'capability_statement',
        'response',
        'meeting_brief',
      ],
    },
  };
}

function epistemicCounts(result: Omit<CurrentAcquisitionIntelligenceResult, '_meta'> & {
  _meta: Omit<CurrentAcquisitionIntelligenceResult['_meta'], 'epistemic_counts'>;
}): Record<CaiEpistemicClass, number> {
  return {
    observed_change: result.what_changed.length,
    current_state: result.what_we_are_seeing_now.length,
    supported_implication: result.what_that_may_mean.length,
    do_differently: result.do_differently.length,
    not_yet_measurable: result.not_yet_measurable.length,
  };
}

async function resolveAgencyFromAnchors(
  client: SupabaseClient,
  noticeIds: string[],
  contractIds: string[],
): Promise<string | null> {
  if (noticeIds.length) {
    const { data, error } = await client
      .from('sam_opportunities')
      .select('department, sub_tier')
      .in('notice_id', noticeIds.slice(0, 20))
      .limit(20);
    if (error) console.error('[cai] resolveAgency sam_opportunities:', error.message);
    for (const r of data || []) {
      const dep = String((r as { department?: string }).department || '').trim();
      const sub = String((r as { sub_tier?: string }).sub_tier || '').trim();
      if (dep) return dep;
      if (sub) return sub;
    }
  }
  if (contractIds.length) {
    const { data, error } = await client
      .from('recompete_opportunities')
      .select('awarding_agency, awarding_sub_agency')
      .in('contract_id', contractIds.slice(0, 20))
      .limit(20);
    if (error) console.error('[cai] resolveAgency recompete_opportunities:', error.message);
    for (const r of data || []) {
      const ag = String((r as { awarding_agency?: string }).awarding_agency || '').trim();
      const sub = String((r as { awarding_sub_agency?: string }).awarding_sub_agency || '').trim();
      if (ag) return ag;
      if (sub) return sub;
    }
  }
  return null;
}

/** Live compose bundle. Exported so tests can prove unavailable ≠ zero. */
export type CaiSourceBundle = {
  samRows: Array<Record<string, unknown>>;
  samCount: number | null;
  recompeteRows: Array<Record<string, unknown>>;
  recompeteCount: number | null;
  changeRows: Array<Record<string, unknown>>;
  forecastRows: Array<Record<string, unknown>>;
  forecastCount: number | null;
  eventCount: number;
  pathwayEvidence: PathwayEvidenceRow[];
  sourcesQueried: CaiSourceKind[];
  sourcesFailed: CaiSourceKind[];
  degraded: boolean;
};

type SourceBundle = CaiSourceBundle;

async function fetchLiveSources(
  client: SupabaseClient,
  scope: {
    agency: string;
    capabilityLabel: string;
    keywords: string[];
    naics: string[];
    windowStart: string;
    dodaac: string | null;
    noticeIds: string[];
    contractIds: string[];
  },
): Promise<SourceBundle> {
  const sourcesQueried: CaiSourceKind[] = [];
  const sourcesFailed: CaiSourceKind[] = [];
  let degraded = false;

  const samCols =
    'notice_id, title, description, department, sub_tier, naics_code, set_aside_code, set_aside_description, notice_type, response_deadline, solicitation_number, updated_at';

  let samRows: Array<Record<string, unknown>> = [];
  let samCount: number | null = null;
  sourcesQueried.push('sam_opportunities');
  try {
    const get = (k: string): string | null => {
      if (k === 'status') return 'active';
      if (k === 'agency') return scope.agency;
      if (k === 'naics') return scope.naics.length ? scope.naics.join(',') : null;
      if (k === 'q' || k === 'search') return scope.keywords[0] || scope.capabilityLabel || null;
      return null;
    };
    let q = client.from('sam_opportunities').select(samCols, { count: 'exact' });
    q = applyMapFilters(q, parseMapFilters(get));
    if (scope.dodaac && /^[A-Z][A-Z0-9]{5}$/.test(scope.dodaac)) {
      q = q.ilike('solicitation_number', `${scope.dodaac}%`);
    }
    const { data, count, error } = await q.order('updated_at', { ascending: false }).limit(200);
    if (error) {
      sourcesFailed.push('sam_opportunities');
      degraded = true;
    } else {
      samRows = (data || []) as Array<Record<string, unknown>>;
      samCount = count ?? null;
    }
  } catch {
    sourcesFailed.push('sam_opportunities');
    degraded = true;
  }

  let recompeteRows: Array<Record<string, unknown>> = [];
  let recompeteCount: number | null = null;
  sourcesQueried.push('recompete_opportunities');
  try {
    const res = await queryExpiringContracts({
      agency: scope.agency,
      naicsCodes: scope.naics.length ? scope.naics : undefined,
      naics: scope.naics.length === 1 ? scope.naics[0] : undefined,
      monthsWindow: 18,
      limit: 200,
    });
    if (res.degraded) {
      sourcesFailed.push('recompete_opportunities');
      degraded = true;
    } else {
      recompeteRows = res.contracts as unknown as Array<Record<string, unknown>>;
      recompeteCount = res.count;
    }
  } catch {
    sourcesFailed.push('recompete_opportunities');
    degraded = true;
  }

  let changeRows: Array<Record<string, unknown>> = [];
  sourcesQueried.push('recompete_changes');
  try {
    const contractIds = [
      ...scope.contractIds,
      ...recompeteRows.map((r) => String(r.contract_id || '')).filter(Boolean),
    ].slice(0, 500);
    if (contractIds.length) {
      const { data, error } = await client
        .from('recompete_changes')
        .select('id, contract_id, piid, naics_code, field, old_value, new_value, observed_at')
        .in('contract_id', [...new Set(contractIds)].slice(0, 500))
        .gte('observed_at', scope.windowStart)
        .order('observed_at', { ascending: false })
        .limit(50);
      if (error) {
        sourcesFailed.push('recompete_changes');
        degraded = true;
      } else {
        changeRows = (data || []) as Array<Record<string, unknown>>;
      }
    }
  } catch {
    sourcesFailed.push('recompete_changes');
    degraded = true;
  }

  let forecastRows: Array<Record<string, unknown>> = [];
  let forecastCount: number | null = null;
  sourcesQueried.push('agency_forecasts');
  try {
    let fq = client
      .from('agency_forecasts')
      .select('id, agency, source_agency, department, naics_code, title, fiscal_year, last_synced_at', {
        count: 'exact',
      });
    const agencyNeedles = multiAgency(scope.agency);
    const expr = [
      agencyOrExpr('agency', agencyNeedles),
      agencyOrExpr('source_agency', agencyNeedles),
      agencyOrExpr('department', agencyNeedles),
    ]
      .filter(Boolean)
      .join(',');
    if (expr) fq = fq.or(expr);
    if (scope.naics.length) {
      const codes = scope.naics.filter((c) => /^\d{2,6}$/.test(c));
      if (codes.length === 1) {
        const c = codes[0];
        fq = c.length < 6 ? fq.ilike('naics_code', `${c}%`) : fq.eq('naics_code', c);
      } else if (codes.length > 1) {
        fq = fq.or(
          codes
            .map((c) => (c.length < 6 ? `naics_code.ilike.${c}%` : `naics_code.eq.${c}`))
            .join(','),
        );
      }
    }
    // fiscal_year is free text — do not .gte numeric; unknown timing survives.
    const { data, count, error } = await fq.limit(100);
    if (error) {
      sourcesFailed.push('agency_forecasts');
      degraded = true;
    } else {
      forecastRows = (data || []) as Array<Record<string, unknown>>;
      forecastCount = count ?? null;
    }
  } catch {
    sourcesFailed.push('agency_forecasts');
    degraded = true;
  }

  let eventCount = 0;
  sourcesQueried.push('sam_events');
  try {
    const ev = await queryFederalEvents({
      agency: scope.agency,
      monthsAhead: 6,
      includeAiDiscovery: false,
      currentYear: new Date().getFullYear(),
      limit: 30,
    });
    if (ev.degraded) {
      sourcesFailed.push('sam_events');
      degraded = true;
    } else {
      eventCount = ev.events.length;
    }
  } catch {
    sourcesFailed.push('sam_events');
    degraded = true;
  }

  const pathwayEvidence: PathwayEvidenceRow[] = [];
  for (const r of samRows) {
    pathwayEvidence.push({
      notice_type: (r.notice_type as string) || null,
      title: (r.title as string) || null,
      description: (r.description as string) || null,
      set_aside_code: (r.set_aside_code as string) || null,
      set_aside_type: (r.set_aside_description as string) || null,
      source_kind: 'sam_opportunities',
      source_id: String(r.notice_id || '') || null,
      locator: `sam_opportunities.notice_id=${r.notice_id}`,
      as_of: (r.updated_at as string)?.slice(0, 10) || null,
    });
  }
  for (const r of recompeteRows) {
    pathwayEvidence.push({
      set_aside_type: (r.set_aside_type as string) || null,
      title: (r.description as string) || null,
      source_kind: 'recompete_opportunities',
      source_id: String(r.contract_id || '') || null,
      locator: `recompete_opportunities.contract_id=${r.contract_id}`,
      as_of: (r.period_of_performance_current_end as string) || null,
    });
  }

  return {
    samRows,
    samCount,
    recompeteRows,
    recompeteCount,
    changeRows,
    forecastRows,
    forecastCount,
    eventCount,
    pathwayEvidence,
    sourcesQueried,
    sourcesFailed,
    degraded,
  };
}

function buildWhatChanged(changeRows: Array<Record<string, unknown>>): CaiItem[] {
  const items: CaiItem[] = [];
  let i = 0;
  for (const row of changeRows.slice(0, 8)) {
    i += 1;
    const field = String(row.field || 'field');
    const cid = String(row.contract_id || '');
    items.push({
      id: `chg_${String(i).padStart(2, '0')}`,
      epistemic: 'observed_change',
      statement: `Contract ${row.piid || cid} ${field} moved from ${row.old_value ?? 'unknown'} to ${row.new_value ?? 'unknown'}.`,
      citations: [
        {
          source_kind: 'recompete_changes',
          source_id: String(row.id || '') || null,
          locator: `recompete_changes.contract_id=${cid};field=${field}`,
          as_of: String(row.observed_at || '').slice(0, 10) || null,
        },
      ],
    });
  }
  return items;
}

function countFinalTwelveMonths(recompeteRows: Array<Record<string, unknown>>): number {
  const today = new Date();
  const in12 = new Date(today);
  in12.setMonth(in12.getMonth() + 12);
  let n = 0;
  for (const r of recompeteRows) {
    const end = String(r.period_of_performance_current_end || '');
    if (!end) continue;
    const d = new Date(end);
    if (d >= today && d <= in12) n += 1;
  }
  return n;
}

function topOfficeFromSam(samRows: Array<Record<string, unknown>>): { office: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const r of samRows) {
    const office = String(r.sub_tier || r.department || '').trim();
    if (!office) continue;
    counts.set(office, (counts.get(office) || 0) + 1);
  }
  let best: { office: string; count: number } | null = null;
  for (const [office, count] of counts) {
    if (!best || count > best.count) best = { office, count };
  }
  return best;
}

export function buildCurrentState(
  bundle: SourceBundle,
  agency: string,
  capabilityLabel: string,
): CaiItem[] {
  const items: CaiItem[] = [];
  let seq = 0;
  const nextId = () => `see_${String(++seq).padStart(2, '0')}`;

  if (bundle.samCount !== null && bundle.samRows.length) {
    items.push({
      id: nextId(),
      epistemic: 'current_state',
      statement: `${agency} has ${bundle.samCount ?? bundle.samRows.length} active open notices in scope for ${capabilityLabel}.`,
      citations: [
        {
          source_kind: 'sam_opportunities',
          source_id: String(bundle.samRows[0]?.notice_id || '') || null,
          locator: 'sam_opportunities (active, scoped)',
          as_of: String(bundle.samRows[0]?.updated_at || '').slice(0, 10) || null,
        },
      ],
      magnitude: {
        label: 'open notices',
        value: bundle.samCount,
        unit: 'count',
        unknown: bundle.samCount === null,
      },
    });
  }

  const topOffice = topOfficeFromSam(bundle.samRows);
  if (topOffice && topOffice.count >= 2) {
    items.push({
      id: nextId(),
      epistemic: 'current_state',
      statement: `Most open demand concentrates at ${topOffice.office} (${topOffice.count} notices in this pull).`,
      citations: [
        {
          source_kind: 'sam_opportunities',
          source_id: String(bundle.samRows[0]?.notice_id || '') || null,
          locator: `sam_opportunities.sub_tier=${topOffice.office}`,
          as_of: null,
        },
      ],
      magnitude: { label: 'notices at top office', value: topOffice.count, unit: 'count' },
    });
  }

  const final12 = countFinalTwelveMonths(bundle.recompeteRows);
  if (final12 > 0) {
    items.push({
      id: nextId(),
      epistemic: 'current_state',
      statement: `${final12} relevant contracts in scope are in their final 12 months before period-of-performance end.`,
      citations: [
        {
          source_kind: 'recompete_opportunities',
          source_id: String(bundle.recompeteRows[0]?.contract_id || '') || null,
          locator: 'recompete_opportunities (POP end within 12mo)',
          as_of: new Date().toISOString().slice(0, 10),
        },
      ],
      magnitude: { label: 'contracts', value: final12, unit: 'count' },
    });
  } else if (bundle.recompeteCount !== null && bundle.recompeteCount > 0) {
    items.push({
      id: nextId(),
      epistemic: 'current_state',
      statement: `${bundle.recompeteCount} expiring contracts match this buyer and capability in the next 18 months.`,
      citations: [
        {
          source_kind: 'recompete_opportunities',
          source_id: String(bundle.recompeteRows[0]?.contract_id || '') || null,
          locator: 'recompete_opportunities (18mo window)',
          as_of: null,
        },
      ],
      magnitude: {
        label: 'expiring contracts',
        value: bundle.recompeteCount,
        unit: 'count',
        unknown: bundle.recompeteCount === null,
      },
    });
  }

  // Unavailable horizons: never emit a measured zero for a failed source.
  if (bundle.sourcesFailed.includes('agency_forecasts')) {
    items.push({
      id: nextId(),
      epistemic: 'current_state',
      statement: `Agency forecast coverage was unavailable for this pull (source error) — not a measured zero for ${capabilityLabel} demand.`,
      citations: [
        {
          source_kind: 'agency_forecasts',
          source_id: null,
          locator: 'agency_forecasts (unavailable)',
          as_of: null,
        },
      ],
      magnitude: { label: 'forecasts', value: null, unit: 'count', unknown: true },
    });
  } else if (bundle.forecastCount !== null) {
    items.push({
      id: nextId(),
      epistemic: 'current_state',
      statement:
        bundle.forecastCount === 0
          ? `No agency forecast rows matched ${agency} in this scope — that is a scope miss in the forecast table, not proof of no demand.`
          : `${bundle.forecastCount} agency forecast rows match this buyer and capability scope.`,
      citations: [
        {
          source_kind: 'agency_forecasts',
          source_id: bundle.forecastRows[0] ? String(bundle.forecastRows[0].id || '') : null,
          locator: 'agency_forecasts (scoped)',
          as_of: bundle.forecastRows[0]
            ? String(bundle.forecastRows[0].last_synced_at || '').slice(0, 10) || null
            : null,
        },
      ],
      magnitude: {
        label: 'forecasts',
        value: bundle.forecastCount === 0 ? null : bundle.forecastCount,
        unit: 'count',
        unknown: bundle.forecastCount === 0,
      },
    });
  }

  if (bundle.sourcesFailed.includes('sam_opportunities')) {
    items.push({
      id: nextId(),
      epistemic: 'current_state',
      statement: `Open-notice coverage was unavailable for this pull (SAM source error) — not a measured zero for ${capabilityLabel}.`,
      citations: [
        {
          source_kind: 'sam_opportunities',
          source_id: null,
          locator: 'sam_opportunities (unavailable)',
          as_of: null,
        },
      ],
      magnitude: { label: 'open notices', value: null, unit: 'count', unknown: true },
    });
  }

  if (bundle.eventCount > 0) {
    items.push({
      id: nextId(),
      epistemic: 'current_state',
      statement: `${bundle.eventCount} upcoming industry / matchmaking events appear for ${agency} in the next six months.`,
      citations: [
        {
          source_kind: 'sam_events',
          source_id: null,
          locator: 'sam_events (upcoming, agency-scoped)',
          as_of: new Date().toISOString().slice(0, 10),
        },
      ],
      magnitude: { label: 'events', value: bundle.eventCount, unit: 'count' },
    });
  }

  return items.slice(0, 8);
}

function buildImplicationsAndActions(
  whatChanged: CaiItem[],
  currentState: CaiItem[],
): { implications: CaiItem[]; actions: CaiItem[] } {
  const implications: CaiItem[] = [];
  const actions: CaiItem[] = [];

  const final12 = currentState.find((s) => s.statement.includes('final 12 months'));
  if (final12) {
    implications.push({
      id: 'imp_01',
      epistemic: 'supported_implication',
      statement:
        'Replacement windows may be opening before new solicitations post — incumbent engagement timing may matter. This is not proof that competition has already happened or that a specific vehicle will win the next buy.',
      citations: [],
      caused_by: [final12.id],
    });
    actions.push({
      id: 'act_01',
      epistemic: 'do_differently',
      statement:
        'Consider engaging the buyers and contracts entering their final year now rather than waiting for a new solicitation — without assuming what vehicle or set-aside comes next.',
      citations: [],
      caused_by: [final12.id],
    });
  }

  const topOffice = currentState.find((s) => s.statement.includes('concentrates at'));
  if (topOffice) {
    implications.push({
      id: 'imp_02',
      epistemic: 'supported_implication',
      statement:
        'Office-level positioning may matter more than department-wide marketing for this scope — concentration in this pull is not a binding constraint on how the buyer must acquire next.',
      citations: [],
      caused_by: [topOffice.id],
    });
    actions.push({
      id: 'act_02',
      epistemic: 'do_differently',
      statement:
        'Prioritize the buying offices showing the highest open-notice concentration in this pull — treat that as a lead, not as proof of where money goes next.',
      citations: [],
      caused_by: [topOffice.id],
    });
  }

  if (whatChanged.length) {
    implications.push({
      id: 'imp_03',
      epistemic: 'supported_implication',
      statement:
        'Recorded contract-field moves in the lookback window may shift recompete timing or ceiling assumptions — they do not by themselves establish what replaces the current vehicle.',
      citations: [],
      caused_by: whatChanged.slice(0, 3).map((c) => c.id),
    });
  }

  return {
    implications: scrubAbsoluteFutureClaims(implications.slice(0, 5)),
    actions: scrubAbsoluteFutureClaims(actions.slice(0, 5)),
  };
}

function buildNotYetMeasurable(
  agency: string,
  capabilityLabel: string,
  pathways: ReturnType<typeof classifyObservedPathways>,
  observedKinds: ObservedPathwayKind[],
): CaiItem[] {
  const items: CaiItem[] = [];
  let seq = 0;

  const gapParts: string[] = [];
  if (!observedKinds.includes('cso')) gapParts.push('CSO');
  if (!observedKinds.includes('other_transaction')) gapParts.push('OT');
  if (gapParts.length) {
    items.push({
      id: `nym_${String(++seq).padStart(2, '0')}`,
      epistemic: 'not_yet_measurable',
      statement: `I cannot yet establish whether ${agency} intends to use ${gapParts.join(' or ')} acquisition for ${capabilityLabel} beyond what appears in observed pathways.`,
      citations: [],
    });
  }

  for (const p of pathways.potential_not_established) {
    items.push({
      id: `nym_${String(++seq).padStart(2, '0')}`,
      epistemic: 'not_yet_measurable',
      statement: p.statement,
      citations: [],
    });
  }

  items.push({
    id: `nym_${String(++seq).padStart(2, '0')}`,
    epistemic: 'not_yet_measurable',
    statement:
      'Program-manager / end-user ownership, USASpending spend concentration, IDV families, and federal contact rosters were not queried in v0.',
    citations: [],
  });

  return items;
}

export async function getCurrentAcquisitionIntelligence(
  input: CurrentAcquisitionIntelligenceInput,
): Promise<CurrentAcquisitionIntelligenceResult> {
  const windowDays = clampWindowDays(input.window_days);
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - windowDays);

  const noticeIds = uniqStrings(input.notice_ids ?? []);
  const contractIds = uniqStrings(input.contract_ids ?? []);
  const keywords = extractKeywords(input);
  const capabilityLabel = (input.capability || keywords.join(' ') || '').trim() || null;
  const naics = resolveNaics(input, capabilityLabel || '');

  const client = sb();
  let agency = (input.agency || '').trim();
  if (!agency) {
    agency = (await resolveAgencyFromAnchors(client, noticeIds, contractIds)) || '';
  }

  const scopeBase = {
    agency: agency || null,
    office: (input.office || '').trim() || null,
    dodaac: (input.dodaac || '').trim() || null,
    capability_label: capabilityLabel,
    keywords,
    naics,
    psc: uniqStrings(input.psc ?? []),
    notice_ids: noticeIds,
    contract_ids: contractIds,
    window_days: windowDays,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
  };

  const hasBuyer = Boolean(agency || noticeIds.length || contractIds.length);
  const hasCapability = Boolean(capabilityLabel || keywords.length || naics.length || noticeIds.length);
  if (!hasBuyer || !hasCapability) {
    return emptyResult(
      scopeBase,
      'Could not resolve both a buyer scope and a capability scope from the inputs — no facts were invented.',
    );
  }

  const bundle = await fetchLiveSources(client, {
    agency,
    capabilityLabel: capabilityLabel || 'this capability',
    keywords,
    naics,
    windowStart: windowStart.toISOString(),
    dodaac: scopeBase.dodaac,
    noticeIds,
    contractIds,
  });

  const what_changed = buildWhatChanged(bundle.changeRows);
  const what_we_are_seeing_now = buildCurrentState(bundle, agency, capabilityLabel || 'this capability');

  const { implications, actions } = buildImplicationsAndActions(what_changed, what_we_are_seeing_now);
  const killed = applyCausalKillerRule({
    what_changed,
    what_we_are_seeing_now,
    what_that_may_mean: implications,
    do_differently: actions,
  });
  killed.what_that_may_mean = scrubAbsoluteFutureClaims(killed.what_that_may_mean);
  killed.do_differently = scrubAbsoluteFutureClaims(killed.do_differently);

  const pathways = classifyObservedPathways(
    bundle.pathwayEvidence,
    agency,
    capabilityLabel || 'this capability',
  );
  const not_yet_measurable = buildNotYetMeasurable(
    agency,
    capabilityLabel || 'this capability',
    pathways,
    pathways.observed.map((o) => o.kind),
  );

  const grounded =
    what_changed.some((i) => i.citations.length) || what_we_are_seeing_now.some((i) => i.citations.length);

  const result: CurrentAcquisitionIntelligenceResult = {
    scope: scopeBase,
    presentation: { sections: PRESENTATION, host_rules: [...HOST_RULES] },
    what_changed,
    what_we_are_seeing_now,
    what_that_may_mean: killed.what_that_may_mean,
    do_differently: killed.do_differently,
    not_yet_measurable,
    pathways,
    _next: [{ ...CAI_NEXT }],
    _meta: {
      grounded,
      degraded: bundle.degraded,
      journey: 'current_intelligence',
      epistemic_counts: {
        observed_change: 0,
        current_state: 0,
        supported_implication: 0,
        do_differently: 0,
        not_yet_measurable: 0,
      },
      sources_queried: bundle.sourcesQueried,
      sources_failed: bundle.sourcesFailed,
      next_outputs_not_yet: [
        'pathway_recommendation',
        'talent_fit',
        'capability_statement',
        'response',
        'meeting_brief',
      ],
    },
  };
  result._meta.epistemic_counts = epistemicCounts(result);
  return result;
}
