/**
 * Hidden-market reveal — two populations from the same SAM tool.
 *
 * Direct  = search_sam_opportunities on the user's literal words.
 * Expanded = search_sam_opportunities on coverage-derived buying language
 *            the user did NOT type (NAICS/PSC *names*, coverage keyword).
 *
 * We do NOT pass coverageCodes as `naics`: that tool's naics filter is a
 * single exact AND and would starve the very market this page is trying
 * to reveal (Fix #1). The hidden set is government *language*, not a
 * NAICS-filtered subset of the user's own hits.
 *
 * Dollar totals from get_keyword_coverage are never shown.
 */

import { keywordCandidates } from '@/lib/market/keyword-sanitize';
import { isGenericPsc } from '@/lib/market/keyword-coverage';
import type { KeywordCoverage } from '@/lib/market/keyword-coverage';
import type { KeywordCoverageToolResult } from '@/mcp/tools/keyword-coverage';
import { resolveBusiness, type ResolveBusinessDeps, type ResolveBusinessInput } from './resolve-business';
import { translateOpportunities } from './translate-opportunity';
import { keyedItems, opportunityKey } from './opportunity-key';
import { toPublicBeginnerCard, type PublicBeginnerCard } from './landing';
import {
  CLASSIFY_UNAVAILABLE_MESSAGE,
  EMPTY_MATCH_MESSAGE,
  FOLLOW_UP_PROMPT,
  UNAVAILABLE_MESSAGE,
  type EligibilityEvidence,
  type ResolutionState,
  type ResolvedBusiness,
  type SamSearchItem,
  type SamSearchResult,
} from './types';

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

export type RevealState = 'strong' | 'direct_only' | 'expanded_only' | 'thin' | 'unavailable';
export type CtaVariant = 'more' | 'full_market';

export type PopulationStatus = 'ok' | 'unavailable' | 'skipped';

export interface BeginnerMarketReveal {
  directMatchCount: number | null;
  expandedMatchCount: number | null;
  totalUniqueCount: number | null;
  directLabel: string;
  expandedLabel: string;
  agencies?: { count: number; names?: string[] };
  translatedTerms?: string[];
  revealState: RevealState;
  explanation: string;
  limitations?: string[];
}

export interface HiddenMarketResult {
  resolution: ResolvedBusiness;
  directKeyword: string | null;
  expandedKeyword: string | null;
  direct: { status: PopulationStatus; items: SamSearchItem[] };
  expanded: { status: PopulationStatus; items: SamSearchItem[] };
  netNewItems: SamSearchItem[];
  reveal: BeginnerMarketReveal;
}

export interface HiddenMarketLandingView {
  outcome: 'need_followup' | 'unavailable' | 'empty' | 'results';
  classification: ResolutionState;
  followUpPrompt: string | null;
  message: string | null;
  reveal: BeginnerMarketReveal | null;
  directCards: PublicBeginnerCard[];
  uncoveredCards: PublicBeginnerCard[];
  ctaVariant: CtaVariant;
  classificationPath: ResolutionState;
}

export interface HiddenMarketDeps extends Partial<ResolveBusinessDeps> {
  searchSam?: (args: { keyword: string; limit?: number }) => Promise<SamSearchResult>;
}

async function defaultSearchSam(args: { keyword: string; limit?: number }): Promise<SamSearchResult> {
  const { getWriteClient } = await import('@/lib/supabase/server-clients');
  const { makeTier1Tools } = await import('@/lib/chat/tier1-tools');
  const tools = makeTier1Tools(getWriteClient() as never);
  const result = await tools.execute('search_sam_opportunities', args);
  return result as SamSearchResult;
}

function asItems(result: SamSearchResult): SamSearchItem[] | null {
  if (!result.ok) return null;
  if (!('items' in result) || !Array.isArray(result.items)) return null;
  return result.items;
}

