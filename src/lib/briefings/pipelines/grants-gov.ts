/**
 * Grants.gov Pipeline
 *
 * Fetches grant opportunities from Grants.gov API
 * Complements SAM.gov contract opportunities for broader federal opportunity coverage
 */

export interface GrantOpportunity {
  oppNumber: string;
  title: string;
  agency: string;
  agencyCode: string;
  status: 'posted' | 'forecasted' | 'closed' | 'archived';
  openDate: string;
  closeDate: string;
  description: string;
  category: string;
  estimatedFunding: number | null;
  awardCeiling: number | null;
  awardFloor: number | null;
  expectedAwards: number | null;
  eligibility: string[];
  cfdaNumbers: string[];
  link: string;
  lastUpdated: string;
}

export interface GrantSearchParams {
  keyword?: string;
  agency?: string;
  status?: 'posted' | 'forecasted' | 'closed' | 'archived';
  category?: string;
  postedFrom?: string; // YYYY-MM-DD
  postedTo?: string;
  limit?: number;
}

export interface GrantSearchResult {
  grants: GrantOpportunity[];
  totalRecords: number;
  fetchedAt: string;
}

// Grants.gov API base URL
const GRANTS_API_BASE = 'https://apply07.grants.gov/grantsws/rest/opportunities';

// Map NAICS to grant categories (approximate)
const naicsToGrantCategory: Record<string, string[]> = {
  '541': ['Science and Technology', 'Business and Commerce'],
  '611': ['Education'],
  '621': ['Health'],
  '622': ['Health'],
  '623': ['Health'],
  '624': ['Income Security and Social Services'],
  '236': ['Community Development', 'Housing'],
  '237': ['Transportation', 'Community Development'],
  '238': ['Community Development'],
  '517': ['Science and Technology'],
  '518': ['Science and Technology'],
  '519': ['Science and Technology'],
};

/**
 * Search Grants.gov for opportunities
 */
export async function searchGrants(params: GrantSearchParams): Promise<GrantSearchResult> {
  const {
    keyword,
    agency,
    status = 'posted',
    category,
    postedFrom,
    postedTo,
    limit = 50,
  } = params;

  try {
    // Build search request body
    const searchBody: Record<string, unknown> = {
      oppStatuses: status === 'posted' ? 'posted' : status,
      rows: Math.min(limit, 100),
      sortBy: 'openDate|desc',
    };

    if (keyword) {
      searchBody.keyword = keyword;
    }

    if (agency) {
      searchBody.agency = agency;
    }

    if (category) {
      searchBody.fundingCategories = category;
    }

    if (postedFrom) {
      searchBody.openDateRange = `${postedFrom}|${postedTo || new Date().toISOString().split('T')[0]}`;
    }

    console.log(`[Grants.gov] Searching with params:`, JSON.stringify(searchBody));

    const response = await fetch(`${GRANTS_API_BASE}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(searchBody),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error(`[Grants.gov] API error: ${response.status}`);
      return { grants: [], totalRecords: 0, fetchedAt: new Date().toISOString() };
    }

    const data = await response.json();

    // Parse opportunities
    const grants: GrantOpportunity[] = (data.oppHits || []).map((opp: any) => ({
      oppNumber: opp.number || opp.id || '',
      title: opp.title || '',
      agency: opp.agency || '',
      agencyCode: opp.agencyCode || '',
      status: opp.oppStatus || 'posted',
      openDate: opp.openDate || '',
      closeDate: opp.closeDate || '',
      description: opp.synopsis || opp.description || '',
      category: opp.fundingCategory || '',
      estimatedFunding: parseNumber(opp.estimatedFunding),
      awardCeiling: parseNumber(opp.awardCeiling),
      awardFloor: parseNumber(opp.awardFloor),
      expectedAwards: parseNumber(opp.expectedNumberOfAwards),
      eligibility: parseEligibility(opp.eligibilities),
      cfdaNumbers: opp.cfdaNumbers || [],
      link: `https://www.grants.gov/search-results-detail/${opp.number || opp.id}`,
      lastUpdated: opp.lastUpdatedDate || opp.openDate || '',
    }));

    console.log(`[Grants.gov] Found ${grants.length} grants`);

    return {
      grants,
      totalRecords: data.totalOppHits || grants.length,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Grants.gov] Error:', error);
    return { grants: [], totalRecords: 0, fetchedAt: new Date().toISOString() };
  }
}

