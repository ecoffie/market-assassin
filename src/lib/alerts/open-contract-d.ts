/**
 * Daily-alert Open SAM Contract D.
 *
 * Empty-keyword and empty-Open are different states. Distinctive hits
 * prefer inside a NAICS/PSC market. Generic singles rank only. Missing
 * distinctive hits still send the Open market and say so. They do not
 * jump to another corpus.
 */
import type { AlertMode } from '@/lib/alerts/alert-mode';
import { distinctiveKeywords, isDistinctiveKeyword, keywordOccursInText, sanitizeKeywords } from '@/lib/market/keyword-sanitize';
import { knownNaicsForMatch } from '@/lib/codes/validate-market-codes';
import { CURATED_EXACT_CODES } from '@/lib/utils/naics-expansion';

export const OPEN_MARKET_NO_KEYWORD_HITS_COPY =
  'No keyword hits in your market. Showing open opportunities in your NAICS/PSC codes.';

export const OPEN_MARKET_NO_KEYWORDS_COPY =
  'Open opportunities in your NAICS/PSC market. Keywords are not required filters in Market Discovery.';

export const OPEN_NOW_HEADING = 'Open Now';
export const OPEN_NOW_EXPLAIN =
  'Open notices in your market. Each one shows its stage — only items marked Bid take a proposal.';

/** Fallback-path copy (no "new" claim). Stage-honest: not every open notice is a solicitation. */
export const OPEN_STILL_OPEN_EXPLAIN =
  'These notices are still open in your market. Each one shows its stage — only items marked Bid take a proposal.';

export type OpenKeywordOutcome =
  | 'distinctive_hits'
  | 'open_market_no_keyword_hits'
  | 'no_keywords_configured'
  | 'empty_open_market'
  | 'focused_omit_open';

export function hasNaicsOrPscMarket(naicsCodes: string[] = [], pscCodes: string[] = []): boolean {
  return knownNaicsForMatch(naicsCodes).length > 0 || pscCodes.some(Boolean);
}

/** Distinctive terms may define the query only when no NAICS/PSC market exists. */
export function keywordIncludeTerms(keywords: string[], naicsCodes: string[] = [], pscCodes: string[] = []): string[] {
  if (hasNaicsOrPscMarket(naicsCodes, pscCodes)) return [];
  return distinctiveKeywords(keywords);
}

export function preferDistinctiveInOpenMarket<T>(
  market: T[],
  keywords: string[],
  textOf: (row: T) => string,
): { rows: T[]; distinctiveMatchCount: number; outcome: OpenKeywordOutcome } {
  if (market.length === 0) {
    return { rows: [], distinctiveMatchCount: 0, outcome: 'empty_open_market' };
  }

  const distinctive = distinctiveKeywords(keywords);
  if (distinctive.length === 0) {
    const searchable = sanitizeKeywords(keywords);
    return {
      rows: market,
      distinctiveMatchCount: 0,
      outcome: searchable.length > 0 ? 'open_market_no_keyword_hits' : 'no_keywords_configured',
    };
  }

  const hits = market.filter((row) => {
    const text = textOf(row);
    return distinctive.some((k) => keywordOccursInText(text, k));
  });

  if (hits.length === 0) {
    return { rows: market, distinctiveMatchCount: 0, outcome: 'open_market_no_keyword_hits' };
  }

  return { rows: hits, distinctiveMatchCount: hits.length, outcome: 'distinctive_hits' };
}

export function scoreContractDKeywords(text: string, keywords: string[]): number {
  let score = 0;
  for (const raw of keywords) {
    const k = (raw || '').trim();
    if (!k || !keywordOccursInText(text, k)) continue;
    score += isDistinctiveKeyword(k, keywords) ? 25 : 2;
  }
  return score;
}

/**
 * WHERE each saved keyword was found on a notice. Title evidence and body evidence
 * are kept apart because they are not the same claim: a title names the work being
 * bought; a description mentions everything from the SOW to the FAR boilerplate.
 */
export interface KeywordEvidence {
  /** Distinctive keywords found in the TITLE. */
  title: string[];
  /** Distinctive keywords found only in the DESCRIPTION. */
  body: string[];
  /** Generic single words (not distinctive) found anywhere — rank-only. */
  weak: string[];
}

/**
 * Evidence weights. Why capped: scoreContractDKeywords gave +25 per hit with no
 * ceiling, so a 40-keyword profile stacked description mentions ("compliance",
 * "program management" in a boilerplate list) past a notice whose TITLE named the
 * work, and the 0–100 clamp then tied them all at 100 (6 of 7 on a real customer's
 * Sep 24 2026 alert). Within KEYWORD points, one title hit (30) outweighs the most a
 * description can ever add (3 × 6 = 18), and no count of keywords can push body
 * mentions further.
 *
 * ⚠️ That is a guarantee about keyword points ONLY. The final rank also adds NAICS,
 * agency, deadline and set-aside points, which can and do reverse it: a description-only
 * notice in the user's exact NAICS at a target agency can outrank a title hit elsewhere.
 * Title evidence is a strong BOOST, not a strict tier (pinned in alert-relevance-case).
 */
export const KEYWORD_EVIDENCE_WEIGHTS = {
  titleEach: 30,
  titleMax: 2,
  bodyEach: 6,
  bodyMax: 3,
  weakEach: 2,
  weakMax: 3,
} as const;

