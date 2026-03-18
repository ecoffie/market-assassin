/**
 * SAM.gov Opportunities Pipeline
 *
 * Fetches opportunities from SAM.gov API based on user's watchlist.
 * Returns solicitations, due dates, set-asides, and amendments.
 */

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
  state?: string; // State code for location filtering
}

interface SAMSearchResult {
  opportunities: SAMOpportunity[];
  totalRecords: number;
  fetchedAt: string;
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
  apiKey: string
): Promise<SAMOpportunity[]> {
  const queryParams = new URLSearchParams(baseParams);
  queryParams.set('api_key', apiKey);
  queryParams.set('ncode', naicsCode);

  const url = `${SAM_API_BASE}/search?${queryParams.toString()}`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`[SAM.gov] Error for NAICS ${naicsCode}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return (data.opportunitiesData || []).map((opp: any) => parseOpportunity(opp));
  } catch (error) {
    console.error(`[SAM.gov] Error fetching NAICS ${naicsCode}:`, error);
    return [];
  }
}

/**
 * Parse raw SAM.gov opportunity into our interface
 */
function parseOpportunity(opp: any): SAMOpportunity {
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
  } = params;

  // Build base query parameters (without NAICS - we'll add per-request)
  const baseParams = new URLSearchParams();
  baseParams.set('limit', String(Math.min(limit, 50))); // Cap per-request to 50
  baseParams.set('postedFrom', postedFrom || getDefaultPostedFrom());
  baseParams.set('postedTo', postedTo || getTodayDate());

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

  // Add state filter
  if (state) {
    baseParams.set('state', state);
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

  // Make parallel requests for each NAICS code (limit to first 5 to avoid rate limits)
  const codesToFetch = naicsCodes.slice(0, 5);
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
        seenIds.add(opp.noticeId);
        allOpportunities.push(opp);
      }
    }
  }

  console.log(`[SAM.gov] Retrieved ${allOpportunities.length} unique opportunities from ${codesToFetch.length} NAICS codes`);

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
  },
  apiKey: string
): Promise<SAMSearchResult> {
  // Build search params from user profile
  const params: SAMSearchParams = {
    naicsCodes: userProfile.naics_codes?.slice(0, 10) || [], // Limit to top 10
    keywords: userProfile.keywords?.slice(0, 5) || [],
    zipCodes: userProfile.zip_codes?.slice(0, 3) || [],
    // Posted in last 30 days for better coverage
    postedFrom: getDateDaysAgo(30),
    limit: 200,
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

export type { SAMOpportunity, SAMSearchParams, SAMSearchResult };
