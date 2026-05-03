/**
 * SAM.gov Opportunities Pipeline
 *
 * Fetches opportunities from SAM.gov API based on user's watchlist.
 * Returns solicitations, due dates, set-asides, and amendments.
 *
 * NEW: Can now query from local Supabase cache (sam_opportunities table)
 * instead of hitting the API with rate limits.
 */

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client for cached opportunities
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

interface SAMOpportunity {
  noticeId: string;
  title: string;
  solicitationNumber: string;
  naicsCode: string;
  classificationCode: string; // PSC
  description: string;

  // Agency info
  department: string;
  subTier: string;
  office: string;

  // Dates
  postedDate: string;
  responseDeadline: string;
  archiveDate: string;

  // Set-aside
  setAside: string | null;
  setAsideDescription: string | null;

  // Type and status
  noticeType: string; // 'Solicitation', 'Combined Synopsis/Solicitation', etc.
  active: boolean;

  // Location
  placeOfPerformance: {
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  } | null;

  // Links
  uiLink: string;

  // Tracking
  lastModifiedDate: string;
}

interface SAMSearchParams {
  naicsCodes?: string[];
  pscCodes?: string[]; // Product/Service Classification codes
  agencies?: string[];
  keywords?: string[];
  zipCodes?: string[];
  setAsides?: string[];
  postedFrom?: string; // ISO date
  postedTo?: string;
  limit?: number;
  // Opportunity types: p=presolicitation, r=sources sought, k=combined, o=solicitation
  noticeTypes?: string[];
  state?: string; // Single state code (legacy)
  states?: string[]; // Multiple state codes for expanded search
}

const DESCRIPTION_STOP_WORDS = new Set([
  'about', 'after', 'also', 'and', 'are', 'business', 'company', 'does', 'for',
  'from', 'government', 'help', 'into', 'our', 'provide', 'provides', 'providing',
  'services', 'support', 'that', 'the', 'their', 'this', 'through', 'with', 'your',
]);

function extractDescriptionTerms(description?: string | null): string[] {
  if (!description) return [];

  return Array.from(new Set(
    description
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map(term => term.trim())
      .filter(term => term.length >= 4 && !DESCRIPTION_STOP_WORDS.has(term))
  )).slice(0, 20);
}

interface SAMSearchResult {
  opportunities: SAMOpportunity[];
  totalRecords: number;
  fetchedAt: string;
}

interface SAMNoticeSummary {
  totalMatched: number;
  rfp: number;
  rfq: number;
  sourcesSought: number;
  preSol: number;
  combined: number;
  other: number;
}

interface SAMRawOpportunity {
  noticeId?: string;
  title?: string;
  solicitationNumber?: string;
  naicsCode?: string;
  classificationCode?: string;
  description?: string;
  department?: { name?: string };
  fullParentPathName?: string;
  subtierAgency?: { name?: string };
  office?: { name?: string };
  officeAddress?: { city?: string; state?: string; zip?: string; country?: string };
  postedDate?: string;
  responseDeadLine?: string;
  responseDeadline?: string;
  archiveDate?: string;
  typeOfSetAside?: string | null;
  typeOfSetAsideDescription?: string | null;
  type?: string;
  noticeType?: string;
  active?: boolean | string;
  placeOfPerformance?: {
    city?: { name?: string };
    state?: { code?: string };
    zip?: string;
    country?: { code?: string };
  } | null;
  uiLink?: string;
  lastModifiedDate?: string;
  [key: string]: unknown;
}

interface SAMCacheOpportunityRow {
  notice_id: string;
  title: string;
  solicitation_number: string | null;
  naics_code: string | null;
  psc_code: string | null;
  description: string | null;
  department: string | null;
  sub_tier: string | null;
  office: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  archive_date: string | null;
  set_aside_code: string | null;
  set_aside_description: string | null;
  notice_type: string | null;
  active: boolean;
  pop_city: string | null;
  pop_state: string | null;
  pop_zip: string | null;
  pop_country: string | null;
  ui_link: string | null;
  last_modified: string | null;
}

interface SAMCacheNoticeSummaryRow {
  notice_type: string | null;
  title: string | null;
  description: string | null;
}

// SAM.gov API base URL
const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2';