export function keywordEvidence(
  title: string | null | undefined,
  body: string | null | undefined,
  keywords: string[],
): KeywordEvidence {
  const t = String(title || '');
  const b = String(body || '');
  const distinctive = distinctiveKeywords(keywords);
  const distinctiveSet = new Set(distinctive.map((k) => k.toLowerCase()));
  const inTitle = distinctive.filter((k) => keywordOccursInText(t, k));
  const inBody = distinctive.filter((k) => !inTitle.includes(k) && keywordOccursInText(b, k));
  const weak = sanitizeKeywords(keywords)
    .filter((k) => !distinctiveSet.has(k.toLowerCase()))
    .filter((k) => keywordOccursInText(`${t} ${b}`, k));
  return { title: inTitle, body: inBody, weak };
}

export function scoreKeywordEvidence(e: KeywordEvidence): number {
  const w = KEYWORD_EVIDENCE_WEIGHTS;
  return Math.min(e.title.length, w.titleMax) * w.titleEach
    + Math.min(e.body.length, w.bodyMax) * w.bodyEach
    + Math.min(e.weak.length, w.weakMax) * w.weakEach;
}

export function hasKeywordSupport(e: KeywordEvidence): boolean {
  return e.title.length + e.body.length > 0;
}

/**
 * Is this opportunity inside the user's SAVED industry, using the same
 * exact-vs-4-digit rule the SAM cache query uses (CURATED_EXACT_CODES stay
 * exact; other codes widen to their 4-digit industry group)?
 *
 * Auto-derived PSC ORs pull aircraft / wayfinding / construction rows into an
 * IT profile's Open set. A keyword hit cannot authorize an outside-market
 * row — inferred PSC recall stays inside the saved NAICS market.
 */
export function naicsInSavedMarket(oppNaics: string | null | undefined, savedNaics: string[]): boolean {
  const opp = String(oppNaics || '').replace(/\D/g, '');
  if (!opp) return false;
  const saved = knownNaicsForMatch(savedNaics);
  if (saved.length === 0) return false;
  for (const code of saved) {
    const digits = String(code).replace(/\D/g, '');
    if (!digits) continue;
    if (digits.length === 6 && CURATED_EXACT_CODES.has(digits)) {
      if (opp === digits) return true;
      continue;
    }
    const prefix = digits.length <= 4 ? digits : digits.slice(0, 4);
    if (opp === digits || opp.startsWith(prefix)) return true;
  }
  return false;
}

export function filterMarketToSavedIndustry<T>(
  rows: T[],
  savedNaics: string[],
  naicsOf: (row: T) => string | null | undefined,
): { rows: T[]; droppedOffIndustry: number } {
  if (knownNaicsForMatch(savedNaics).length === 0) {
    return { rows, droppedOffIndustry: 0 };
  }
  const kept = rows.filter((row) => naicsInSavedMarket(naicsOf(row), savedNaics));
  return { rows: kept, droppedOffIndustry: rows.length - kept.length };
}

export function applyOpenAlertMode<T>(
  preferred: { rows: T[]; distinctiveMatchCount: number; outcome: OpenKeywordOutcome },
  mode: AlertMode,
  keywords: string[] = [],
): { rows: T[]; distinctiveMatchCount: number; outcome: OpenKeywordOutcome; omitOpen: boolean } {
  const distinctive = distinctiveKeywords(keywords);
  if (mode === 'focused' && distinctive.length > 0 && preferred.distinctiveMatchCount === 0) {
    return {
      rows: [],
      distinctiveMatchCount: 0,
      outcome: 'focused_omit_open',
      omitOpen: true,
    };
  }
  return { ...preferred, omitOpen: false };
}

/**
 * How much of the NAICS/PSC market the keyword check actually examined. The fetcher
 * scans the whole market up to MAX_PREFER_SCAN_ROWS; past that bound, matches are
 * NOT checked. "No keyword hits" over a truncated scan is not a finding that none
 * exist, so the note must say coverage was incomplete instead.
 */
export interface KeywordScanCoverage {
  scanTruncated?: boolean;
  marketRowsScanned?: number;
}

export function keywordScanIncompleteCopy(outcome: OpenKeywordOutcome, scanned: number | undefined): string | null {
  const examined = typeof scanned === 'number' && scanned > 0
    ? `Your market is larger than Mindy checked today: it looked at the first ${scanned.toLocaleString('en-US')} open notices (soonest deadlines first)`
    : 'Your market is larger than Mindy checked today: it looked at only part of it (soonest deadlines first)';
  if (outcome === 'open_market_no_keyword_hits') {
    return `${examined} and found no keyword match among them. Matches may exist further out — this is not a finding that none exist. Showing open opportunities in your NAICS/PSC codes.`;
  }
  if (outcome === 'focused_omit_open') {
    return `${examined} and found no keyword match among them, so Focused mode shows no open notices today. Matches may exist further out — this is not a finding that none exist.`;
  }
  if (outcome === 'distinctive_hits') {
    return `${examined}. Keyword matches below come from those notices only; later matches were not checked today.`;
  }
  return null;
}

export function openMarketNote(outcome: OpenKeywordOutcome, coverage?: KeywordScanCoverage): string | null {
  if (coverage?.scanTruncated) {
    const incomplete = keywordScanIncompleteCopy(outcome, coverage.marketRowsScanned);
    if (incomplete) return incomplete;
  }
  if (outcome === 'open_market_no_keyword_hits') return OPEN_MARKET_NO_KEYWORD_HITS_COPY;
  if (outcome === 'no_keywords_configured') return OPEN_MARKET_NO_KEYWORDS_COPY;
  return null;
}
