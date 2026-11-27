/**
 * Grants.gov search — a focused, side-effect-free query for the MCP tool
 * (`search_grants`) and any other caller that wants raw grant opportunities.
 *
 * This is the clean fetch+parse+agency-filter core, lifted from
 * src/app/api/grants/route.ts WITHOUT the route's UI concerns (user-profile
 * relevance scoring, last-good snapshotting, Coach-Mode workspace resolution).
 * The formal GrantOpportunity type + scoreGrant live in
 * src/lib/briefings/pipelines/grants-gov.ts; this returns a lean result shape
 * matching the fields Grants.gov actually returns for a search hit.
 */
const GRANTS_GOV_API = 'https://apply07.grants.gov/grantsws/rest/opportunities/search';

interface GrantsGovOpp {
  id: string;
  number: string;
  title: string;
  agencyCode?: string;
  agency?: string;
  openDate?: string;
  closeDate?: string;
  oppStatus?: string;
  docType?: string;
  cfdaList?: string[];
  synopsis?: string;
  description?: string;
  awardCeiling?: string | number;
}
interface GrantsGovResponse {
  oppHits?: GrantsGovOpp[];
  totalHits?: GrantsGovOpp[];
  hitCount?: number;
}

export interface GrantSearchInput {
  keyword?: string;
  /** Top-level agency code, e.g. "DOD" / "HHS" — client-side prefix filter. */
  agency?: string;
  /** Grants.gov funding category code, e.g. "HL" / "ST". */
  category?: string;
  status?: 'posted' | 'forecasted' | 'closed' | 'archived';
  limit?: number;
  offset?: number;
}

export interface GrantResult {
  oppNumber: string;
  title: string;
  agency: string;
  agencyCode: string | null;
  description: string;
  awardCeiling: number | null;
  postedDate: string | null;
  closeDate: string | null;
  status: string | null;
  cfdaList: string[];
  url: string;
  /**
   * Why this grant matched the keyword, strongest first: every keyword term in the title; some terms in
   * the title; the keyword is one of its Assistance Listing numbers; or only the synopsis matched.
   * Absent when no keyword was searched.
   */
  match?: 'title' | 'title_partial' | 'assistance_listing' | 'description';
}

const GRANT_STOPWORDS = new Set(['and', 'for', 'the', 'with', 'from', 'into', 'program', 'programs', 'grant', 'grants', 'federal', 'funding', 'services']);
const ALN = /^\d{2}\.\d{3}$/;

/** Keyword terms that can carry meaning in a title (3+ letters, not filler). */
export function grantKeywordTerms(keyword: string): string[] {
  return [...new Set(keyword.toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length >= 3 && !GRANT_STOPWORDS.has(t)))];
}

/**
 * Rank grants by what the keyword actually names (Ask Mindy Backend Spec: "rank by grant title and assistance
 * listing"). Grants.gov's search endpoint accepts only date sorts, so a grant whose synopsis merely mentions
 * the word outranked one titled for it. Tiers: all terms in title → assistance listing number → some terms
 * in title → synopsis only. Within a tier the upstream (newest-first) order is kept. Pure.
 */
export function rankGrantsByRelevance(grants: GrantResult[], keyword: string): GrantResult[] {
  const k = keyword.trim();
  if (!k) return grants;
  const terms = grantKeywordTerms(k);
  const aln = ALN.test(k) ? k : null;
  const tier = (g: GrantResult): { match: NonNullable<GrantResult['match']>; rank: number } => {
    const title = (g.title || '').toLowerCase();
    const hits = terms.filter((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)).length;
    if (aln && g.cfdaList.includes(aln)) return { match: 'assistance_listing', rank: 0 };
    if (terms.length && hits === terms.length) return { match: 'title', rank: 0 };
    if (hits > 0) return { match: 'title_partial', rank: 1 };
    return { match: 'description', rank: 2 };
  };
  return grants
    .map((g, i) => ({ g, i, t: tier(g) }))
    .sort((a, b) => a.t.rank - b.t.rank || a.i - b.i)
    .map(({ g, t }) => ({ ...g, match: t.match }));
}

