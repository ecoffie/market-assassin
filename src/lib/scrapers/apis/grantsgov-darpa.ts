/**
 * Grants.gov DARPA Scraper
 *
 * Fetches DARPA BAAs and opportunities from Grants.gov.
 * Grants.gov is a more reliable source for DARPA opportunities than SAM.gov.
 *
 * Key Features:
 * - No authentication required (public API)
 * - Covers all DARPA offices (DSO, BTO, TTO, I2O, MTO, STO)
 * - Direct links to full opportunity details
 * - Better structured data than SAM.gov for research opportunities
 */

import {
  ScrapedOpportunity,
  ScrapeResult,
  ScrapeError,
  SourceId,
  normalizeOpportunityType,
} from '../types';
import { darpaHitsFromSearch, darpaSearchBody, DARPA_GRANTS_SEARCH_URL, type DarpaGrantHit } from './darpa-grants-search';

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

interface GrantsGovSearchResponse {
  totalRecords: number;
  returned: number;
  grants: GrantsGovGrant[];
  error?: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const SOURCE_ID: SourceId = 'darpa_baa';

// DARPA agency codes on Grants.gov
const DARPA_AGENCY_CODES = [
  'DOD-DARPA-DSO',  // Defense Sciences Office
  'DOD-DARPA-BTO',  // Biological Technologies Office
  'DOD-DARPA-TTO',  // Tactical Technology Office
  'DOD-DARPA-I2O',  // Information Innovation Office
  'DOD-DARPA-MTO',  // Microsystems Technology Office
  'DOD-DARPA-STO',  // Strategic Technology Office
];

// Map agency codes to human-readable names
const DARPA_OFFICE_NAMES: Record<string, string> = {
  'DOD-DARPA-DSO': 'Defense Sciences Office (DSO)',
  'DOD-DARPA-BTO': 'Biological Technologies Office (BTO)',
  'DOD-DARPA-TTO': 'Tactical Technology Office (TTO)',
  'DOD-DARPA-I2O': 'Information Innovation Office (I2O)',
  'DOD-DARPA-MTO': 'Microsystems Technology Office (MTO)',
  'DOD-DARPA-STO': 'Strategic Technology Office (STO)',
  'DOD-DARPA-IPTO': 'Information Processing Techniques Office (IPTO)',
};

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

export interface DARPAGrantsSearchParams {
  keywords?: string;
  office?: string;           // DARPA office code
  status?: 'posted' | 'forecasted' | 'closed' | 'archived';
  limit?: number;
}

/**
 * Search Grants.gov for DARPA BAAs
 * Uses the Grants.gov MCP tool internally
 */
export async function searchDARPAFromGrantsGov(
  params: DARPAGrantsSearchParams = {}
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const errors: ScrapeError[] = [];

  try {
    // Build search URL for Grants.gov API
    const baseUrl = 'https://www.grants.gov/grantsws/rest/opportunities/search/';

    // Search parameters
    const searchParams = new URLSearchParams();
    searchParams.set('keyword', params.keywords ? `DARPA ${params.keywords}` : 'DARPA');
    searchParams.set('oppStatuses', params.status || 'posted');
    searchParams.set('rows', (params.limit || 50).toString());
    searchParams.set('sortBy', 'openDate|desc');

    const response = await fetch(`${baseUrl}?${searchParams.toString()}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Grants.gov API error: ${response.status}`);
    }

    const data = await response.json();

    // Filter to only DARPA opportunities
    const darpaGrants = (data.oppHits || []).filter((grant: { agencyCode?: string; agency?: string }) => {
      return DARPA_AGENCY_CODES.some(code => grant.agencyCode?.includes(code)) ||
             grant.agency?.toUpperCase().includes('DARPA');
    });

    const opportunities = darpaGrants.map((grant: GrantsGovGrant) => transformGrantsGovOpportunity(grant));

    return {
      success: true,
      source: SOURCE_ID,
      opportunities,
      totalFound: darpaGrants.length,
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
      source: SOURCE_ID,
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

function hitToGrant(hit: DarpaGrantHit): GrantsGovGrant {
  return {
    oppNum: hit.number,
    title: hit.title,
    agency: hit.agency,
    agencyCode: hit.agencyCode,
    status: hit.oppStatus,
    // Grants.gov labels these "synopsis". They are DARPA research announcements
    // (office-wide BAAs and YFA). The collector's source id is darpa_baa.
    type: 'baa',
    openDate: hit.openDate,
    closeDate: hit.closeDate,
    link: hit.id ? `https://www.grants.gov/search-results-detail/${hit.id}` : DARPA_GRANTS_SEARCH_URL,
  };
}

/**
 * Fetch open DARPA opportunities from Grants.gov search2.
 * No hardcoded opportunity list. A failed or empty search is success:false.
 */
export async function fetchDARPAOpportunities(
  params: DARPAGrantsSearchParams = {}
): Promise<ScrapeResult> {
  void params;
  const startTime = Date.now();
  const errors: ScrapeError[] = [];

  try {
    const response = await fetch(DARPA_GRANTS_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(darpaSearchBody()),
    });
    if (!response.ok) {
      throw new Error(`Grants.gov search2 HTTP ${response.status}`);
    }
    const parsed = darpaHitsFromSearch(await response.json());
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    const opportunities = parsed.hits.map((hit) => transformGrantsGovOpportunity(hitToGrant(hit)));
    return {
      success: true,
      source: SOURCE_ID,
      opportunities,
      totalFound: parsed.hitCount ?? opportunities.length,
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      durationMs: Date.now() - startTime,
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({
      code: 'DARPA_FETCH_ERROR',
      message,
      retryable: true
    });

    return {
      success: false,
      source: SOURCE_ID,
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
 * Health check for DARPA scraper
 */
export async function checkDARPAGrantsHealth(): Promise<{
  healthy: boolean;
  message?: string;
  responseTimeMs?: number;
}> {
  const startTime = Date.now();

  try {
    // Simple connectivity test to Grants.gov
    const response = await fetch('https://www.grants.gov/grantsws/rest/opportunities/search/?keyword=DARPA&rows=1', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    const responseTimeMs = Date.now() - startTime;

    if (response.ok) {
      return {
        healthy: true,
        message: 'Grants.gov API responding for DARPA search',
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

  // Get office name from agency code
  const officeName = DARPA_OFFICE_NAMES[grant.agencyCode] || grant.agency;

  return {
    externalId: grant.oppNum,
    source: SOURCE_ID,
    sourceUrl: grant.link,

    title: grant.title,
    description: grant.description,
    agency: 'Defense Advanced Research Projects Agency (DARPA)',
    subAgency: officeName,

    opportunityType: normalizeOpportunityType(grant.type || 'baa'),

    postedDate: parseDate(grant.openDate),
    closeDate: parseDate(grant.closeDate),

    estimatedValue: grant.awardCeiling || grant.estimatedFunding,

    status: grant.status === 'posted' ? 'active' :
            grant.status === 'closed' ? 'closed' :
            grant.status === 'archived' ? 'archived' : 'active',

    rawData: {
      oppNum: grant.oppNum,
      agencyCode: grant.agencyCode,
      type: grant.type,
      categories: grant.categories
    },

    scrapedAt: new Date().toISOString()
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  DARPA_AGENCY_CODES,
  DARPA_OFFICE_NAMES
};
