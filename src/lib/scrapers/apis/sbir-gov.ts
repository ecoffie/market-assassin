/**
 * SBIR.gov API Client
 *
 * Fetches SBIR/STTR solicitations and awards from SBIR.gov.
 * API: https://api.www.sbir.gov/public/api/
 *
 * Key Features:
 * - No authentication required (public API)
 * - Covers ALL agencies (NSF, DOE, DOD, NIH, etc.)
 * - Awards and Solicitations endpoints
 * - Supports agency, year, keyword filtering
 */

import {
  ScrapedOpportunity,
  ScrapeResult,
  ScrapeError,
  SourceId,
} from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface SBIRSolicitation {
  solicitation_id: string;
  title: string;
  agency: string;
  branch?: string;
  program: 'SBIR' | 'STTR';
  phase: string;
  topic_code?: string;
  topic_title?: string;
  description?: string;
  open_date?: string;
  close_date?: string;
  url?: string;
  poc_name?: string;
  poc_email?: string;
  poc_phone?: string;
}

interface SBIRAward {
  award_id: string;
  award_title: string;
  agency: string;
  branch?: string;
  program: 'SBIR' | 'STTR';
  phase: string;
  award_year: number;
  award_amount?: number;
  firm: string;
  city?: string;
  state?: string;
  zip?: string;
  abstract?: string;
  pi_name?: string;
  pi_email?: string;
  research_keywords?: string;
  solicitation_year?: number;
  contract?: string;
  hubzone_owned?: string;
  socially_economically_disadvantaged?: string;
  woman_owned?: string;
}

interface SBIRResponse {
  results?: SBIRSolicitation[] | SBIRAward[];
  totalRecords?: number;
  error?: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const SBIR_API_BASE = 'https://api.www.sbir.gov/public/api';
const SOURCE_ID: SourceId = 'nsf_sbir';  // Using nsf_sbir as the source ID for all SBIR data
const DEFAULT_LIMIT = 100;
const MAX_ROWS = 400;

// Agency mappings
const AGENCY_MAP: Record<string, string> = {
  'DOD': 'Department of Defense',
  'DOE': 'Department of Energy',
  'HHS': 'Department of Health and Human Services',
  'NASA': 'National Aeronautics and Space Administration',
  'NSF': 'National Science Foundation',
  'USDA': 'Department of Agriculture',
  'EPA': 'Environmental Protection Agency',
  'DOC': 'Department of Commerce',
  'ED': 'Department of Education',
  'DOT': 'Department of Transportation',
  'DHS': 'Department of Homeland Security',
};

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

export interface SBIRSearchParams {
  agency?: string;           // Agency code (DOD, NSF, DOE, etc.)
  year?: number;             // Award year
  keywords?: string;         // Search keywords
  firm?: string;             // Company name
  state?: string;            // State code
  phase?: string;            // Phase I, Phase II
  limit?: number;
  offset?: number;
}

/**
 * Search SBIR.gov for solicitations
 */
export async function searchSBIRSolicitations(
  params: SBIRSearchParams = {}
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const errors: ScrapeError[] = [];

  try {
    // Build query parameters
    const queryParams = new URLSearchParams();

    if (params.agency) {
      queryParams.set('agency', params.agency);
    }
    if (params.keywords) {
      queryParams.set('keyword', params.keywords);
    }
    if (params.year) {
      queryParams.set('year', params.year.toString());
    }

    queryParams.set('rows', Math.min(params.limit || DEFAULT_LIMIT, MAX_ROWS).toString());
    if (params.offset) {
      queryParams.set('start', params.offset.toString());
    }

    const url = `${SBIR_API_BASE}/solicitations?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`SBIR API error: ${response.status}`);
    }

    const data: SBIRResponse = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    const solicitations = (data.results || []) as SBIRSolicitation[];
    const opportunities = solicitations.map(sol => transformSolicitation(sol));

    return {
      success: true,
      source: SOURCE_ID,
      opportunities,
      totalFound: data.totalRecords || opportunities.length,
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
      code: 'SBIR_API_ERROR',
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
 * Search SBIR.gov for recent awards
 * Useful for competitive intelligence on who's winning
 */
export async function searchSBIRAwards(
  params: SBIRSearchParams = {}
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const errors: ScrapeError[] = [];

  try {
    const queryParams = new URLSearchParams();

    if (params.agency) {
      queryParams.set('agency', params.agency);
    }
    if (params.keywords) {
      queryParams.set('keyword', params.keywords);
    }
    if (params.year) {
      queryParams.set('year', params.year.toString());
    }
    if (params.firm) {
      queryParams.set('firm', params.firm);
    }
    if (params.state) {
      queryParams.set('state', params.state);
    }

    queryParams.set('rows', Math.min(params.limit || DEFAULT_LIMIT, MAX_ROWS).toString());
    if (params.offset) {
      queryParams.set('start', params.offset.toString());
    }

    const url = `${SBIR_API_BASE}/awards?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`SBIR API error: ${response.status}`);
    }