export interface GrantSearchResult {
  grants: GrantResult[];
  total: number;
  agencyFiltered: boolean;
  degraded: boolean;
}

export async function searchGrants(input: GrantSearchInput): Promise<GrantSearchResult> {
  const keyword = (input.keyword || '').trim();
  const agencyFilter = (input.agency || '').trim().toUpperCase();
  const category = (input.category || '').trim();
  const status = input.status || 'posted';
  const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);
  const offset = Math.max(Number(input.offset) || 0, 0);

  // Grants.gov's agency facet filters unreliably for top-level codes, so we fetch
  // broadly and prefix-filter client-side (a hit's agencyCode is like "DOD-AMRAA").
  // Fetch extra rows when an agency filter is active so the page still fills.
  // A keyword search fetches a wider newest-first window so title matches can be ranked ahead of
  // synopsis-only matches (rankGrantsByRelevance) before the page is cut.
  const fetchRows = agencyFilter ? Math.min(limit * 4, 100) : keyword ? Math.min(Math.max(limit * 3, 50), 100) : limit;
  const payload: Record<string, unknown> = {
    keyword: keyword || undefined,
    oppStatuses: status,
    fundingCategories: category || undefined,
    rows: fetchRows,
    startRecordNum: offset || undefined,
    // FM-U07 (Eric/QA 2026-07-29; CORRECTED 2026-07-29 on re-verify): this grants.gov endpoint
    // (apply07.grants.gov/grantsws) ONLY accepts DATE sort fields — openDate / closeDate. Any other
    // value (relevancy, title, …) makes it return hitCount:0 with errorcode:0 — a SILENT EMPTY, not an
    // error. The first FM-U07 attempt set `relevancy|desc` on a keyword and thereby zeroed out EVERY
    // keyword grant search (verified live: "health" → 664 hits with openDate, 0 with relevancy). There
    // is no server-side relevance sort here; grants.gov already keyword-filters, so we keep newest-first
    // (a supported value) and never send an unsupported sort. Only the Federal Register half of FM-U07
    // (federal-register/index.ts) has a real `relevance` order — that one stands.
    sortBy: 'openDate|desc',
  };
  const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));

  let data: GrantsGovResponse;
  try {
    const res = await fetch(GRANTS_GOV_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanPayload),
    });
    if (!res.ok) {
      console.error('[grants:search] Grants.gov returned', res.status);
      return { grants: [], total: 0, agencyFiltered: !!agencyFilter, degraded: true };
    }
    data = (await res.json()) as GrantsGovResponse;
  } catch (err) {
    console.error('[grants:search] fetch failed:', err);
    return { grants: [], total: 0, agencyFiltered: !!agencyFilter, degraded: true };
  }

  const raw = data.oppHits || data.totalHits || [];
  const totalAvailable = typeof data.hitCount === 'number' ? data.hitCount : raw.length;

  let grants: GrantResult[] = raw.map((opp) => ({
    oppNumber: opp.number,
    title: opp.title,
    agency: opp.agency || 'Unknown',
    agencyCode: opp.agencyCode ?? null,
    description: opp.synopsis || opp.description || '',
    awardCeiling:
      typeof opp.awardCeiling === 'string' ? parseFloat(opp.awardCeiling) || null : opp.awardCeiling ?? null,
    postedDate: opp.openDate ?? null,
    closeDate: opp.closeDate ?? null,
    status: opp.oppStatus ?? null,
    cfdaList: opp.cfdaList || [],
    url: `https://www.grants.gov/search-results-detail/${opp.id}`,
  }));

  let agencyFiltered = false;
  if (agencyFilter) {
    grants = grants.filter((g) => (g.agencyCode || '').toUpperCase().startsWith(agencyFilter));
    agencyFiltered = true;
  }
  grants = rankGrantsByRelevance(grants, keyword).slice(0, limit);

  // When agency-filtered the upstream hitCount is the UNfiltered total, so report
  // the honest post-filter count for this page instead of an inflated number.
  const total = agencyFiltered ? grants.length : totalAvailable;
  return { grants, total, agencyFiltered, degraded: false };
}
