/**
 * Hidden-market reveal — two populations from the same SAM tool.
 *
 * Direct  = search_sam_opportunities on the user's literal words (the
 *            local sam_opportunities cache — not USASpending, not live SAM.gov).
 *            That tool is active + deadline>=today, so Award Notices never
 *            appear (41k in cache, 0 pass the open filter — they have no deadline).
 * Expanded = optional open-notice language. Default /try skips USASpending.
 * Awarded  = when open search is empty: SAM Award Notices in sam_opportunities
 *            PLUS task/delivery orders in BigQuery `usaspending.awards`
 *            (parent_piid set). Same warehouse, not the USASpending HTTP API.
 *
 * We do NOT pass coverageCodes as `naics`: that tool's naics filter is a
 * single exact AND and would starve the very market this page is trying
 * to reveal (Fix #1). The hidden set is government *language*, not a
 * NAICS-filtered subset of the user's own hits.
 *
 * Dollar totals from get_keyword_coverage are never shown.
 */

import { isGenericPsc } from '@/lib/market/keyword-coverage';
import type { KeywordCoverage } from '@/lib/market/keyword-coverage';
import type { KeywordCoverageToolResult } from '@/mcp/tools/keyword-coverage';
import {
  resolveBusiness,
  type ResolveBusinessDeps,
  type ResolveBusinessInput,
} from './resolve-business';
import { translateOpportunities } from './translate-opportunity';
import { keyedItems, opportunityKey } from './opportunity-key';
import { classifyOpportunities, type RelevanceContext } from './relevance';
import { extractBusinessActivity, type BusinessActivity } from './activity';
import {
  describeStageMix,
  emptyStageCounts,
  noticeStage,
  type StageCounts,
} from './labels';
import { toPublicBeginnerCard, type BeginnerMarketReveal, type HiddenMarketLandingView } from './landing';
import { ctaLabel, type CtaVariant, type RevealState } from './labels';
import {
  CLASSIFY_UNAVAILABLE_MESSAGE,
  EMPTY_MATCH_MESSAGE,
  EMPTY_OPEN_MARKET_MESSAGE,
  FOLLOW_UP_PROMPT,
  UNAVAILABLE_MESSAGE,
  type EligibilityEvidence,
  type ResolvedBusiness,
  type SamSearchItem,
  type SamSearchResult,
} from './types';

export type { CtaVariant, RevealState, BeginnerMarketReveal, HiddenMarketLandingView };
export { ctaLabel };

export const REVEAL_THRESHOLDS = {
  strongExpandedMin: 3,
  strongDirectMin: 1,
  expandedOnlyMin: 1,
  directOnlyMin: 3,
  thinTotalMax: 2,
  cardsPerGroup: 3,
} as const;

/** Same limit on A and B so the two floors are comparable. Not a census. */
export const HIDDEN_MARKET_SEARCH_LIMIT = 40;

export const DIRECT_GROUP_LABEL = 'Matches what you described';
export const UNCOVERED_GROUP_LABEL = 'Opportunities Mindy uncovered';
export const AWARDED_GROUP_LABEL = 'Recently awarded';
/**
 * Everything that has REAL but weaker evidence: a shortened form of the user's
 * word ("trucking" → "Trucks"), a code-family overlap, or an outlier sector
 * among that term's own matches. Shown, but never as "matches what you
 * described" — the batch requirement to separate direct from broader.
 */
export const RELATED_GROUP_LABEL = 'Related — broader or adjacent';
export const AWARDED_ONLY_EXPLANATION =
  'Nothing matching is open to bid right now. Government recently awarded task orders for this work.';

export type PopulationStatus = 'ok' | 'unavailable' | 'skipped';

export interface HiddenMarketResult {
  resolution: ResolvedBusiness;
  directKeyword: string | null;
  expandedKeyword: string | null;
  direct: { status: PopulationStatus; items: SamSearchItem[] };
  expanded: { status: PopulationStatus; items: SamSearchItem[] };
  netNewItems: SamSearchItem[];
  /** Weaker-but-real evidence from either search. Never in the direct group. */
  related: SamSearchItem[];
  /** What we decided the user actually sells. */
  activity: BusinessActivity;
  /**
   * No business activity survived the context strip ("I help businesses").
   * The honest answer is a question, NOT an outage and NOT a confident list.
   */
  needsClarification?: boolean;
  reveal: BeginnerMarketReveal;
  /** True when the uncovered group is Award Notices, not open solicitations. */
  awardedFallback?: boolean;
}

export interface HiddenMarketDeps extends Partial<ResolveBusinessDeps> {
  searchSam?: (args: { keyword: string; limit?: number }) => Promise<SamSearchResult>;
  /** Award Notices in sam_opportunities (no deadline filter). */
  searchAwarded?: (args: { keyword: string; limit?: number }) => Promise<SamSearchResult>;
  /** Task/delivery orders in the BigQuery awards warehouse (parent_piid set). */
  searchTaskOrders?: (args: { keyword: string; limit?: number }) => Promise<SamSearchResult>;
}