/** User's own words, not coverage/gerund expansions. */
export function beginnerDirectKeyword(text: string): string | null {
  const combined = (text || '').trim();
  if (!combined) return null;
  const stripped = combined.replace(/^(i|we|my|our)\s+/i, '').trim();
  const candidates = keywordCandidates(stripped).filter((k) => !/^(i|we|my|our)\b/i.test(k.trim()));
  const pick = (candidates[0] || stripped).trim();
  return pick.length >= 3 ? pick : null;
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
  if (totalUniqueCount != null && totalUniqueCount <= t.thinTotalMax) return 'thin';
  return 'direct_only';
}

function explanationFor(state: RevealState, reveal: Pick<BeginnerMarketReveal, 'directMatchCount' | 'expandedMatchCount' | 'totalUniqueCount'>): string {
  const direct = reveal.directMatchCount;
  const expanded = reveal.expandedMatchCount;
  const total = reveal.totalUniqueCount;
  switch (state) {
    case 'strong':
      return total == null
        ? `You'd have found ${direct}. Mindy found ${expanded} more that those words missed. Government buyers describe this work in ways most people would never search.`
        : `You'd have found ${direct}. Mindy found ${total}. Government buyers describe this work in ways most people would never search.`;
    case 'expanded_only':
      return `Your words didn't match open solicitations directly — but Mindy translated what you do and found ${expanded} in related government buying categories.`;
    case 'direct_only':
      return `Government buys this. Mindy found ${direct} current ${direct === 1 ? 'opportunity' : 'opportunities'} matching what you described.`;
    case 'thin':
      return 'Government buys this — the open market is small right now. Here is what we found.';
    case 'unavailable':
      return "Mindy couldn't measure the broader market right now.";
  }
}

function countPhrase(n: number | null, noun: string): string {
  if (n == null) return '';
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

export function buildHiddenMarketReveal(args: {
  structured: boolean;
  directStatus: PopulationStatus;
  expandedStatus: PopulationStatus;
  directItems: readonly SamSearchItem[];
  expandedItems: readonly SamSearchItem[];
  translatedTerms: string[];
  expandedKeyword?: string | null;
}): BeginnerMarketReveal {
  const { directStatus, expandedStatus, directItems, expandedItems, translatedTerms, structured } = args;
  const expandedForCount = args.expandedKeyword
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
  limitations.push('Counts are current open listings from this search, not a complete market census.');

  const revealState = decideRevealState({
    directStatus,
    expandedStatus,
    directMatchCount,
    expandedMatchCount,
    totalUniqueCount,
  });

  const base: BeginnerMarketReveal = {
    directMatchCount,
    expandedMatchCount,
    totalUniqueCount,
    directLabel: DIRECT_GROUP_LABEL,
    expandedLabel: UNCOVERED_GROUP_LABEL,
    translatedTerms: translatedTerms.length ? translatedTerms : undefined,
    revealState,
    explanation: '',
    limitations,
  };
  if (agencyNames.length >= 2) {
    base.agencies = { count: agencyNames.length, names: agencyNames.slice(0, 8) };
  }
  if (!structured && (revealState === 'direct_only' || revealState === 'thin')) {
    base.explanation =
      revealState === 'thin'
        ? 'Here is what we found. Try describing your business a little more specifically if this is not it.'
        : `Mindy found ${countPhrase(directMatchCount, 'current opportunity') || 'matches'} from what you described.`;
  } else {
    base.explanation = explanationFor(revealState, base);
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
  const resolution = await resolveBusiness(input, deps);
  const userText = [input.description, input.followUp].filter(Boolean).join('\n');
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
      reveal: emptyReveal('unavailable', { explanation: resolution.followUpPrompt || FOLLOW_UP_PROMPT, revealState: 'unavailable' }),
    };
  }

  const directKeyword = beginnerDirectKeyword(userText);
  if (!directKeyword) {
    return {
      resolution,
      directKeyword: null,
      expandedKeyword: null,
      direct: emptyPop,
      expanded: emptyPop,
      netNewItems: [],
      reveal: emptyReveal('unavailable', { explanation: FOLLOW_UP_PROMPT }),
    };
  }

  const coverage = coveragePayload(resolution);
  const translatedTerms = coverageTranslatedTerms(userText, coverage);
  const expandedKeyword = pickExpandedKeyword(
    userText,
    resolution.coverageKeyword,
    translatedTerms,
    directKeyword,
  );

  const searchSam = deps.searchSam ?? defaultSearchSam;
  const limit = input.limit ?? HIDDEN_MARKET_SEARCH_LIMIT;

  const directPromise = runSearch(searchSam, directKeyword, limit);
  const expandedPromise = expandedKeyword
    ? runSearch(searchSam, expandedKeyword, limit)
    : Promise.resolve({ status: 'skipped' as const, items: [] as SamSearchItem[] });

  const [direct, expanded] = await Promise.all([directPromise, expandedPromise]);

  const expandedItems =
    expanded.status === 'ok' && expandedKeyword
      ? expanded.items.filter((item) => titleMatchesExpanded(item, expandedKeyword))
      : expanded.items;

  const reveal = buildHiddenMarketReveal({
    structured: resolution.state === 'structured',
    directStatus: direct.status,
    expandedStatus: expanded.status,
    directItems: direct.items,
    expandedItems,
    translatedTerms,
    expandedKeyword,
  });

  return {
    resolution,
    directKeyword,
    expandedKeyword,
    direct,
    expanded: { ...expanded, items: expandedItems },
    netNewItems:
      expanded.status === 'ok' && direct.status === 'ok' ? netNewItems(direct.items, expandedItems) : [],
    reveal,
  };
}

