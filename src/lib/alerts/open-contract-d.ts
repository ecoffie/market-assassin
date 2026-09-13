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

export function openMarketNote(outcome: OpenKeywordOutcome): string | null {
  if (outcome === 'open_market_no_keyword_hits') return OPEN_MARKET_NO_KEYWORD_HITS_COPY;
  if (outcome === 'no_keywords_configured') return OPEN_MARKET_NO_KEYWORDS_COPY;
  return null;
}
