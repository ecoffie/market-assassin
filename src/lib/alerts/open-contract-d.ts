/**
 * Daily-alert Open SAM Contract D.
 *
 * Empty-keyword and empty-Open are different states. Distinctive hits
 * prefer inside a NAICS/PSC market. Generic singles rank only. Missing
 * distinctive hits still send the Open market and say so. They do not
 * jump to another corpus.
 */
import type { AlertMode } from '@/lib/alerts/alert-mode';
import { distinctiveKeywords, isDistinctiveKeyword, sanitizeKeywords } from '@/lib/market/keyword-sanitize';

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
  return naicsCodes.some(Boolean) || pscCodes.some(Boolean);
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
    const text = textOf(row).toLowerCase();
    return distinctive.some((k) => text.includes(k.toLowerCase()));
  });

  if (hits.length === 0) {
    return { rows: market, distinctiveMatchCount: 0, outcome: 'open_market_no_keyword_hits' };
  }

  return { rows: hits, distinctiveMatchCount: hits.length, outcome: 'distinctive_hits' };
}

export function scoreContractDKeywords(text: string, keywords: string[]): number {
  const hay = text.toLowerCase();
  let score = 0;
  for (const raw of keywords) {
    const k = (raw || '').trim();
    if (!k || !hay.includes(k.toLowerCase())) continue;
    score += isDistinctiveKeyword(k) ? 25 : 2;
  }
  return score;
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