export function toHiddenMarketLandingView(
  result: HiddenMarketResult,
  opts: { nowMs?: number; eligibility?: EligibilityEvidence; ctaVariant?: CtaVariant } = {},
): HiddenMarketLandingView {
  const { resolution, reveal, direct, netNewItems: uncovered } = result;
  const nowMs = opts.nowMs;
  const eligibility = opts.eligibility ?? { established: false };

  if (resolution.state === 'need_followup') {
    return {
      outcome: 'need_followup',
      classification: resolution.state,
      followUpPrompt: resolution.followUpPrompt || FOLLOW_UP_PROMPT,
      message: resolution.followUpPrompt || FOLLOW_UP_PROMPT,
      reveal: null,
      directCards: [],
      uncoveredCards: [],
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
      ctaVariant: 'more',
      classificationPath: resolution.state,
    };
  }

  const showUncovered = reveal.revealState === 'strong' || reveal.revealState === 'expanded_only';
  const n = REVEAL_THRESHOLDS.cardsPerGroup;
  const directCards = translateOpportunities(direct.items.slice(0, n), {
    nowMs,
    eligibility,
    searchContext: null,
  })
    .filter((c) => c.grounded)
    .map(toPublicBeginnerCard);

  const uncoveredCards = showUncovered
    ? translateOpportunities(uncovered.slice(0, n), {
        nowMs,
        eligibility,
        searchContext: null,
      })
        .filter((c) => c.grounded)
        .map(toPublicBeginnerCard)
    : [];

  const hasAny = directCards.length + uncoveredCards.length > 0;
  let outcome: HiddenMarketLandingView['outcome'] = 'results';
  let message: string | null = null;
  if (!hasAny) {
    if (direct.status === 'unavailable' && result.expanded.status !== 'ok') {
      outcome = 'unavailable';
      message = UNAVAILABLE_MESSAGE;
    } else {
      outcome = 'empty';
      message = EMPTY_MATCH_MESSAGE;
    }
  }

  const ctaVariant: CtaVariant = opts.ctaVariant ?? 'more';

  return {
    outcome,
    classification: resolution.state,
    followUpPrompt: null,
    message,
    reveal,
    directCards,
    uncoveredCards,
    ctaVariant,
    classificationPath: resolution.state,
  };
}

export function ctaLabel(variant: CtaVariant, revealState: RevealState): string {
  if (revealState === 'strong' && variant === 'full_market') return 'See your full market with Mindy';
  return 'See more opportunities with Mindy';
}

export { opportunityKey };