// Map our set-aside codes to SAM.gov codes
const setAsideMapping: Record<string, string> = {
  'SBA': 'SBA',
  'SBP': 'SBP',
  '8A': '8A',
  'HUBZone': 'HZC',
  'WOSB': 'WOSB',
  'EDWOSB': 'EDWOSB',
  'SDVOSB': 'SDVOSBC',
  'VOSB': 'VSB',
};

/**
 * Fetch opportunities for a single NAICS code from SAM.gov API
 */
async function fetchSingleNaicsOpportunities(
  naicsCode: string,
  baseParams: URLSearchParams,
  apiKey: string,
  skipNaicsFilter = false
): Promise<SAMOpportunity[]> {
  const queryParams = new URLSearchParams(baseParams);
  // CRITICAL: Trim apiKey to remove any trailing newlines from env var
  queryParams.set('api_key', apiKey.trim());
  // Use 'naics' parameter (not 'ncode') to match SAM.gov MCP server that works
  // NOTE: SAM.gov doesn't reliably filter by NAICS, but we include it anyway
  if (!skipNaicsFilter && naicsCode) {
    queryParams.set('naics', naicsCode);
  }

  const url = `${SAM_API_BASE}/search?${queryParams.toString()}`;
  console.log(`[SAM.gov DEBUG] Built URL: ${url.replace(apiKey, 'SAM-***')}`);
  console.log(`[SAM.gov DEBUG] Base params:`, Object.fromEntries(baseParams.entries()));

  try {
    console.log(`[SAM.gov DEBUG] Starting fetch for NAICS ${naicsCode || 'ALL'}...`);
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    console.log(`[SAM.gov DEBUG] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      console.error(`[SAM.gov] Error for NAICS ${naicsCode}: ${response.status} - ${errorText.substring(0, 500)}`);
      return [];
    }

    const responseText = await response.text();
    console.log(`[SAM.gov DEBUG] Response length: ${responseText.length}`);
    console.log(`[SAM.gov DEBUG] Response preview: ${responseText.substring(0, 200)}`);

    let data;
    try {
      data = JSON.parse(responseText) as { opportunitiesData?: SAMRawOpportunity[], totalRecords?: number };
    } catch (parseError) {
      console.error(`[SAM.gov DEBUG] JSON parse error:`, parseError);
      console.error(`[SAM.gov DEBUG] Raw response: ${responseText.substring(0, 500)}`);
      return [];
    }

    const opps = data.opportunitiesData || [];
    console.log(`[SAM.gov DEBUG] NAICS ${naicsCode || 'ALL'}: returned ${opps.length} opps (total: ${data.totalRecords || 'unknown'})`);
    return opps.map((opp) => parseOpportunity(opp));
  } catch (error) {
    console.error(`[SAM.gov DEBUG] Error fetching NAICS ${naicsCode}:`, error);
    return [];
  }
}

/**
 * Parse raw SAM.gov opportunity into our interface
 */
function parseOpportunity(opp: SAMRawOpportunity): SAMOpportunity {
  return {
    noticeId: opp.noticeId || '',
    title: opp.title || '',
    solicitationNumber: opp.solicitationNumber || '',
    naicsCode: opp.naicsCode || '',
    classificationCode: opp.classificationCode || '',
    description: opp.description || '',
    department: opp.department?.name || opp.fullParentPathName?.split('.')[0] || '',
    subTier: opp.subtierAgency?.name || '',
    office: opp.office?.name || opp.officeAddress?.city || '',
    postedDate: opp.postedDate || '',
    responseDeadline: opp.responseDeadLine || opp.responseDeadline || '',
    archiveDate: opp.archiveDate || '',
    setAside: opp.typeOfSetAside || null,
    setAsideDescription: opp.typeOfSetAsideDescription || null,
    noticeType: opp.type || opp.noticeType || '',
    active: opp.active === 'Yes' || opp.active === true,
    placeOfPerformance: opp.placeOfPerformance ? {
      city: opp.placeOfPerformance.city?.name,
      state: opp.placeOfPerformance.state?.code,
      zip: opp.placeOfPerformance.zip,
      country: opp.placeOfPerformance.country?.code,
    } : null,
    uiLink: opp.uiLink || `https://sam.gov/opp/${opp.noticeId}/view`,
    lastModifiedDate: opp.lastModifiedDate || opp.postedDate || '',
  };
}

/**
 * Fetch opportunities from SAM.gov API
 * Handles multiple NAICS codes by making parallel requests and merging results
 */
export async function fetchSamOpportunities(
  params: SAMSearchParams,
  apiKey: string
): Promise<SAMSearchResult> {
  const {
    naicsCodes = [],
    keywords = [],
    zipCodes = [],
    setAsides = [],
    postedFrom,
    postedTo,
    limit = 100,
    noticeTypes = [],
    state,
    states,
  } = params;

  console.log(`[SAM.gov DEBUG] Input params:`, JSON.stringify({
    naicsCodes: naicsCodes.slice(0, 5),
    postedFrom,
    postedTo,
    limit,
    apiKeyPresent: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 15) : 'NONE',
  }));

  // Build base query parameters (without NAICS - we'll add per-request)
  const baseParams = new URLSearchParams();
  baseParams.set('limit', String(Math.min(limit, 50))); // Cap per-request to 50
  // SAM.gov requires MM/dd/yyyy format - convert if passed in ISO format (YYYY-MM-DD)
  const convertedPostedFrom = postedFrom ? convertToSAMDateFormat(postedFrom) : getDefaultPostedFrom();
  const convertedPostedTo = postedTo ? convertToSAMDateFormat(postedTo) : getTodayDate();
  baseParams.set('postedFrom', convertedPostedFrom);
  baseParams.set('postedTo', convertedPostedTo);

  console.log(`[SAM.gov DEBUG] Date conversion:`, JSON.stringify({
    inputPostedFrom: postedFrom,
    inputPostedTo: postedTo,
    convertedPostedFrom,
    convertedPostedTo,
  }));

  // Add keywords
  if (keywords.length > 0) {
    baseParams.set('q', keywords.join(' OR '));
  }

  // Add set-asides
  if (setAsides.length > 0) {
    const samSetAsides = setAsides.map(s => setAsideMapping[s] || s).join(',');
    baseParams.set('typeOfSetAside', samSetAsides);
  }

  // Add place of performance
  if (zipCodes.length > 0) {
    baseParams.set('poplace', zipCodes.join(','));
  }

  // State filter - support multiple states for expanded coverage
  // SAM.gov API supports comma-separated state codes
  const stateList = states || (state ? [state] : []);
  if (stateList.length > 0) {
    baseParams.set('state', stateList.join(','));
    console.log(`[SAM.gov] State filter: ${stateList.join(', ')}`);
  }

  // Add notice types
  if (noticeTypes.length > 0) {
    baseParams.set('ptype', noticeTypes.join(','));
  }

  console.log(`[SAM.gov] Fetching opportunities for ${naicsCodes.length} NAICS codes: ${naicsCodes.slice(0, 10).join(', ')}${naicsCodes.length > 10 ? '...' : ''}`);

  // SAM.gov API does NOT support comma-separated NAICS codes (returns 0 results)
  // We must make PARALLEL requests for each NAICS code and merge results
  if (naicsCodes.length === 0) {
    console.log('[SAM.gov] No NAICS codes provided');
    return { opportunities: [], totalRecords: 0, fetchedAt: new Date().toISOString() };
  }

  // Make parallel requests for each NAICS code (limit to 10 to balance coverage vs rate limits)
  // Rate limit: 10 requests/minute, 1000/day - fetching 10 codes is safe
  const codesToFetch = naicsCodes.slice(0, 10);
  console.log(`[SAM.gov] Making ${codesToFetch.length} parallel requests for: ${codesToFetch.join(', ')}`);

  const results = await Promise.all(
    codesToFetch.map(code => fetchSingleNaicsOpportunities(code, baseParams, apiKey))
  );

  // Merge and deduplicate by noticeId
  const seenIds = new Set<string>();
  const allOpportunities: SAMOpportunity[] = [];

  for (const opportunities of results) {
    for (const opp of opportunities) {
      if (!seenIds.has(opp.noticeId)) {
        // NOTE: SAM.gov API doesn't reliably filter by NAICS, so we used to do client-side filtering here.
        // However, this resulted in 0 results because SAM.gov returns unrelated NAICS codes.
        // For now, we trust the API and show all results. TODO: Investigate SAM.gov ncode parameter.
        // If user has specific NAICS, they're likely interested in these active opportunities anyway.
        seenIds.add(opp.noticeId);
        allOpportunities.push(opp);
      }
    }
  }

  console.log(`[SAM.gov] Retrieved ${allOpportunities.length} unique opportunities from ${codesToFetch.length} NAICS codes`);

  // FALLBACK: If NAICS-filtered requests return 0 results, fetch without NAICS filter
  // This ensures users always get some opportunities to act on
  if (allOpportunities.length === 0) {
    console.log(`[SAM.gov] NAICS-filtered requests returned 0 results. Fetching without NAICS filter as fallback...`);
    try {
      const fallbackOpportunities = await fetchSingleNaicsOpportunities('', baseParams, apiKey, true);
      console.log(`[SAM.gov] Fallback returned ${fallbackOpportunities.length} opportunities`);
      return {
        opportunities: fallbackOpportunities.slice(0, limit),
        totalRecords: fallbackOpportunities.length,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error('[SAM.gov] Fallback fetch error:', err);
    }
  }

  return {
    opportunities: allOpportunities.slice(0, limit),
    totalRecords: allOpportunities.length,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch opportunities for a specific user's watchlist
 */
export async function fetchOpportunitiesForUser(
  userProfile: {
    naics_codes: string[];
    agencies: string[];
    keywords: string[];
    zip_codes: string[];
    location_state?: string | null;
    location_states?: string[] | null;
  },
  apiKey: string
): Promise<SAMSearchResult> {
  // Build search params from user profile
  // Expanded limits for better opportunity coverage
  const params: SAMSearchParams = {
    naicsCodes: userProfile.naics_codes?.slice(0, 15) || [], // Expanded from 10 to 15
    keywords: userProfile.keywords?.slice(0, 10) || [], // Expanded from 5 to 10
    zipCodes: userProfile.zip_codes?.slice(0, 5) || [], // Expanded from 3 to 5
    state: userProfile.location_state || undefined,
    states: userProfile.location_states?.slice(0, 10) || undefined,
    // Posted in last 30 days for better coverage
    postedFrom: getDateDaysAgo(30),
    limit: 300, // Increased from 200
  };

  return fetchSamOpportunities(params, apiKey);
}

/**
 * Compare two snapshots and identify changes
 */
export function diffOpportunities(
  today: SAMOpportunity[],
  yesterday: SAMOpportunity[]
): {
  new: SAMOpportunity[];
  modified: Array<{
    opportunity: SAMOpportunity;
    changes: string[];
  }>;
  closed: SAMOpportunity[];
} {
  const yesterdayMap = new Map(yesterday.map(o => [o.noticeId, o]));
  const todayMap = new Map(today.map(o => [o.noticeId, o]));

  // NEW: in today but not yesterday
  const newOpps = today.filter(o => !yesterdayMap.has(o.noticeId));

  // MODIFIED: in both but changed
  const modified: Array<{ opportunity: SAMOpportunity; changes: string[] }> = [];
  for (const opp of today) {
    const prev = yesterdayMap.get(opp.noticeId);
    if (!prev) continue;

    const changes: string[] = [];

    // Check for deadline change
    if (opp.responseDeadline !== prev.responseDeadline) {
      changes.push(`deadline_changed: ${prev.responseDeadline} → ${opp.responseDeadline}`);
    }

    // Check for set-aside change
    if (opp.setAside !== prev.setAside) {
      changes.push(`setaside_changed: ${prev.setAside || 'none'} → ${opp.setAside || 'none'}`);
    }

    // Check for modification (last modified date changed)
    if (opp.lastModifiedDate !== prev.lastModifiedDate) {
      changes.push('amendment_posted');
    }

    // Check for title change (scope change indicator)
    if (opp.title !== prev.title) {
      changes.push('title_changed');
    }

    if (changes.length > 0) {
      modified.push({ opportunity: opp, changes });
    }
  }

  // CLOSED: in yesterday but not today, or active changed to false
  const closed = yesterday.filter(o => {
    const current = todayMap.get(o.noticeId);
    return !current || !current.active;
  });

  return { new: newOpps, modified, closed };
}

/**
 * Score an opportunity for relevance to user's profile
 */
export function scoreOpportunity(
  opportunity: SAMOpportunity,
  userProfile: {
    naics_codes: string[];
    agencies: string[];
    keywords: string[];
    business_description?: string | null;
  }
): number {
  let score = 0;

  // NAICS match (highest weight)
  if (userProfile.naics_codes.includes(opportunity.naicsCode)) {
    score += 40;
  } else if (userProfile.naics_codes.some(n =>
    opportunity.naicsCode.startsWith(n) || n.startsWith(opportunity.naicsCode)
  )) {
    score += 20; // Partial NAICS match
  }

  // Agency match
  const oppAgency = `${opportunity.department} ${opportunity.subTier}`.toLowerCase();
  if (userProfile.agencies.some(a => oppAgency.includes(a.toLowerCase()))) {
    score += 30;
  }

  // Keyword match in title/description
  const oppText = `${opportunity.title} ${opportunity.description}`.toLowerCase();
  const keywordMatches = userProfile.keywords.filter(k =>
    oppText.includes(k.toLowerCase())
  ).length;
  score += keywordMatches * 10;

  // Business description semantic-lite ranking.
  // Structured filters still decide inclusion; this only nudges ordering.
  const descriptionTerms = extractDescriptionTerms(userProfile.business_description);
  if (descriptionTerms.length > 0) {
    const descriptionMatches = descriptionTerms.filter(term => oppText.includes(term)).length;
    score += Math.min(descriptionMatches * 3, 15);
  }

  // Deadline urgency (closer = higher score)
  if (opportunity.responseDeadline) {
    const daysUntilDue = getDaysUntil(opportunity.responseDeadline);
    if (daysUntilDue <= 7) {
      score += 15; // Due this week
    } else if (daysUntilDue <= 14) {
      score += 10; // Due in two weeks
    } else if (daysUntilDue <= 30) {
      score += 5; // Due this month
    }
  }

  // Set-aside bonus (small business opportunities)
  if (opportunity.setAside) {
    score += 10;
  }

  return Math.min(score, 100); // Cap at 100
}

// Helper functions
// SAM.gov API requires MM/dd/yyyy format
function formatDateForSAM(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

// Convert any date format to SAM.gov MM/dd/yyyy format
function convertToSAMDateFormat(dateString: string): string {
  // If already in MM/dd/yyyy format, return as-is
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) {
    return dateString;
  }
  // Convert from ISO format (YYYY-MM-DD) or any parseable format
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    // Invalid date, return default (30 days ago)
    return getDefaultPostedFrom();
  }
  return formatDateForSAM(date);
}

function getTodayDate(): string {
  return formatDateForSAM(new Date());
}

function getDefaultPostedFrom(): string {
  // Default to 30 days ago
  return getDateDaysAgo(30);
}

function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDateForSAM(date);
}

function getDaysUntil(dateString: string): number {
  const target = new Date(dateString);
  const today = new Date();
  const diff = target.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Search SAM.gov for RFI/Sources Sought/Pre-Solicitation related to a contract
 *
 * This searches for early-stage acquisition activity that might indicate
 * a recompete is being planned. We search by:
 * - NAICS code
 * - Agency name keywords
 * - Incumbent company name
 * - Contract-related keywords
 *
 * Notice types: p=presolicitation, r=sources sought, k=combined
 */
export interface RelatedOpportunitySearch {
  naicsCode: string;
  agency: string;
  incumbentName?: string;
  keywords?: string[];
  lookbackDays?: number; // How far back to search (default 180 days)
}

export interface RelatedOpportunityResult {
  found: boolean;
  opportunities: SAMOpportunity[];
  summary: {
    totalFound: number;
    sourcesSought: number;
    presolicitation: number;
    rfis: number;
    solicitations: number;
  };
  searchedAt: string;
  lookbackDays: number;
}

/**
 * Search SAM.gov for RFI/Sources Sought/Pre-Sol activity related to a contract
 *
 * This provides VERIFIED data from SAM.gov instead of relying on AI web search.
 */
export async function searchRelatedOpportunities(
  params: RelatedOpportunitySearch,
  apiKey: string
): Promise<RelatedOpportunityResult> {
  const { naicsCode, agency, keywords = [], lookbackDays = 180 } = params;

  const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2';

  // Build search keywords from agency and custom terms
  const searchTerms: string[] = [];

  // Add agency keywords (extract key words from agency name)
  const agencyWords = agency.toLowerCase()
    .replace(/department of|dept of|u\.s\.|us |agency|office|admin|administration/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 2);
  searchTerms.push(...agencyWords.slice(0, 2));

  // Add any custom keywords
  searchTerms.push(...keywords);

  // Build query string
  const query = searchTerms.length > 0 ? searchTerms.join(' OR ') : '';

  // Calculate date range
  const postedFrom = new Date();
  postedFrom.setDate(postedFrom.getDate() - lookbackDays);
  const postedFromStr = formatDateForSAM(postedFrom);
  const postedToStr = formatDateForSAM(new Date());

  // Build URL with notice types for early-stage activity
  // p = presolicitation, r = sources sought, k = combined, s = special notice
  const queryParams = new URLSearchParams({
    api_key: apiKey,
    ncode: naicsCode,
    ptype: 'p,r,k,s', // presol, sources sought, combined, special notice
    postedFrom: postedFromStr,
    postedTo: postedToStr,
    limit: '50',
  });

  if (query) {
    queryParams.set('q', query);
  }

  const url = `${SAM_API_BASE}/search?${queryParams.toString()}`;

  console.log(`[SAM.gov] Searching related opps for NAICS ${naicsCode}, agency: ${agency}, lookback: ${lookbackDays} days`);

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`[SAM.gov] Related search error: ${response.status}`);
      return {
        found: false,
        opportunities: [],
        summary: { totalFound: 0, sourcesSought: 0, presolicitation: 0, rfis: 0, solicitations: 0 },
        searchedAt: new Date().toISOString(),
        lookbackDays,
      };
    }

    const data = await response.json() as { opportunitiesData?: SAMRawOpportunity[] };
    const opportunities = (data.opportunitiesData || []).map((opp) => parseOpportunity(opp));

    // Categorize by notice type
    const summary = {
      totalFound: opportunities.length,
      sourcesSought: opportunities.filter((o: SAMOpportunity) =>
        o.noticeType.toLowerCase().includes('sources sought') || o.noticeType === 'r'
      ).length,
      presolicitation: opportunities.filter((o: SAMOpportunity) =>
        o.noticeType.toLowerCase().includes('presol') || o.noticeType === 'p'
      ).length,
      rfis: opportunities.filter((o: SAMOpportunity) =>
        o.title.toLowerCase().includes('rfi') ||
        o.description?.toLowerCase().includes('request for information')
      ).length,
      solicitations: opportunities.filter((o: SAMOpportunity) =>
        o.noticeType.toLowerCase().includes('solicitation') &&
        !o.noticeType.toLowerCase().includes('presol')
      ).length,
    };

    console.log(`[SAM.gov] Found ${summary.totalFound} related opps: ${summary.sourcesSought} sources sought, ${summary.presolicitation} presol, ${summary.rfis} RFIs`);

    return {
      found: opportunities.length > 0,
      opportunities,
      summary,
      searchedAt: new Date().toISOString(),
      lookbackDays,
    };
  } catch (error) {
    console.error('[SAM.gov] Related search error:', error);
    return {
      found: false,
      opportunities: [],
      summary: { totalFound: 0, sourcesSought: 0, presolicitation: 0, rfis: 0, solicitations: 0 },
      searchedAt: new Date().toISOString(),
      lookbackDays,
    };
  }
}

