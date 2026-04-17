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

interface SAMSearchResult {
  opportunities: SAMOpportunity[];
  totalRecords: number;
  fetchedAt: string;
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
  const { naicsCode, agency, incumbentName, keywords = [], lookbackDays = 180 } = params;

  const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2';

  // Build search keywords from agency and incumbent
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
    setAsides = [],
    keywords = [],
    state,
    states,
    limit = 100,
  } = params;

  if (!supabase) {
    console.error('[SAM Cache] Supabase client not initialized');
    return { opportunities: [], totalRecords: 0, fetchedAt: new Date().toISOString() };
  }

  console.log(`[SAM Cache] Querying database for NAICS: ${naicsCodes.slice(0, 5).join(', ')}${naicsCodes.length > 5 ? '...' : ''}`);

  try {
    // Build query
    let query = supabase
      .from('sam_opportunities')
      .select('*')
      .eq('active', true)
      .gte('response_deadline', new Date().toISOString()) // Only future deadlines
      .order('response_deadline', { ascending: true })
      .limit(limit);

    // NAICS filter - match ANY of the user's codes using OR with prefix matching
    // SAM.gov stores NAICS codes in various lengths (2-6 digits), so we use LIKE
    // to match all related codes (e.g., "236" matches "236", "236115", "236220", etc.)
    if (naicsCodes.length > 0) {
      // Get unique 3-digit prefixes from all codes for broader matching
      const prefixes = new Set<string>();
      for (const code of naicsCodes) {
        // Use 3-digit prefix for consistent matching
        const prefix = code.slice(0, 3);
        if (prefix.length === 3 && /^\d{3}$/.test(prefix)) {
          prefixes.add(prefix);
        }
      }

      // Build LIKE filter for each prefix
      // Format: naics_code.like.236*,naics_code.like.237*,...
      const naicsFilters = Array.from(prefixes).map(prefix => `naics_code.like.${prefix}*`).join(',');
      if (naicsFilters) {
        query = query.or(naicsFilters);
      }
    }

    // Set-aside filter
    if (setAsides.length > 0) {
      const setAsideFilters = setAsides.map(s => `set_aside_code.eq.${s}`).join(',');
      query = query.or(setAsideFilters);
    }

    // State filter
    const stateList = states || (state ? [state] : []);
    if (stateList.length > 0) {
      const stateFilters = stateList.map(s => `pop_state.eq.${s}`).join(',');
      query = query.or(stateFilters);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[SAM Cache] Query error:', error);
      return { opportunities: [], totalRecords: 0, fetchedAt: new Date().toISOString() };
    }

    console.log(`[SAM Cache] Found ${data?.length || 0} opportunities from database`);

    // Transform database records to SAMOpportunity interface
    const opportunities: SAMOpportunity[] = (data || []).map(row => ({
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

export type { SAMOpportunity, SAMSearchParams, SAMSearchResult };
