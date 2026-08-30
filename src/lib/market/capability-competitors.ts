/**
 * Competitor list hygiene for capability_market_match — NAICS/spend overlap only.
 * Rejects rows that appear only because the company NAME contains the anchor token
 * (Anadria/"Outcomes", TPJ/"Customized" class).
 */
import type { RecipientSearchRow } from '@/lib/bigquery/recipients';
import { GENERIC_ABSTRACTIONS, BARE_CONJUNCTIONS } from '@/lib/market/capability-anchor';

const NEVER_NAME_MATCH_TOKENS = new Set([
  ...GENERIC_ABSTRACTIONS,
  ...BARE_CONJUNCTIONS,
  'outcomes',
  'customized',
  'custom',
  'affairs',
  'organizational',
  'solutions',
]);

/** Tokens from the anchor that must not drive a company-name relevance match. */
export function anchorTokensThatMustNotMatchNames(anchor: string): string[] {
  return anchor
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && NEVER_NAME_MATCH_TOKENS.has(t));
}

export function competitorNameMatchesForbiddenAnchorToken(
  recipientName: string,
  anchor: string,
): boolean {
  const tokens = anchorTokensThatMustNotMatchNames(anchor);
  return tokens.some((t) => nameContainsForbiddenToken(recipientName, t));
}

function nameContainsForbiddenToken(name: string, token: string): boolean {
  if (token.length < 4) return false;
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return re.test(name);
}

/** Drop competitors whose names contain generic anchor tokens — always, not only when anchor mentions them. */
export function filterCompetitorsFabricatedRelevance(
  contractors: RecipientSearchRow[],
  anchor: string,
): RecipientSearchRow[] {
  const forbidden = new Set([
    ...NEVER_NAME_MATCH_TOKENS,
    ...anchorTokensThatMustNotMatchNames(anchor),
  ]);
  if (!forbidden.size) return contractors;
  return contractors.filter((c) => {
    const name = c.recipient_name;
    return ![...forbidden].some((t) => nameContainsForbiddenToken(name, t));
  });
}

export type CompetitorDerivation =
  | 'naics_spend_overlap'
  | 'psc_recipient_overlap'
  | 'none_unverified_anchor'
  | 'none_no_naics'
  | 'none_insufficient_overlap';

export function describeCompetitorDerivation(opts: {
  usedPscPeers: boolean;
  leadNaics: string | null;
  anchorConfidence: string;
  rowCount: number;
}): CompetitorDerivation {
  if (opts.anchorConfidence === 'unverified' || opts.anchorConfidence === 'low') {
    return 'none_unverified_anchor';
  }
  if (!opts.leadNaics && !opts.usedPscPeers) return 'none_no_naics';
  if (opts.rowCount === 0) return 'none_insufficient_overlap';
  return opts.usedPscPeers ? 'psc_recipient_overlap' : 'naics_spend_overlap';
}