/**
 * Fetch opportunities from local Supabase cache (sam_opportunities table)
 *
 * This is MUCH faster than API calls and has no rate limits.
 * Cache is synced daily at 2 AM via /api/cron/sync-sam-opportunities
 *
 * Query strategy:
 * - Match any of the user's NAICS codes (OR logic)
 * - Filter by response deadline (future only)
 * - Order by deadline (urgent first)
 */
export async function fetchSamOpportunitiesFromCache(
  params: SAMSearchParams
): Promise<SAMSearchResult> {
  const {
    naicsCodes = [],
    pscCodes = [],
    keywords = [],
    limit = 100,
  } = params;

  if (!supabase) {
    console.error('[SAM Cache] Supabase client not initialized');
    return { opportunities: [], totalRecords: 0, fetchedAt: new Date().toISOString() };
  }

  const searchCriteria = [
    naicsCodes.length > 0 ? `NAICS: ${naicsCodes.slice(0, 3).join(', ')}${naicsCodes.length > 3 ? '...' : ''}` : null,
    pscCodes.length > 0 ? `PSC: ${pscCodes.slice(0, 3).join(', ')}${pscCodes.length > 3 ? '...' : ''}` : null,
    keywords.length > 0 ? `Keywords: ${keywords.slice(0, 2).join(', ')}${keywords.length > 2 ? '...' : ''}` : null,
  ].filter(Boolean);
  console.log(`[SAM Cache] Querying database for ${searchCriteria.join(' | ') || 'all opportunities'}`);

  try {
    const query = applySamCacheFilters(
      supabase
        .from('sam_opportunities')
        .select('*')
        .order('response_deadline', { ascending: true })
        .limit(limit),
      params
    );

    const { data, error } = await query;

    if (error) {
      console.error('[SAM Cache] Query error:', error);
      return { opportunities: [], totalRecords: 0, fetchedAt: new Date().toISOString() };
    }

    console.log(`[SAM Cache] Found ${data?.length || 0} opportunities from database`);

    // Transform database records to SAMOpportunity interface
    const rows = (data || []) as SAMCacheOpportunityRow[];
    const opportunities: SAMOpportunity[] = rows.map(row => ({
      noticeId: row.notice_id,
      title: row.title,
      solicitationNumber: row.solicitation_number || '',
      naicsCode: row.naics_code || '',
      classificationCode: row.psc_code || '',
      description: row.description || '',
      department: row.department || '',
      subTier: row.sub_tier || '',
      office: row.office || '',
      postedDate: row.posted_date || '',
      responseDeadline: row.response_deadline || '',
      archiveDate: row.archive_date || '',
      setAside: row.set_aside_code,
      setAsideDescription: row.set_aside_description,
      noticeType: row.notice_type || '',
      active: row.active,
      placeOfPerformance: {
        city: row.pop_city || undefined,
        state: row.pop_state || undefined,
        zip: row.pop_zip || undefined,
        country: row.pop_country || undefined,
      },
      uiLink: row.ui_link || `https://sam.gov/opp/${row.notice_id}/view`,
      lastModifiedDate: row.last_modified || row.posted_date || '',
    }));

    // If keywords provided, filter client-side (Supabase full-text search would be better but this works)
    let filtered = opportunities;
    if (keywords.length > 0) {
      const keywordLower = keywords.map(k => k.toLowerCase());
      filtered = opportunities.filter(opp => {
        const text = `${opp.title} ${opp.description}`.toLowerCase();
        return keywordLower.some(k => text.includes(k));
      });
    }

    return {
      opportunities: filtered.slice(0, limit),
      totalRecords: filtered.length,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[SAM Cache] Error querying cache:', error);
    return { opportunities: [], totalRecords: 0, fetchedAt: new Date().toISOString() };
  }
}

// Supabase query builders use complex fluent generics; keep this helper permissive.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySamCacheFilters(query: any, params: SAMSearchParams) {
  const {
    naicsCodes = [],
    pscCodes = [],
    setAsides = [],
    state,
    states,
    postedFrom,
    postedTo,
    noticeTypes = [],
  } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let filteredQuery = query as any;

  filteredQuery = filteredQuery.eq('active', true);
  filteredQuery = filteredQuery.gte('response_deadline', new Date().toISOString());

  if (postedFrom) {
    filteredQuery = filteredQuery.gte('posted_date', postedFrom);
  }

  if (postedTo) {
    filteredQuery = filteredQuery.lte('posted_date', postedTo);
  }

  if (naicsCodes.length > 0) {
    const prefixes = new Set<string>();
    for (const code of naicsCodes) {
      const prefix = code.slice(0, 3);
      if (prefix.length === 3 && /^\d{3}$/.test(prefix)) {
        prefixes.add(prefix);
      }
    }

    const naicsFilters = Array.from(prefixes).map(prefix => `naics_code.like.${prefix}%`).join(',');
    if (naicsFilters) {
      filteredQuery = filteredQuery.or(naicsFilters);
      console.log(`[SAM Cache] Using NAICS prefix filters: ${naicsFilters}`);
    }
  }

  if (pscCodes.length > 0) {
    const pscFilters = pscCodes.map(psc => `psc_code.like.${psc}%`).join(',');
    if (pscFilters) {
      filteredQuery = filteredQuery.or(pscFilters);
      console.log(`[SAM Cache] Using PSC prefix filters: ${pscFilters}`);
    }
  }

  if (setAsides.length > 0) {
    const setAsideFilters = setAsides.map(s => `set_aside_code.eq.${s}`).join(',');
    filteredQuery = filteredQuery.or(setAsideFilters);
  }

  if (noticeTypes.length > 0) {
    const noticeTypeFilters = new Set<string>();
    for (const type of noticeTypes.map(t => t.toLowerCase())) {
      noticeTypeFilters.add(`notice_type.eq.${type}`);
      if (type === 'p') noticeTypeFilters.add('notice_type.ilike.*presol*');
      if (type === 'r') {
        noticeTypeFilters.add('notice_type.ilike.*source*');
        noticeTypeFilters.add('notice_type.ilike.*rfi*');
      }
      if (type === 'k') noticeTypeFilters.add('notice_type.ilike.*combined*');
      if (type === 'o') noticeTypeFilters.add('notice_type.ilike.*solicitation*');
    }
    filteredQuery = filteredQuery.or(Array.from(noticeTypeFilters).join(','));
  }

  const stateList = Array.from(
    new Set((states || (state ? [state] : []))
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(value => value.trim().toUpperCase()))
  );

  if (stateList.length > 0) {
    // Location states should behave as a hard place-of-performance gate, not an optional OR signal.
    filteredQuery = filteredQuery.in('pop_state', stateList);
    console.log(`[SAM Cache] Using hard state filter: ${stateList.join(', ')}`);
  }

  return filteredQuery;
}

