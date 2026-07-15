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
import { latestCompleteFiscalYear } from '@/lib/utils/fiscal-year';

const SEARCH_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

// Generic contract words that don't distinguish one requirement from another —
// dropped when building the keyword phrase so the match keys on the real subject.
const GENERIC_TOKENS = new Set([
  'SERVICES', 'SERVICE', 'SUPPORT', 'SUPPLIES', 'SUPPLY', 'BASE', 'OPTION', 'OPTIONS',
  'YEAR', 'YEARS', 'PROGRAM', 'PROJECT', 'CONTRACT', 'CONTRACTS', 'NEW', 'ALL', 'AND',
  'FOR', 'THE', 'IDIQ', 'BPA', 'RFQ', 'RFP', 'RFI', 'SOLICITATION', 'REQUIREMENT',
  'REQUIREMENTS', 'ANNUAL', 'MULTIPLE', 'AWARD', 'INDEFINITE', 'QUANTITY', 'DELIVERY',
]);

const AGENCY_STOP = new Set(['DEPARTMENT', 'OFFICE', 'BUREAU', 'AGENCY', 'THE', 'OF', 'AND', 'FOR', 'US', 'USA']);

/**
 * USASpending keyword search matches a multi-word string as a CONTIGUOUS phrase
 * (verified: "WHEATLAND ORC HOOF TRIMMING SERVICES" → 0, "WHEATLAND HOOF TRIMMING"
 * → the award). A token ARRAY is OR'd (too broad). So we build a specific→general
 * LADDER of single phrase strings and try each until one matches: the full cleaned
 * title, then the significant tokens joined (generic/short words dropped — the RFQ's
 * "ORC" and "SERVICES" aren't in the award text), then descending contiguous windows,
 * then the single most distinctive token as a last resort.
 */
function candidatePhrases(title: string): string[] {
  const clean = title.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const tokens = clean.split(' ');
  const significant = tokens.filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));
  const out: string[] = [];
  const add = (s: string) => { const v = s.trim(); if (v && !out.includes(v)) out.push(v); };
  add(clean);
  if (significant.length) add(significant.join(' '));
  for (let size = significant.length - 1; size >= 2; size--) {
    for (let i = 0; i + size <= significant.length; i++) add(significant.slice(i, i + size).join(' '));
  }
  if (significant.length) add([...significant].sort((a, b) => b.length - a.length)[0]);
  return out.slice(0, 8);
}

/** Loose agency match on distinctive tokens — tolerates SAM ("INTERIOR, DEPARTMENT
 * OF THE") vs USASpending ("Department of the Interior") and toptier-vs-subtier
 * (a request for "Bureau of Land Management" matches an award's sub-agency). */
function agencyTokens(s: string | undefined | null): Set<string> {
  return new Set(
    (s || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 2 && !AGENCY_STOP.has(w)),
  );
}
function agencyMatches(rowAgency: string, rowSubAgency: string, requested: string): boolean {
  const req = agencyTokens(requested);
  if (!req.size) return false;
  const cand = new Set([...agencyTokens(rowAgency), ...agencyTokens(rowSubAgency)]);
  for (const t of req) if (cand.has(t)) return true;
  return false;
}

// Incumbents up for recompete are almost always in a base year awarded 3-6 years
// back (base + 4 options is typical), so a single recent FY (the old window, by
// action date) could never see them. Search the last ~7 FYs.
function wideTimePeriod(): { start_date: string; end_date: string } {
  const fy = latestCompleteFiscalYear();
  return { start_date: `${fy - 6}-10-01`, end_date: `${fy + 1}-09-30` };
}

interface AwardRow { id: string; amount: number; agency: string; subAgency: string }

async function searchTopAwards(naics: string, keyword: string): Promise<AwardRow[]> {
  // NO agency hard filter — USASpending agency naming/tier is unreliable (BLM is a
  // sub-agency of Interior; the old tier:'toptier' name:'BLM' matched nothing). We
  // rank by agency AFTER the fact instead. Precision comes from the phrase + NAICS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filters: any = { award_type_codes: ['A', 'B', 'C', 'D'], time_period: [wideTimePeriod()] };
  if (naics) filters.naics_codes = [naics];
  if (keyword) filters.keywords = [keyword.slice(0, 80)];
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters,
      fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Awarding Sub Agency', 'generated_internal_id'],
      limit: 25,
      sort: 'Award Amount',
      order: 'desc',
      subawards: false,
    }),
  });
  if (!res.ok) return [];
  const j = await res.json();
  return (j.results || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => ({
      id: r.generated_internal_id,
      amount: Number(r['Award Amount']) || 0,
      agency: r['Awarding Agency'] || '',
      subAgency: r['Awarding Sub Agency'] || '',
    }))
    .filter((r: AwardRow) => r.id);
}

/**
 * Returns the full detail of the likely-incumbent award for an opportunity, or
 * null when no good match exists. Best-match inference (NAICS + title phrase +
 * agency), not a certified link — the caller labels it "likely incumbent."
 */
export async function findPredecessorAward(opts: {
  naicsCode?: string;
  agencyName?: string;
  keyword?: string;     // the opportunity title — sharpens the match when present
}): Promise<(AwardDetail & { matchConfidence: 'high' | 'medium' | 'low' }) | null> {
  const naics = (opts.naicsCode || '').replace(/[^\d]/g, '').slice(0, 6);
  if (!naics && !opts.keyword) return null;

  // Specific→general phrase ladder; naics-only ('') as the last resort. Return on
  // the FIRST candidate that matches so a distinctive phrase ("WHEATLAND HOOF
  // TRIMMING" → the $601K hoof-trimming award) wins before a generic one ("WHEATLAND"
  // → a $6M facility contract, the wrong incumbent).
  const attempts = opts.keyword ? candidatePhrases(opts.keyword) : [];
  attempts.push(''); // naics-only fallback (low confidence, largest award)

  try {
    for (const kw of attempts) {
      if (!naics && !kw) continue;
      const rows = await searchTopAwards(naics, kw);
      if (!rows.length) continue;

      // Prefer an award whose agency matches the requested one; else the largest
      // (rows are already amount-desc). Agency is a ranking signal, never a filter.
      const agencyHit = opts.agencyName
        ? rows.find((r) => agencyMatches(r.agency, r.subAgency, opts.agencyName!))
        : undefined;
      const pick = agencyHit || rows[0];

      const detail = await fetchAwardDetail(pick.id);
      if (!detail) continue;

      const kwUsed = !!kw;
      const agencyOk = opts.agencyName
        ? agencyMatches(pick.agency || detail.awardingAgency || '', pick.subAgency || detail.awardingSubAgency || '', opts.agencyName)
        : false;
      const matchConfidence: 'high' | 'medium' | 'low' =
        kwUsed && agencyOk ? 'high' : kwUsed || agencyOk ? 'medium' : 'low';
      return { ...detail, matchConfidence };
    }
    return null;
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