    const data: SBIRResponse = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    const awards = (data.results || []) as SBIRAward[];
    const opportunities = awards.map(award => transformAward(award));

    return {
      success: true,
      source: SOURCE_ID,
      opportunities,
      totalFound: data.totalRecords || opportunities.length,
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
      code: 'SBIR_API_ERROR',
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
 * Search NSF SBIR/STTR specifically
 */
export async function searchNSFSBIR(
  params: Omit<SBIRSearchParams, 'agency'> = {}
): Promise<ScrapeResult> {
  return searchSBIRSolicitations({
    ...params,
    agency: 'NSF'
  });
}

/**
 * Health check for SBIR.gov API
 */
export async function checkSBIRHealth(): Promise<{
  healthy: boolean;
  message?: string;
  responseTimeMs?: number;
}> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${SBIR_API_BASE}/awards?rows=1`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    const responseTimeMs = Date.now() - startTime;

    if (response.ok) {
      const data: SBIRResponse = await response.json();
      return {
        healthy: true,
        message: `API responding. Total records: ${data.totalRecords?.toLocaleString() || 'unknown'}`,
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
 * Transform SBIR solicitation to normalized ScrapedOpportunity
 */
function transformSolicitation(sol: SBIRSolicitation): ScrapedOpportunity {
  const agencyName = AGENCY_MAP[sol.agency] || sol.agency;

  return {
    externalId: sol.solicitation_id,
    source: SOURCE_ID,
    sourceUrl: sol.url || `https://www.sbir.gov/node/${sol.solicitation_id}`,

    title: sol.topic_title || sol.title,
    description: sol.description,
    agency: agencyName,
    subAgency: sol.branch,

    naicsCode: '541715',  // R&D in Physical/Engineering/Life Sciences
    opportunityType: 'sbir_sttr',

    postedDate: sol.open_date,
    closeDate: sol.close_date,

    contact: sol.poc_name ? {
      name: sol.poc_name,
      email: sol.poc_email,
      phone: sol.poc_phone
    } : undefined,

    status: 'active',

    rawData: {
      program: sol.program,
      phase: sol.phase,
      topic_code: sol.topic_code
    },

    scrapedAt: new Date().toISOString()
  };
}

/**
 * Transform SBIR award to normalized ScrapedOpportunity
 * Awards are stored as "awarded" status for competitive intelligence
 */
function transformAward(award: SBIRAward): ScrapedOpportunity {
  const agencyName = AGENCY_MAP[award.agency] || award.agency;

  // Determine set-aside type from award flags
  let setAside = null;
  if (award.woman_owned === 'Y') setAside = 'WOSB';
  if (award.hubzone_owned === 'Y') setAside = 'HUBZone';
  if (award.socially_economically_disadvantaged === 'Y') setAside = 'SDB';

  return {
    externalId: award.award_id || award.contract || `${award.agency}-${award.award_year}-${award.firm}`,
    source: SOURCE_ID,
    sourceUrl: `https://www.sbir.gov/sbirsearch/detail/${award.award_id}`,

    title: award.award_title,
    description: award.abstract,
    agency: agencyName,
    subAgency: award.branch,

    naicsCode: '541715',
    setAside: setAside as ScrapedOpportunity['setAside'],
    opportunityType: 'sbir_sttr',

    postedDate: `${award.award_year}-01-01`,  // Approximate from year

    estimatedValue: award.award_amount,
    awardValue: award.award_amount,

    placeOfPerformance: {
      state: award.state,
      city: award.city,
      zip: award.zip
    },

    contact: award.pi_name ? {
      name: award.pi_name,
      email: award.pi_email
    } : undefined,

    contractingOffice: award.firm,

    status: 'awarded',

    rawData: {
      program: award.program,
      phase: award.phase,
      contract: award.contract,
      research_keywords: award.research_keywords,
      solicitation_year: award.solicitation_year
    },

    scrapedAt: new Date().toISOString()
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  SOURCE_ID as SBIR_SOURCE_ID,
  AGENCY_MAP as SBIR_AGENCIES
};
