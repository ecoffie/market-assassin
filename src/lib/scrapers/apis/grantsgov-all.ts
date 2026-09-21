/**
 * Grants.gov Full Scraper
 *
 * Fetches ALL posted grants from Grants.gov, not just DARPA.
 * This is a major source of federal funding opportunities.
 *
 * Key Features:
 * - No authentication required (public API)
 * - Covers all federal agencies
 * - $700B+ in annual federal funding
 */

import {
  ScrapedOpportunity,
  ScrapeResult,
  ScrapeError,
  SourceId,
  normalizeOpportunityType,
} from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface GrantsGovGrant {
  oppNum: string;
  title: string;
  agency: string;
  agencyCode: string;
  status: string;
  type: string;
  openDate: string;
  closeDate: string;
  categories?: string[];
  link: string;
  description?: string;
  estimatedFunding?: number;
  awardCeiling?: number;
  awardFloor?: number;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export const GRANTSGOV_SOURCE_ID: SourceId = 'grants_gov';

// Agency code mappings for better labeling
const AGENCY_NAMES: Record<string, string> = {
  'DOD': 'Department of Defense',
  'HHS': 'Department of Health and Human Services',
  'DOE': 'Department of Energy',
  'NSF': 'National Science Foundation',
  'NASA': 'National Aeronautics and Space Administration',
  'USDA': 'Department of Agriculture',
  'DOC': 'Department of Commerce',
  'DOI': 'Department of the Interior',
  'DOJ': 'Department of Justice',
  'DOL': 'Department of Labor',
  'DOT': 'Department of Transportation',
  'ED': 'Department of Education',
  'EPA': 'Environmental Protection Agency',
  'DHS': 'Department of Homeland Security',
  'VA': 'Department of Veterans Affairs',
  'SBA': 'Small Business Administration',
  'DOS': 'Department of State',
};

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

export interface GrantsGovSearchParams {
  keywords?: string;
  agency?: string;
  category?: string;
  status?: 'posted' | 'forecasted' | 'closed' | 'archived';
  limit?: number;
}

/**
 * Search Grants.gov for all federal grants
 */
export async function searchGrantsGov(
  params: GrantsGovSearchParams = {}
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const errors: ScrapeError[] = [];

  try {
    // Grants.gov v1 API endpoint (search2)
    const baseUrl = 'https://api.grants.gov/v1/api/search2';

    // Build request body for POST
    const body: Record<string, unknown> = {
      rows: params.limit || 100,
      oppStatuses: params.status || 'posted'
    };

    if (params.keywords) {
      body.keyword = params.keywords;
    }
    if (params.agency) {
      body.agencies = params.agency;
    }
    if (params.category) {
      body.fundingCategories = params.category;
    }

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Grants.gov API error: ${response.status}`);
    }

    const data = await response.json();

    // Check for API errors
    if (data.errorcode !== 0) {
      throw new Error(data.msg || 'API error');
    }

    const grants = data.data?.oppHits || [];

    // Transform to our format
    const opportunities = grants.map((grant: Record<string, unknown>) =>
      transformGrantsGovOpportunity(formatGrantsGovResponse(grant))
    );

    return {
      success: true,
      source: GRANTSGOV_SOURCE_ID,
      opportunities,
      totalFound: data.data?.hitCount || grants.length,
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      errors: errors.length > 0 ? errors : undefined,
      durationMs: Date.now() - startTime,
      scrapedAt: new Date().toISOString()
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({
      code: 'GRANTSGOV_API_ERROR',
      message,
      retryable: true
    });

    return {
      success: false,
      source: GRANTSGOV_SOURCE_ID,
      opportunities: [],
      totalFound: 0,
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      errors,
      durationMs: Date.now() - startTime,
      scrapedAt: new Date().toISOString()
    };
  }
}

/**
 * Format Grants.gov API response to match expected interface
 */
function formatGrantsGovResponse(grant: Record<string, unknown>): GrantsGovGrant {
  return {
    oppNum: grant.number as string || '',
    title: grant.title as string || '',
    agency: (grant.agency || grant.agencyName) as string || '',
    agencyCode: grant.agencyCode as string || '',
    status: grant.oppStatus as string || '',
    type: grant.docType as string || '',
    openDate: grant.openDate as string || '',
    closeDate: grant.closeDate as string || '',
    categories: grant.cfdaList as string[] || [],
    link: `https://www.grants.gov/search-results-detail/${grant.id}`,
    description: grant.description as string,
    awardCeiling: grant.awardCeiling as number,
    awardFloor: grant.awardFloor as number
  };
}

/**
 * Fetch grants for specific agencies relevant to GovCon
 * Focuses on DOD, HHS, DOE, NASA, NSF which have the most small business opportunities
 */
export async function fetchGovConRelevantGrants(
  params: { limit?: number } = {}
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const errors: ScrapeError[] = [];
  const allOpportunities: ScrapedOpportunity[] = [];

  // Keywords that typically indicate small business / contractor opportunities
  const keywords = [
    'SBIR',
    'STTR',
    'small business',
    'BAA',
    'broad agency announcement',
    'research',
    'development',
  ];

  try {
    // Search with each keyword to maximize coverage
    for (const keyword of keywords.slice(0, 3)) { // Limit to avoid rate limits
      const result = await searchGrantsGov({
        keywords: keyword,
        status: 'posted',
        limit: params.limit || 50
      });

      if (result.success) {
        // Add unique opportunities (dedupe by oppNum)
        for (const opp of result.opportunities) {
          if (!allOpportunities.find(o => o.externalId === opp.externalId)) {
            allOpportunities.push(opp);
          }
        }
      } else if (result.errors) {
        errors.push(...result.errors);
      }

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return {
      success: true,
      source: GRANTSGOV_SOURCE_ID,
      opportunities: allOpportunities,
      totalFound: allOpportunities.length,
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      errors: errors.length > 0 ? errors : undefined,
      durationMs: Date.now() - startTime,
      scrapedAt: new Date().toISOString()
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({
      code: 'GRANTSGOV_FETCH_ERROR',
      message,
      retryable: true
    });

    return {
      success: false,
      source: GRANTSGOV_SOURCE_ID,
      opportunities: allOpportunities,
      totalFound: allOpportunities.length,
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      errors,
      durationMs: Date.now() - startTime,
      scrapedAt: new Date().toISOString()
    };
  }
}

/**
 * Health check for Grants.gov API
 */
export async function checkGrantsGovHealth(): Promise<{
  healthy: boolean;
  message?: string;
  responseTimeMs?: number;
}> {
  const startTime = Date.now();

  try {
    const response = await fetch('https://api.grants.gov/v1/api/search2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        keyword: 'test',
        rows: 1,
        oppStatuses: 'posted'
      })
    });

    const responseTimeMs = Date.now() - startTime;

    if (response.ok) {
      const data = await response.json();
      if (data.errorcode === 0) {
        return {
          healthy: true,
          message: 'Grants.gov API responding',
          responseTimeMs
        };
      }
      return {
        healthy: false,
        message: data.msg || 'API error',
        responseTimeMs
      };
    }

    return {
      healthy: false,
      message: `HTTP ${response.status}`,
      responseTimeMs
    };

  } catch (error) {
    return {
      healthy: false,
      message: error instanceof Error ? error.message : 'Connection failed',
      responseTimeMs: Date.now() - startTime
    };
  }
}

