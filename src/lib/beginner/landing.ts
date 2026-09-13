/**
 * Fix #2 presentation over the Fix #1 seam.
 *
 * Does not re-resolve, re-search, or size a market. It only:
 *   - picks grounded reveal lines from an already-run BeginnerSearchResult
 *   - strips codes / raw records so the public page cannot render them
 *
 * Dollar totals from get_keyword_coverage are 1 FY vs the canonical 3-FY
 * window — do not print them as "the federal market."
 */

import type {
  BeginnerOpportunityCard,
  BeginnerSearchResult,
  ResolutionState,
} from './types';

/** Cards shown on the aha page — not a full results UI. */
export const LANDING_CARD_LIMIT = 5;
/** Ask the seam for a few extra so the displayed 3–5 is a sample of a real hit set. */
export const LANDING_SEARCH_LIMIT = 8;

export interface PublicBeginnerCard {
  title: string;
  noticeLabel: string | null;
  audienceLabel: string | null;
  dueLabel: string;
  amountLabel: string | null;
  agencyLabel: string | null;
  plainMeaning: string | null;
  nextStep: string;
  referenceNumber: string | null;
  samUrl: string | null;
  grounded: boolean;
  searchContext: string | null;
}

export type LandingOutcomeKind = 'need_followup' | 'unavailable' | 'empty' | 'results';

export interface BeginnerLandingView {
  outcome: LandingOutcomeKind;
  classification: ResolutionState;
  followUpPrompt: string | null;
  message: string | null;
  reveal: string[];
  cards: PublicBeginnerCard[];
  foundCount: number | null;
}

function uniqueAgencies(result: BeginnerSearchResult): string[] {
  if (result.outcome.kind !== 'results') return [];
  const names = result.outcome.rawItems
    .map((item) => (item.agency || '').trim())
    .filter((name) => name.length > 0);
  return [...new Set(names)];
}

/**
 * Grounded-only reveal. Failed query ≠ zero. No invented dollars.
 * Opportunity count is the search hit count for this query (a floor), not a market census.
 */
export function buildMarketReveal(result: BeginnerSearchResult): string[] {
  const lines: string[] = [];

  if (result.resolution.state === 'structured') {
    lines.push('The federal government buys this kind of work.');
  }

  if (result.outcome.kind !== 'results') return lines;

  const n = result.outcome.count;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
    lines.push(
      n === 1
        ? 'We found 1 current opportunity related to what you do.'
        : `We found ${n} current opportunities related to what you do.`,
    );
  }

  const agencies = uniqueAgencies(result);
  if (agencies.length >= 2) {
    lines.push(`Your description matches opportunities across ${agencies.length} agencies.`);
  }

  return lines;
}

export function toPublicBeginnerCard(card: BeginnerOpportunityCard): PublicBeginnerCard {
  return {
    title: card.title,
    noticeLabel: card.noticeLabel,
    audienceLabel: card.audienceLabel,
    dueLabel: card.dueLabel,
    amountLabel: card.amountLabel,
    agencyLabel: card.agencyLabel,
    plainMeaning: card.plainMeaning,
    nextStep: card.nextStep,
    referenceNumber: card.referenceNumber,
    samUrl: card.samUrl,
    grounded: card.grounded,
    searchContext: card.searchContext,
  };
}

export function toBeginnerLandingView(result: BeginnerSearchResult): BeginnerLandingView {
  const outcome = result.outcome.kind;
  const cards =
    outcome === 'results'
      ? result.outcome.cards.filter((c) => c.grounded).slice(0, LANDING_CARD_LIMIT).map(toPublicBeginnerCard)
      : [];
  const foundCount = outcome === 'results' ? result.outcome.count : null;
  const message = outcome === 'results' ? null : result.outcome.message;

  return {
    outcome,
    classification: result.resolution.state,
    followUpPrompt: outcome === 'need_followup' ? result.outcome.message : result.resolution.followUpPrompt,
    message,
    reveal: buildMarketReveal(result),
    cards,
    foundCount,
  };
}