/**
 * /try shows OPEN notices from sam_opportunities. get_keyword_coverage is
 * USASpending award history (what was bought), not what is open — it was
 * gating lidar survey listings behind aircraft-manufacturing NAICS.
 * Pass getCoverage only when a caller wants the uncovered/award-language set.
 */
async function skipUsaSpendingCoverage(input: { keyword: string }): Promise<KeywordCoverageToolResult> {
  return {
    queried: { keyword: input.keyword, coverage_target: 0.9 },
    coverage: null,
    _meta: { grounded: false, degraded: false, naics_count: 0, total_market: 0 },
  };
}

async function defaultSearchSam(args: { keyword: string; limit?: number }): Promise<SamSearchResult> {
  const { getWriteClient } = await import('@/lib/supabase/server-clients');
  const { makeTier1Tools } = await import('@/lib/chat/tier1-tools');
  const tools = makeTier1Tools(getWriteClient() as never);
  const result = await tools.execute('search_sam_opportunities', args);
  return result as SamSearchResult;
}

function escapeIlike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Award Notices / task-order awards already in sam_opportunities.
 * search_sam_opportunities requires response_deadline >= today, which drops
 * every Award Notice (null deadline). This is the same cache, not USASpending.
 */
async function defaultSearchAwarded(args: { keyword: string; limit?: number }): Promise<SamSearchResult> {
  const keyword = (args.keyword || '').trim();
  if (keyword.length < 3) return { ok: true, count: 0, items: [] };
  const { getWriteClient } = await import('@/lib/supabase/server-clients');
  const db = getWriteClient();
  const limit = Math.max(1, Math.min(args.limit ?? HIDDEN_MARKET_SEARCH_LIMIT, 40));
  const { data, error } = await db
    .from('sam_opportunities')
    .select(
      'title, department, naics_code, set_aside_description, notice_type, response_deadline, ui_link, solicitation_number, posted_date, award_amount',
    )
    .ilike('notice_type', '%award%')
    .ilike('title', `%${escapeIlike(keyword)}%`)
    .order('posted_date', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return { ok: false, error: error.message, count: 0, items: [] };
  const items: SamSearchItem[] = (data || []).map((row) => {
    const r = row as {
      title?: string | null;
      department?: string | null;
      naics_code?: string | null;
      set_aside_description?: string | null;
      notice_type?: string | null;
      response_deadline?: string | null;
      ui_link?: string | null;
      solicitation_number?: string | null;
      posted_date?: string | null;
      award_amount?: string | number | null;
    };
    const n = r.award_amount == null || r.award_amount === '' ? NaN : Number(r.award_amount);
    return {
      title: r.title ?? null,
      agency: r.department ?? null,
      naics: r.naics_code ?? null,
      set_aside: r.set_aside_description ?? null,
      type: r.notice_type ?? null,
      deadline: r.posted_date ?? r.response_deadline ?? null,
      solicitation: r.solicitation_number ?? null,
      link: r.ui_link ?? null,
      amount: Number.isFinite(n) ? n : undefined,
    };
  });
  return { ok: true, count: items.length, items };
}

function resolveAwardedSearch(deps: HiddenMarketDeps): NonNullable<HiddenMarketDeps['searchAwarded']> {
  if (deps.searchAwarded) return deps.searchAwarded;
  // Unit tests stub searchSam against a fixture corpus. Do not hit live Award
  // Notices unless they also stub searchAwarded.
  if (deps.searchSam) {
    return async () => ({ ok: true, count: 0, items: [] });
  }
  return defaultSearchAwarded;
}

async function defaultSearchTaskOrders(args: { keyword: string; limit?: number }): Promise<SamSearchResult> {
  try {
    const { searchBqTaskOrders } = await import('./task-orders-bq');
    const items = await searchBqTaskOrders(args);
    return { ok: true, count: items.length, items };
  } catch (err) {
    console.error('[beginner] BQ task-order search failed:', err);
    return { ok: true, count: 0, items: [] };
  }
}

function resolveTaskOrderSearch(
  deps: HiddenMarketDeps,
): NonNullable<HiddenMarketDeps['searchTaskOrders']> {
  if (deps.searchTaskOrders) return deps.searchTaskOrders;
  if (deps.searchSam) {
    return async () => ({ ok: true, count: 0, items: [] });
  }
  return defaultSearchTaskOrders;
}

function awardedDedupeKey(item: SamSearchItem): string | null {
  const solicitation = (item.solicitation || '').trim().toLowerCase();
  if (solicitation) return `sol:${solicitation}`;
  return opportunityKey(item);
}

function mergeAwardedItems(bq: readonly SamSearchItem[], sam: readonly SamSearchItem[]): SamSearchItem[] {
  const out: SamSearchItem[] = [];
  const seen = new Set<string>();
  for (const item of [...bq, ...sam]) {
    const key = awardedDedupeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function asItems(result: SamSearchResult): SamSearchItem[] | null {
  if (!result.ok) return null;
  if (!('items' in result) || !Array.isArray(result.items)) return null;
  return result.items;
}

/**
 * The keyword we actually search.
 *
 * ⚠️ THIS USED TO BE `keywordCandidates(text)[0]`, which ranks by POSITION
 * ("people lead with what they do"). Beginner prose leads with WHO YOU ARE, so
 * on 2026-09-21 this function returned:
 *   "can a 2 person garbage company do government contracts" → "person"
 *   "we do IT support for small offices"                     → "small"
 *   "we install commercial roofing"                          → "install"
 *   "physical security guard services"                       → "physical"
 *   "staffing agency"                                        → "agency"
 * "person" is the entire reason the screenshot returned a personnel-security
 * platform, a PERSONAL alert device and PERSONAL services contractors.
 *
 * It now asks ./activity for the business activity. Kept as a named export
 * because the live oracle (scripts/verify-beginner-try.mjs) reports it.
 */
export function beginnerDirectKeyword(text: string, derived: readonly string[] = []): string | null {
  return extractBusinessActivity(text || '', derived).head;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function userAlreadySaid(userText: string, phrase: string): boolean {
  const u = norm(userText);
  const p = norm(phrase);
  if (!p || p.length < 4) return true;
  if (u.includes(p)) return true;
  const words = p.split(' ').filter((w) => w.length > 3 && w !== 'services' && w !== 'service' && w !== 'other');
  if (words.length === 0) return u.includes(p);
  return words.every((w) => u.includes(w));
}

function coveragePayload(resolution: ResolvedBusiness): KeywordCoverage | null {
  const raw = resolution.provenance.coverage as KeywordCoverageToolResult | undefined;
  if (!raw || raw._meta?.degraded) return null;
  if (!raw._meta?.grounded || !raw.coverage) return null;
  return raw.coverage;
}

/**
 * Plain-English buying phrases from get_keyword_coverage only.
 * Never invent a term to pad the line. Drop codes and names the user already typed.
 */
export function coverageTranslatedTerms(userText: string, coverage: KeywordCoverage | null): string[] {
  if (!coverage) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const candidates: string[] = [];
  const leadUseful = (coverage.allNaics || []).find((row) => row?.name && !isCatchAllName(row.name))?.name;
  if (leadUseful) candidates.push(leadUseful);
  if (coverage.topPsc?.name && !isGenericPsc(coverage.topPsc.name) && !looksLikePscLabel(coverage.topPsc.name)) {
    candidates.push(coverage.topPsc.name);
  }
  const seed = [leadUseful, coverage.keyword].filter(Boolean).join(' ');
  for (const row of (coverage.allNaics || []).slice(1, 8)) {
    if (row?.name && !isCatchAllName(row.name) && relatedName(seed, row.name)) candidates.push(row.name);
  }
  for (const phrase of candidates) {
    const cleaned = phrase.replace(/\s*\(\d{2,6}\)\s*/g, ' ').replace(/\b\d{6}\b/g, '').trim();
    if (!cleaned) continue;
    if (/\b(naics|psc|fpds|dodaac)\b/i.test(cleaned)) continue;
    if (looksLikePscLabel(cleaned) || isCatchAllName(cleaned)) continue;
    if (userAlreadySaid(userText, cleaned)) continue;
    const key = norm(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= 3) break;
  }
  return out;
}

export function pickExpandedKeyword(
  userText: string,
  _coverageKeyword: string | null,
  terms: readonly string[],
  directKeyword: string | null,
): string | null {
  const direct = norm(directKeyword || '');
  for (const term of terms) {
    if (norm(term) === direct) continue;
    if (!userAlreadySaid(userText, term)) return term;
  }
  return null;
}

function distinctiveToken(phrase: string): string | null {
  const stop = new Set([
    'services',
    'service',
    'other',
    'related',
    'support',
    'establishment',
    'except',
    'including',
  ]);
  const words = norm(phrase)
    .split(' ')
    .filter((w) => w.length >= 5 && !stop.has(w));
  words.sort((a, b) => b.length - a.length);
  return words[0] || null;
}

/** Body-pass SAM hits often match a generic word like "services". Hidden cards must be about the buying language. */
export function titleMatchesExpanded(item: SamSearchItem, expandedKeyword: string): boolean {
  const tok = distinctiveToken(expandedKeyword);
  if (!tok) return true;
  return (item.title || '').toLowerCase().includes(tok);
}

function isCatchAllName(name: string): boolean {
  return /\ball other\b/i.test(name) || /\bmiscellaneous\b/i.test(name);
}

function looksLikePscLabel(name: string): boolean {
  const letters = name.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 4) return true;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.85;
}

function relatedName(seed: string, name: string): boolean {
  const stop = new Set(['services', 'service', 'other', 'related', 'support', 'except']);
  const tok = (s: string) =>
    norm(s)
      .split(' ')
      .filter((w) => w.length > 3 && !stop.has(w))
      .map((w) => w.replace(/s$/, ''));
  const seeds = new Set(tok(seed));
  if (seeds.size === 0) return false;
  return tok(name).some((w) => seeds.has(w));
}

function uniqueKeyed(items: readonly SamSearchItem[]): Map<string, SamSearchItem> {
  const map = new Map<string, SamSearchItem>();
  for (const { key, item } of keyedItems(items).keyed) {
    if (!map.has(key)) map.set(key, item);
  }
  return map;
}

export function netNewItems(direct: readonly SamSearchItem[], expanded: readonly SamSearchItem[]): SamSearchItem[] {
  const directKeys = new Set(uniqueKeyed(direct).keys());
  const out: SamSearchItem[] = [];
  const seen = new Set<string>();
  for (const { key, item } of keyedItems(expanded).keyed) {
    if (directKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function decideRevealState(args: {
  directStatus: PopulationStatus;
  expandedStatus: PopulationStatus;
  directMatchCount: number | null;
  expandedMatchCount: number | null;
  totalUniqueCount: number | null;
}): RevealState {
  const { directStatus, expandedStatus, directMatchCount, expandedMatchCount, totalUniqueCount } = args;
  const t = REVEAL_THRESHOLDS;
  // Without A we cannot prove B\A. Do not call expanded hits "hidden."
  if (directStatus === 'unavailable') return 'unavailable';
  if (expandedStatus === 'unavailable' && directStatus !== 'ok') return 'unavailable';
  if (
    typeof expandedMatchCount === 'number' &&
    expandedMatchCount >= t.strongExpandedMin &&
    typeof directMatchCount === 'number' &&
    directMatchCount >= t.strongDirectMin
  ) {
    return 'strong';
  }
  if (directMatchCount === 0 && typeof expandedMatchCount === 'number' && expandedMatchCount >= t.expandedOnlyMin) {
    return 'expanded_only';
  }
  if (expandedMatchCount === 0 && typeof directMatchCount === 'number' && directMatchCount >= t.directOnlyMin) {
    return 'direct_only';
  }
  // 0 unique listings is empty, not a "small market we found." thin requires at least one card-worthy hit.
  if (
    typeof totalUniqueCount === 'number' &&
    totalUniqueCount >= 1 &&
    totalUniqueCount <= t.thinTotalMax
  ) {
    return 'thin';
  }
  return 'direct_only';
}

function explanationFor(
  state: RevealState,
  reveal: Pick<BeginnerMarketReveal, 'directMatchCount' | 'expandedMatchCount' | 'totalUniqueCount'>,
  stageSummary?: string,
): string {
  const direct = reveal.directMatchCount;
  const expanded = reveal.expandedMatchCount;
  const total = reveal.totalUniqueCount;
  // ⚠️ `stageSummary` is the mix of the DIRECT group only. Appending it to a
  // sentence whose number is the A+B total reads as "7 — 2 open to bid and 2
  // coming soon", which does not add up. Only the branches that quote the
  // direct count may carry it.
  const mix = stageSummary ? ` — ${stageSummary}.` : '.';
  switch (state) {
    case 'strong':
      return total == null
        ? `You'd have found ${direct}. Mindy found ${expanded} more that those words missed. Government buyers describe this work in ways most people would never search.`
        : `You'd have found ${direct}. Mindy found ${total}. Government buyers describe this work in ways most people would never search.`;
    case 'expanded_only':
      return `Your words didn't match open solicitations directly — but Mindy translated what you do and found ${expanded} in related government buying categories.`;
    case 'direct_only':
      return `Government buys this. Mindy found ${direct} current ${direct === 1 ? 'opportunity' : 'opportunities'} matching what you described${mix}`;
    case 'thin':
      return `Government buys this — the open market is small right now. Mindy found ${
        countPhrase(direct, 'current opportunity', 'current opportunities') || 'what is below'
      }${mix}`;
    case 'unavailable':
      return "Mindy couldn't measure the broader market right now.";
  }
}

/**
 * ⚠️ This printed "13 current opportunitys" on prod (naive `${noun}s`).
 * Captured 2026-09-21 in the same response as the three false positives.
 */
function countPhrase(n: number | null, singular: string, plural: string): string {
  if (n == null) return '';
  return n === 1 ? `1 ${singular}` : `${n} ${plural}`;
}

export function countStages(items: readonly SamSearchItem[]): StageCounts {
  const counts = emptyStageCounts();
  for (const item of items) {
    counts[noticeStage(item.type, item.title)] += 1;
    counts.total += 1;
  }
  return counts;
}

export function buildHiddenMarketReveal(args: {
  structured: boolean;
  directStatus: PopulationStatus;
  expandedStatus: PopulationStatus;
  directItems: readonly SamSearchItem[];
  expandedItems: readonly SamSearchItem[];
  translatedTerms: string[];
  expandedKeyword?: string | null;
  awardedFallback?: boolean;
}): BeginnerMarketReveal {
  const { directStatus, expandedStatus, directItems, expandedItems, translatedTerms, structured } = args;
  const awardedFallback = Boolean(args.awardedFallback);
  const expandedForCount = args.expandedKeyword && !awardedFallback
    ? expandedItems.filter((item) => titleMatchesExpanded(item, args.expandedKeyword as string))
    : expandedItems;

  const directOk = directStatus === 'ok';
  const expandedOk = expandedStatus === 'ok';
  const expandedSkipped = expandedStatus === 'skipped';

  const directMatchCount = directOk ? directItems.length : directStatus === 'unavailable' ? null : 0;
  const expandedEstablished = expandedOk || expandedSkipped;
  // Net-new is only defined when both populations were measured. Counting all of
  // B while A failed would report overlaps as "opportunities you'd have missed."
  const canNetNew = expandedOk && directOk;
  const netNew = canNetNew ? netNewItems(directItems, expandedForCount) : [];
  const expandedMatchCount = expandedSkipped
    ? 0
    : expandedStatus === 'unavailable' || !directOk
      ? null
      : netNew.length;

  const aKeyed = keyedItems(directOk ? directItems : []);
  const bKeyed = keyedItems(expandedOk ? expandedForCount : []);
  const dedupeComplete =
    directOk &&
    expandedEstablished &&
    aKeyed.unkeyed === 0 &&
    (expandedSkipped || bKeyed.unkeyed === 0);

  let totalUniqueCount: number | null = null;
  if (dedupeComplete) {
    const union = new Set<string>([...aKeyed.keyed.map((x) => x.key), ...bKeyed.keyed.map((x) => x.key)]);
    totalUniqueCount = union.size;
  }

  const agencies = [...directItems, ...expandedForCount]
    .map((i) => (i.agency || '').trim())
    .filter(Boolean);
  const agencyNames = [...new Set(agencies)];

  const limitations: string[] = [];
  if (directStatus === 'unavailable' || expandedStatus === 'unavailable') {
    limitations.push("Mindy couldn't measure the broader market right now.");
  }
  if (totalUniqueCount == null && expandedOk && directOk) {
    limitations.push('Some listings could not be compared, so Mindy is not showing a combined total.');
  }
  if (awardedFallback) {
    limitations.push(
      'These are awarded task orders from our USASpending warehouse and SAM award notices, not currently open to bid.',
    );
  } else {
    limitations.push('Counts are current open listings from this search, not a complete market census.');
    limitations.push(
      'A listing is shown only when its TITLE names your work. Some listings mention it only in the details, and this search cannot confirm that.',
    );
  }

  const revealState = decideRevealState({
    directStatus,
    expandedStatus,
    directMatchCount,
    expandedMatchCount,
    totalUniqueCount,
  });

  const stages = countStages(directOk ? directItems : []);
  const stageSummary = stages.total > 0 ? describeStageMix(stages) : undefined;

  const base: BeginnerMarketReveal = {
    directMatchCount,
    expandedMatchCount,
    totalUniqueCount,
    stages,
    stageSummary,
    directLabel: DIRECT_GROUP_LABEL,
    expandedLabel: awardedFallback ? AWARDED_GROUP_LABEL : UNCOVERED_GROUP_LABEL,
    translatedTerms: awardedFallback ? undefined : translatedTerms.length ? translatedTerms : undefined,
    revealState,
    explanation: '',
    limitations,
  };
  if (agencyNames.length >= 2) {
    base.agencies = { count: agencyNames.length, names: agencyNames.slice(0, 8) };
  }
  if (awardedFallback && revealState === 'expanded_only') {
    base.explanation = AWARDED_ONLY_EXPLANATION;
  } else if (!structured && (revealState === 'direct_only' || revealState === 'thin')) {
    base.explanation =
      revealState === 'thin'
        ? `Mindy found ${
            countPhrase(directMatchCount, 'current opportunity', 'current opportunities') ||
            'what is below'
          } from what you described${stageSummary ? ` — ${stageSummary}.` : '.'} Try describing your business a little more specifically if this is not it.`
        : `Mindy found ${
            countPhrase(directMatchCount, 'current opportunity', 'current opportunities') || 'matches'
          } from what you described${stageSummary ? ` — ${stageSummary}.` : '.'}`;
  } else {
    base.explanation = explanationFor(revealState, base, stageSummary);
  }
  if (revealState === 'unavailable') {
    base.expandedMatchCount = expandedMatchCount == null ? null : expandedMatchCount;
    // Never render a "0 hidden" claim on outage.
    if (directStatus === 'unavailable' && expandedStatus !== 'ok') {
      base.directMatchCount = null;
      base.expandedMatchCount = null;
      base.totalUniqueCount = null;
    }
  }
  return base;
}

async function runSearch(
  searchSam: NonNullable<HiddenMarketDeps['searchSam']>,
  keyword: string,
  limit: number,
): Promise<{ status: PopulationStatus; items: SamSearchItem[] }> {
  let result: SamSearchResult;
  try {
    result = await searchSam({ keyword, limit });
  } catch {
    return { status: 'unavailable', items: [] };
  }
  const items = asItems(result);
  if (items === null) return { status: 'unavailable', items: [] };
  return { status: 'ok', items };
}

export async function searchBeginnerHiddenMarket(
  input: ResolveBusinessInput & { limit?: number; nowMs?: number; eligibility?: EligibilityEvidence },
  deps: HiddenMarketDeps = {},
): Promise<HiddenMarketResult> {
  const resolution = await resolveBusiness(input, {
    ...deps,
    getCoverage: deps.getCoverage ?? skipUsaSpendingCoverage,
  });
  const userText = [input.description, input.followUp].filter(Boolean).join('\n');
  const derivedKeywords = resolution.keywords.status === 'known' ? resolution.keywords.items : [];
  const activity = extractBusinessActivity(userText, derivedKeywords);
  const emptyPop = { status: 'skipped' as const, items: [] as SamSearchItem[] };

  const emptyReveal = (state: RevealState, extra: Partial<BeginnerMarketReveal> = {}): BeginnerMarketReveal => ({
    directMatchCount: null,
    expandedMatchCount: null,
    totalUniqueCount: null,
    directLabel: DIRECT_GROUP_LABEL,
    expandedLabel: UNCOVERED_GROUP_LABEL,
    revealState: state,
    explanation:
      state === 'unavailable'
        ? "Mindy couldn't measure the broader market right now."
        : FOLLOW_UP_PROMPT,
    ...extra,
  });

  if (resolution.state === 'unavailable') {
    return {
      resolution,
      directKeyword: null,
      expandedKeyword: null,
      direct: { status: 'unavailable', items: [] },
      expanded: emptyPop,
      netNewItems: [],
      related: [],
      activity,
      reveal: emptyReveal('unavailable'),
    };
  }

  if (resolution.state === 'need_followup') {
    return {
      resolution,
      directKeyword: null,
      expandedKeyword: null,
      direct: emptyPop,
      expanded: emptyPop,
      netNewItems: [],
      related: [],
      activity,
      reveal: emptyReveal('unavailable', { explanation: resolution.followUpPrompt || FOLLOW_UP_PROMPT, revealState: 'unavailable' }),
    };
  }

  /**
   * No activity survived — every content word was company/meta context
   * ("I help businesses"). Searching one of those words is exactly how the
   * screenshot happened, so ask instead. A clarifying question is an honest
   * answer; a confident list of unrelated contracts is not.
   */
  const directKeyword = activity.head;
  if (!directKeyword) {
    return {
      resolution,
      directKeyword: null,
      expandedKeyword: null,
      direct: emptyPop,
      expanded: emptyPop,
      netNewItems: [],
      related: [],
      activity,
      needsClarification: true,
      reveal: emptyReveal('unavailable', { explanation: FOLLOW_UP_PROMPT }),
    };
  }

  const coverage = coveragePayload(resolution);
  const translatedTerms = coverageTranslatedTerms(userText, coverage);
  let expandedKeyword = pickExpandedKeyword(
    userText,
    resolution.coverageKeyword,
    translatedTerms,
    directKeyword,
  );
  // Cache-only /try (no USASpending): search the next user/repair/gerund phrase
  // in sam_opportunities. Do NOT invent extras when coverage already decided
  // there is no hidden language ("I do lawn care" → coverage keyword is lawn care).
  if (!expandedKeyword && !resolution.coverageKeyword) {
    // A SECOND real activity term beats a gerund: a business that says
    // "commercial cleaning and small construction" has two markets, and
    // "cleaning" alone shows only one of them.
    expandedKeyword =
      activity.terms.find((t) => t.toLowerCase() !== directKeyword.toLowerCase()) ?? null;
  }
  // ⚠️ REMOVED 2026-09-21: a `beginnerCoverageCandidates` fallback here
  // invented gerunds from whatever word was left over — measured live, "I own
  // a landscaping business" searched "own", "we do IT support for small
  // offices" searched "smalling" and "staffing agency" searched "agencying".
  // "own" returned courier services and cargo tie-downs under "Opportunities
  // Mindy uncovered". A second ACTIVITY term (above) is the only honest
  // expansion; when there isn't one, there is no hidden market to show.

  const searchSam = deps.searchSam ?? defaultSearchSam;
  const limit = input.limit ?? HIDDEN_MARKET_SEARCH_LIMIT;

  const directPromise = runSearch(searchSam, directKeyword, limit);
  const expandedPromise = expandedKeyword
    ? runSearch(searchSam, expandedKeyword, limit)
    : Promise.resolve({ status: 'skipped' as const, items: [] as SamSearchItem[] });

  const [direct, expandedOpen] = await Promise.all([directPromise, expandedPromise]);

  const relevance: RelevanceContext = {
    activity,
    codes: resolution.naicsCodes.status === 'known' ? resolution.naicsCodes.items : [],
    broaderTerms: expandedKeyword ? [expandedKeyword] : [],
  };
  const related: SamSearchItem[] = [];
  const classify = (items: readonly SamSearchItem[]): SamSearchItem[] => {
    const out = classifyOpportunities(items, relevance);
    related.push(...out.broader);
    return out.direct;
  };

  /**
   * Count distinct NOTICES, not rows. Two things inflate a row count:
   *  - the same notice reached by two searches (opportunityKey handles it)
   *  - the cache holding the same notice twice under different notice_ids —
   *    "Shank 2.0" was three of the original thirteen, and "Remediation and
   *    Specialty Cleaning Services" / "USDA-ARS Tifton Roofing Remodel" are
   *    each two rows in the live cache today.
   * The second needs a content key. Collapsing two genuinely different
   * notices that share a title, deadline AND agency would undercount by one;
   * inflating a headline claim is the worse error.
   */
  const contentKey = (item: SamSearchItem): string =>
    [
      (item.title || '').toLowerCase().replace(/\s+/g, ' ').trim(),
      item.deadline || '',
      (item.agency || '').toLowerCase().trim(),
    ].join('|');

  const dedupe = (items: readonly SamSearchItem[]): SamSearchItem[] => {
    const seen = new Set<string>();
    const out: SamSearchItem[] = [];
    for (const item of items) {
      const key = opportunityKey(item);
      if (key && seen.has(key)) continue;
      const ck = contentKey(item);
      if (seen.has(ck)) continue;
      if (key) seen.add(key);
      seen.add(ck);
      out.push(item);
    }
    return out;
  };

  const directItems =
    direct.status === 'ok' ? dedupe(classify(direct.items)) : direct.items;
  const expandedTitleFiltered =
    expandedOpen.status === 'ok' && expandedKeyword
      ? expandedOpen.items.filter((item) => titleMatchesExpanded(item, expandedKeyword))
      : expandedOpen.items;
  let expanded: { status: PopulationStatus; items: SamSearchItem[] } = expandedOpen;
  // ⚠️ The expanded population is BY CONSTRUCTION the words the user did NOT
  // use — that is the whole "hidden market" idea. Judging it against the
  // user's own activity terms would reject all of it. It has its own title
  // gate (`titleMatchesExpanded`, the distinctive token of the buying phrase)
  // and its own clearly-different heading, so it is never claimed as
  // "matches what you described".
  let expandedItems =
    expanded.status === 'ok' ? dedupe(expandedTitleFiltered) : expandedTitleFiltered;
  let awardedFallback = false;

  const openHitCount =
    (direct.status === 'ok' ? directItems.length : 0) +
    (expanded.status === 'ok' ? expandedItems.length : 0);
  if (
    direct.status === 'ok' &&
    (expanded.status === 'ok' || expanded.status === 'skipped') &&
    openHitCount === 0
  ) {
    const [awarded, taskOrders] = await Promise.all([
      runSearch(resolveAwardedSearch(deps), directKeyword, limit),
      runSearch(resolveTaskOrderSearch(deps), directKeyword, limit),
    ]);
    const samItems = awarded.status === 'ok' ? classify(awarded.items) : [];
    const bqItems = taskOrders.status === 'ok' ? classify(taskOrders.items) : [];
    // Awarded/task-order rows ARE searched on the user's own keyword, so they
    // go through the activity gate like the direct population.
    const merged = mergeAwardedItems(bqItems, samItems);
    if (merged.length > 0) {
      expanded = { status: 'ok', items: merged };
      expandedItems = merged;
      awardedFallback = true;
    }
  }

  const reveal = buildHiddenMarketReveal({
    structured: resolution.state === 'structured',
    directStatus: direct.status,
    expandedStatus: expanded.status,
    directItems,
    expandedItems,
    translatedTerms: awardedFallback ? [] : translatedTerms,
    expandedKeyword: awardedFallback ? null : expandedKeyword,
    awardedFallback,
  });

  const directKeys = new Set(directItems.map(opportunityKey).filter(Boolean) as string[]);
  const expandedKeys = new Set(expandedItems.map(opportunityKey).filter(Boolean) as string[]);
  const relatedOnly = dedupe(
    related.filter((item) => {
      const key = opportunityKey(item);
      return !key || (!directKeys.has(key) && !expandedKeys.has(key));
    }),
  );

  return {
    resolution,
    directKeyword,
    expandedKeyword: awardedFallback ? null : expandedKeyword,
    direct: { ...direct, items: directItems },
    expanded: { ...expanded, items: expandedItems },
    netNewItems:
      expanded.status === 'ok' && direct.status === 'ok' ? netNewItems(directItems, expandedItems) : [],
    related: relatedOnly,
    activity,
    reveal,
    awardedFallback,
  };
}

export function toHiddenMarketLandingView(
  result: HiddenMarketResult,
  opts: { nowMs?: number; eligibility?: EligibilityEvidence; ctaVariant?: CtaVariant } = {},
): HiddenMarketLandingView {
  const { resolution, reveal, direct, netNewItems: uncovered } = result;
  const relatedItems = result.related ?? [];
  const nowMs = opts.nowMs;
  const eligibility = opts.eligibility ?? { established: false };

  if (resolution.state === 'need_followup' || result.needsClarification) {
    return {
      outcome: 'need_followup',
      classification: resolution.state,
      followUpPrompt: resolution.followUpPrompt || FOLLOW_UP_PROMPT,
      message: resolution.followUpPrompt || FOLLOW_UP_PROMPT,
      reveal: null,
      directCards: [],
      uncoveredCards: [],
      relatedCards: [],
      relatedLabel: RELATED_GROUP_LABEL,
      ctaVariant: 'more',
      classificationPath: resolution.state,
    };
  }

  if (reveal.revealState === 'unavailable' && direct.status !== 'ok' && result.expanded.status !== 'ok') {
    return {
      outcome: 'unavailable',
      classification: resolution.state,
      followUpPrompt: null,
      message: resolution.state === 'unavailable' ? CLASSIFY_UNAVAILABLE_MESSAGE : UNAVAILABLE_MESSAGE,
      reveal,
      directCards: [],
      uncoveredCards: [],
      relatedCards: [],
      relatedLabel: RELATED_GROUP_LABEL,
      ctaVariant: 'more',
      classificationPath: resolution.state,
    };
  }

  const showUncovered = reveal.revealState === 'strong' || reveal.revealState === 'expanded_only';
  const n = REVEAL_THRESHOLDS.cardsPerGroup;
  // A beginner should meet the biddable work first: the screenshot led with
  // an RFI. Ordering is presentation only — it never changes a count.
  const STAGE_ORDER: Record<string, number> = {
    open_bid: 0,
    market_research: 1,
    upcoming: 2,
    informational: 3,
    awarded: 4,
    unknown: 5,
  };
  const byStage = (items: readonly SamSearchItem[]): SamSearchItem[] =>
    [...items].sort(
      (a, b) =>
        (STAGE_ORDER[noticeStage(a.type, a.title)] ?? 9) -
        (STAGE_ORDER[noticeStage(b.type, b.title)] ?? 9),
    );

  const directCards = translateOpportunities(byStage(direct.items).slice(0, n), {
    nowMs,
    eligibility,
    searchContext: null,
  })
    .filter((c) => c.grounded)
    .map(toPublicBeginnerCard);

  const uncoveredCards = showUncovered
    ? translateOpportunities(byStage(uncovered).slice(0, n), {
        nowMs,
        eligibility,
        searchContext: null,
      })
        .filter((c) => c.grounded)
        .map(toPublicBeginnerCard)
    : [];

  const relatedCards = translateOpportunities(byStage(relatedItems).slice(0, n), {
    nowMs,
    eligibility,
    searchContext: null,
  })
    .filter((c) => c.grounded)
    .map(toPublicBeginnerCard);

  // A page with ONLY related cards is still a result — an honest, clearly
  // labelled adjacent one. It is not "we found nothing".
  const hasAny = directCards.length + uncoveredCards.length + relatedCards.length > 0;
  let outcome: HiddenMarketLandingView['outcome'] = 'results';
  let message: string | null = null;
  if (!hasAny) {
    if (direct.status === 'unavailable' && result.expanded.status !== 'ok') {
      outcome = 'unavailable';
      message = UNAVAILABLE_MESSAGE;
    } else {
      outcome = 'empty';
      message =
        resolution.state === 'structured' ? EMPTY_OPEN_MARKET_MESSAGE : EMPTY_MATCH_MESSAGE;
    }
  }

  const ctaVariant: CtaVariant =
    opts.ctaVariant ?? (result.awardedFallback ? 'full_market' : 'more');
  // Cards are the user-visible population. Do not keep "here is what we found"
  // (or "Mindy found 0") on an empty outcome — that is the screenshot contradiction.
  const viewReveal =
    outcome === 'empty' ? { ...reveal, explanation: message as string } : reveal;

  return {
    outcome,
    classification: resolution.state,
    followUpPrompt: null,
    message,
    reveal: viewReveal,
    directCards,
    uncoveredCards,
    relatedCards,
    relatedLabel: RELATED_GROUP_LABEL,
    ctaVariant,
    classificationPath: resolution.state,
  };
}

export { opportunityKey };