// ============================================================================
// TRANSFORMATION
// ============================================================================

/**
 * Transform Grants.gov opportunity to normalized ScrapedOpportunity
 */
function transformGrantsGovOpportunity(grant: GrantsGovGrant): ScrapedOpportunity {
  // Parse dates from MM/DD/YYYY format
  const parseDate = (dateStr: string): string | undefined => {
    if (!dateStr) return undefined;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
    }
    return dateStr;
  };

  // Extract parent agency from code
  const parentAgencyCode = grant.agencyCode?.split('-')[0] || '';
  const agencyName = AGENCY_NAMES[parentAgencyCode] || grant.agency;

  // Determine opportunity type from grant type
  let opportunityType: string = 'grant';
  const titleLower = grant.title.toLowerCase();
  const typeLower = (grant.type || '').toLowerCase();

  if (titleLower.includes('sbir') || titleLower.includes('sttr')) {
    opportunityType = 'sbir_sttr';
  } else if (titleLower.includes('baa') || titleLower.includes('broad agency')) {
    opportunityType = 'baa';
  } else if (typeLower.includes('synopsis')) {
    opportunityType = 'grant';
  }

  return {
    externalId: grant.oppNum,
    source: GRANTSGOV_SOURCE_ID,
    sourceUrl: grant.link,

    title: cleanHtmlEntities(grant.title),
    description: grant.description ? cleanHtmlEntities(grant.description) : undefined,
    agency: agencyName,
    subAgency: grant.agency !== agencyName ? grant.agency : undefined,

    opportunityType: normalizeOpportunityType(opportunityType),

    postedDate: parseDate(grant.openDate),
    closeDate: parseDate(grant.closeDate),

    estimatedValue: grant.awardCeiling || grant.estimatedFunding,

    status: grant.status === 'posted' ? 'active' :
            grant.status === 'closed' ? 'closed' :
            grant.status === 'archived' ? 'archived' :
            grant.status === 'forecasted' ? 'active' : 'active',

    rawData: {
      oppNum: grant.oppNum,
      agencyCode: grant.agencyCode,
      type: grant.type,
      categories: grant.categories,
      awardFloor: grant.awardFloor,
      awardCeiling: grant.awardCeiling
    },

    scrapedAt: new Date().toISOString()
  };
}

/**
 * Clean HTML entities from strings
 */
function cleanHtmlEntities(str: string): string {
  return str
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"');
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  AGENCY_NAMES
};
