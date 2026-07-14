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
  const fetchRows = agencyFilter ? Math.min(limit * 4, 100) : limit;
  const payload: Record<string, unknown> = {
    keyword: keyword || undefined,
    oppStatuses: status,
    fundingCategories: category || undefined,
    rows: fetchRows,
    startRecordNum: offset || undefined,
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
    grants = grants.filter((g) => (g.agencyCode || '').toUpperCase().startsWith(agencyFilter)).slice(0, limit);
    agencyFiltered = true;
  }

  // When agency-filtered the upstream hitCount is the UNfiltered total, so report
  // the honest post-filter count for this page instead of an inflated number.
  const total = agencyFiltered ? grants.length : totalAvailable;
  return { grants, total, agencyFiltered, degraded: false };
}
