/**
 * Find the likely PREDECESSOR (incumbent) award for an opportunity (#52).
 *
 * SAM solicitations don't link to the prior contract, so we infer it: the
 * largest recent award matching the opportunity's NAICS + agency is almost
 * always the incumbent contract being recompeted. We then pull its full Contract
 * Summary (#50) so Proposal Assist + bid/no-bid cite REAL numbers — the
 * incumbent, the ceiling, the period of performance, the parent vehicle.
 *
 * Honest: this is a BEST-MATCH inference (NAICS + agency + recency), not a
 * certified link. The caller labels it "likely incumbent."
 */
import { fetchAwardDetail, type AwardDetail } from './award-detail';
import { fiscalYearTimePeriod } from '@/lib/utils/fiscal-year';

const SEARCH_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

/**
 * Returns the full detail of the likely-incumbent award for an opportunity, or
 * null when no good match exists.
 */
export async function findPredecessorAward(opts: {
  naicsCode?: string;
  agencyName?: string;
  keyword?: string;     // the opportunity title — sharpens the match when present
}): Promise<(AwardDetail & { matchConfidence: 'high' | 'medium' | 'low' }) | null> {
  const naics = (opts.naicsCode || '').replace(/[^\d]/g, '').slice(0, 6);
  if (!naics && !opts.keyword) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filters: any = {
    award_type_codes: ['A', 'B', 'C', 'D'],
    time_period: [fiscalYearTimePeriod()],
  };
  if (naics) filters.naics_codes = [naics];
  if (opts.agencyName) filters.agencies = [{ type: 'awarding', tier: 'toptier', name: opts.agencyName }];
  if (opts.keyword) filters.keywords = [opts.keyword.slice(0, 80)];

  try {
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters,
        fields: ['Award ID', 'Recipient Name', 'Award Amount', 'generated_internal_id'],
        limit: 1,
        sort: 'Award Amount',
        order: 'desc',
        subawards: false,
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const top = (j.results || [])[0];
    const id = top?.generated_internal_id;
    if (!id) return null;

    const detail = await fetchAwardDetail(id);
    if (!detail) return null;

    // Confidence: agency + keyword match = high; NAICS + agency = medium; NAICS only = low.
    const matchConfidence: 'high' | 'medium' | 'low' =
      opts.keyword && opts.agencyName ? 'high' : opts.agencyName ? 'medium' : 'low';
    return { ...detail, matchConfidence };
  } catch {
    return null;
  }
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