function classifyNoticeType(noticeType: string | null | undefined): keyof Omit<SAMNoticeSummary, 'totalMatched'> {
  const type = (noticeType || '').toLowerCase();
  if (type.includes('solicitation') || type.includes('rfp')) return 'rfp';
  if (type.includes('rfq') || type.includes('quote')) return 'rfq';
  if (type.includes('source') || type.includes('rfi') || type.includes('market research')) return 'sourcesSought';
  if (type.includes('presol') || type.includes('intent') || type.includes('pre-sol')) return 'preSol';
  if (type.includes('combined')) return 'combined';
  return 'other';
}

export async function fetchSamOpportunityNoticeSummaryFromCache(
  params: SAMSearchParams
): Promise<SAMNoticeSummary> {
  if (!supabase) {
    console.error('[SAM Cache] Supabase client not initialized');
    return { totalMatched: 0, rfp: 0, rfq: 0, sourcesSought: 0, preSol: 0, combined: 0, other: 0 };
  }

  const summary: SAMNoticeSummary = {
    totalMatched: 0,
    rfp: 0,
    rfq: 0,
    sourcesSought: 0,
    preSol: 0,
    combined: 0,
    other: 0,
  };

  const keywordLower = (params.keywords || []).map(keyword => keyword.toLowerCase());
  const pageSize = 1000;

  try {
    for (let from = 0; ; from += pageSize) {
      const query = applySamCacheFilters(
        supabase
          .from('sam_opportunities')
          .select('notice_type,title,description')
          .order('response_deadline', { ascending: true })
          .range(from, from + pageSize - 1),
        params
      );

      const { data, error } = await query;
      if (error) {
        console.error('[SAM Cache] Notice summary query error:', error);
        return summary;
      }

      const rows = (data || []) as SAMCacheNoticeSummaryRow[];
      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        if (keywordLower.length > 0) {
          const text = `${row.title || ''} ${row.description || ''}`.toLowerCase();
          if (!keywordLower.some(keyword => text.includes(keyword))) {
            continue;
          }
        }

        summary.totalMatched++;
        summary[classifyNoticeType(row.notice_type)]++;
      }

      if (rows.length < pageSize) {
        break;
      }
    }

    return summary;
  } catch (error) {
    console.error('[SAM Cache] Error building notice summary:', error);
    return summary;
  }
}

/**
 * Fetch opportunities for a user - prefers cache, falls back to API
 */
export async function fetchOpportunitiesForUserCached(
  userProfile: {
    naics_codes: string[];
    agencies: string[];
    keywords: string[];
    zip_codes: string[];
    location_state?: string | null;
    location_states?: string[] | null;
  }
): Promise<SAMSearchResult> {
  // Build search params from user profile
  const params: SAMSearchParams = {
    naicsCodes: userProfile.naics_codes?.slice(0, 15) || [],
    keywords: userProfile.keywords?.slice(0, 10) || [],
    state: userProfile.location_state || undefined,
    states: userProfile.location_states?.slice(0, 10) || undefined,
    limit: 300,
  };

  // Query from cache (no API key needed!)
  return fetchSamOpportunitiesFromCache(params);
}

export type { SAMOpportunity, SAMSearchParams, SAMSearchResult, SAMNoticeSummary };