/**
 * Search grants using NAICS-based keyword inference
 */
export async function searchGrantsByNAICS(
  naicsCodes: string[],
  options?: { limit?: number; postedFrom?: string }
): Promise<GrantSearchResult> {
  // Convert NAICS to keywords
  const keywords = naicsCodes
    .slice(0, 5)
    .map(code => getNAICSKeyword(code))
    .filter(Boolean);

  if (keywords.length === 0) {
    return { grants: [], totalRecords: 0, fetchedAt: new Date().toISOString() };
  }

  // Search with combined keywords
  const keyword = keywords.join(' OR ');

  return searchGrants({
    keyword,
    status: 'posted',
    limit: options?.limit || 25,
    postedFrom: options?.postedFrom,
  });
}

/**
 * Score a grant opportunity for relevance
 */
export function scoreGrant(
  grant: GrantOpportunity,
  userProfile: {
    naics_codes: string[];
    keywords: string[];
    agencies: string[];
    business_description?: string | null;
  }
): number {
  let score = 0;

  // Keyword match in title/description
  const grantText = `${grant.title} ${grant.description}`.toLowerCase();

  // Check user keywords
  const keywordMatches = userProfile.keywords.filter(k =>
    grantText.includes(k.toLowerCase())
  ).length;
  score += keywordMatches * 15;

  const descriptionTerms = extractDescriptionTerms(userProfile.business_description);
  if (descriptionTerms.length > 0) {
    const descriptionMatches = descriptionTerms.filter(term => grantText.includes(term)).length;
    score += Math.min(descriptionMatches * 3, 15);
  }

  // Check NAICS-derived keywords
  for (const naics of userProfile.naics_codes.slice(0, 5)) {
    const naicsKeyword = getNAICSKeyword(naics);
    if (naicsKeyword && grantText.includes(naicsKeyword.toLowerCase())) {
      score += 20;
      break;
    }
  }

  // Agency match
  const grantAgency = grant.agency.toLowerCase();
  if (userProfile.agencies.some(a => grantAgency.includes(a.toLowerCase()))) {
    score += 25;
  }

  // Deadline urgency
  if (grant.closeDate) {
    const daysUntil = getDaysUntil(grant.closeDate);
    if (daysUntil <= 14) score += 15;
    else if (daysUntil <= 30) score += 10;
    else if (daysUntil <= 60) score += 5;
  }

  // Funding amount bonus (larger grants = more opportunity)
  if (grant.awardCeiling) {
    if (grant.awardCeiling >= 1000000) score += 10;
    else if (grant.awardCeiling >= 100000) score += 5;
  }

  return Math.min(score, 100);
}

// Helper functions
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

function parseNumber(value: any): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'string' ? parseFloat(value.replace(/[,$]/g, '')) : value;
  return isNaN(num) ? null : num;
}

function parseEligibility(eligibilities: any): string[] {
  if (!eligibilities) return [];
  if (Array.isArray(eligibilities)) return eligibilities;
  if (typeof eligibilities === 'string') return eligibilities.split(',').map(e => e.trim());
  return [];
}

function getNAICSKeyword(naics: string): string {
  // Map common NAICS to search keywords
  const naicsKeywords: Record<string, string> = {
    '541': 'professional services',
    '541511': 'software development',
    '541512': 'computer systems',
    '541519': 'IT services',
    '541611': 'management consulting',
    '541620': 'environmental consulting',
    '541330': 'engineering',
    '541380': 'testing laboratory',
    '541690': 'scientific consulting',
    '541720': 'research development',
    '611': 'education training',
    '611430': 'professional training',
    '621': 'healthcare',
    '622': 'hospital',
    '623': 'nursing care',
    '624': 'social services',
    '236': 'construction',
    '237': 'infrastructure',
    '238': 'specialty construction',
    '517': 'telecommunications',
    '518': 'data processing',
    '519': 'information services',
    '561': 'administrative services',
    '561210': 'facilities services',
    '562': 'waste management',
  };

  // Try exact match first
  if (naicsKeywords[naics]) return naicsKeywords[naics];

  // Try prefix match
  for (const [code, keyword] of Object.entries(naicsKeywords)) {
    if (naics.startsWith(code) || code.startsWith(naics)) {
      return keyword;
    }
  }

  return '';
}

function getDaysUntil(dateString: string): number {
  if (!dateString) return 999;
  const target = new Date(dateString);
  const diff = target.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
