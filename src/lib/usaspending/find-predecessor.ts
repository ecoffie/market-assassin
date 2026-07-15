/**
 * Find the likely PREDECESSOR (incumbent) award for an opportunity (#52).
 *
 * SAM solicitations don't link to the prior contract, so we infer it from the
 * best-matching recent USASpending award (title phrase + agency, relevance-scored).
 * We pull its full Contract Summary (#50) so Proposal Assist + bid/no-bid cite REAL
 * numbers — the incumbent, the ceiling, the period of performance, the parent vehicle.
 *
 * This is a thin ADAPTER over the shared matcher in solicitation-incumbent.ts
 * (`findLikelyPriorAwards`) — the single engine also behind the sol#-lookup flow.
 * Honest: a best-match inference, not a certified link. Caller labels it "likely."
 */
import { type AwardDetail } from './award-detail';
import { findLikelyPriorAwards } from './solicitation-incumbent';

/**
 * Returns the full detail of the likely-incumbent award for an opportunity, or
 * null when no good match exists. Best-match inference (title phrase + agency,
 * NAICS soft), not a certified link — the caller labels it "likely incumbent."
 *
 * CONSOLIDATED (Jul 15 2026): this used to carry its own weaker matcher (a
 * first-hit phrase ladder). It now delegates to the single shared scoring engine
 * in solicitation-incumbent.ts (`findLikelyPriorAwards`) — relevance-scored with
 * work-word discounting so a big same-NAICS facility TO can't outrank the true
 * specialty recompete. One engine, two entry points (this + the sol#-lookup flow).
 */
export async function findPredecessorAward(opts: {
  naicsCode?: string;
  agencyName?: string;
  keyword?: string;     // the opportunity title — sharpens the match when present
}): Promise<(AwardDetail & { matchConfidence: 'high' | 'medium' | 'low' }) | null> {
  const hits = await findLikelyPriorAwards({
    title: opts.keyword ?? null,
    naics_code: opts.naicsCode ?? null,
    agency: opts.agencyName ?? null,
    department: opts.agencyName ?? null,
  });
  return hits[0] ?? null;
}

/** A short, human-readable summary for prompts/UI ("displace X's $63M contract…"). */
export function summarizePredecessor(d: AwardDetail & { matchConfidence: string }): string {
  const fmt = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;
  const parts: string[] = [];
  if (d.recipientName) parts.push(`Likely incumbent: ${d.recipientName}${d.recipientState ? ` (${d.recipientState})` : ''}`);
  if (d.ceiling) parts.push(`contract ceiling ${fmt(d.ceiling)}${d.obligated && d.obligated < d.ceiling ? `, ${fmt(d.obligated)} obligated so far` : ''}`);
  if (d.popPotentialEnd) parts.push(`expires ${d.popPotentialEnd}`);
  if (d.parentIdvPiid || d.parentIdvId) parts.push(`under vehicle ${d.parentIdvPiid || d.parentIdvId} (must hold to compete)`);
  if (d.fundingAccount) parts.push(`funded from ${d.fundingAccount}`);
  return parts.join('; ') + ` [match: ${d.matchConfidence}]`;
}
