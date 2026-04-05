/**
 * NIH RePORTER API Client
 *
 * Fetches funding opportunities and active projects from NIH RePORTER.
 * API: https://api.reporter.nih.gov/v2/projects/search
 *
 * Key Features:
 * - No authentication required (public API)
 * - RESTful JSON API
 * - Supports text search, fiscal year, agency, activity code filters
 * - Returns up to 10,000 results per query
 */

import {
  ScrapedOpportunity,
  ScrapeResult,
  ScrapeError,
  normalizeOpportunityType,
} from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface NIHSearchCriteria {
  advanced_text_search?: {
    search_field?: string;      // 'projecttitle,terms,abstract'
    search_text: string;
    operator?: 'and' | 'or';
  };
  fiscal_years?: number[];
  agencies?: string[];           // NIH institutes: NCI, NIAID, NIMH, etc.
  activity_codes?: string[];     // R01, R21, R43, etc.
  award_types?: string[];        // 1=new, 2=renewal, 3=supplement, etc.
  pi_names?: Array<{
    first_name?: string;
    last_name: string;
  }>;
  org_names?: string[];
  org_states?: string[];
  funding_mechanism?: string[];  // 'Research Grants', 'Contracts'
  is_active?: boolean;
  spending_categories?: string[];
  covid_response?: boolean;
}

interface NIHSearchRequest {
  criteria: NIHSearchCriteria;
  limit?: number;               // Max 500 per request
  offset?: number;
  sort_field?: string;          // 'project_start_date', 'award_amount', etc.
  sort_order?: 'asc' | 'desc';
}

export interface NIHProject {
  appl_id: number;
  project_num: string;          // e.g., "1R01CA123456-01"
  project_title: string;
  abstract_text?: string;
  agency_ic_fundings?: Array<{
    fy: number;
    total_cost: number;
    name: string;                // Institute name
    code: string;                // Institute code (NCI, etc.)
  }>;
  award_amount?: number;
  award_notice_date?: string;
  budget_start?: string;
  budget_end?: string;
  contact_pi_name?: string;
  pis?: Array<{
    first_name: string;
    last_name: string;
    profile_id: number;
    is_contact_pi?: boolean;
  }>;
  organization?: {
    org_name: string;
    org_city?: string;
    org_state?: string;
    org_zipcode?: string;
    org_country?: string;
  };
  project_start_date?: string;
  project_end_date?: string;
  spending_categories?: string[];
  terms?: string;
  funding_mechanism?: string;
  opportunity_number?: string;  // FOA number if applicable
  is_active?: boolean;
}

export interface NIHSearchResponse {
  meta: {
    search_id: string;
    total: number;
    offset: number;
    limit: number;
    properties: {
      URL: string;
    };
  };
  results: NIHProject[];
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const NIH_API_BASE = 'https://api.reporter.nih.gov/v2';
const SOURCE_ID = 'nih_reporter' as const;
const MAX_RESULTS_PER_REQUEST = 500;
const DEFAULT_LIMIT = 100;

// Common NIH institutes for GovCon opportunities
const NIH_INSTITUTES = [
  'NCI',    // National Cancer Institute
  'NIAID',  // National Institute of Allergy and Infectious Diseases
  'NHLBI',  // National Heart, Lung, and Blood Institute
  'NIMH',   // National Institute of Mental Health
  'NIDA',   // National Institute on Drug Abuse
  'NINDS',  // National Institute of Neurological Disorders and Stroke
  'NICHD',  // National Institute of Child Health and Human Development
  'NIGMS',  // National Institute of General Medical Sciences
  'NIEHS',  // National Institute of Environmental Health Sciences
  'NIA',    // National Institute on Aging
];

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

export interface NIHSearchParams {
  keywords?: string;
  agencies?: string[];          // NIH institute codes
  fiscalYears?: number[];
  activityCodes?: string[];     // R01, R21, R43 (SBIR Phase I), etc.
  states?: string[];
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Search NIH RePORTER for projects/opportunities
 */
export async function searchNIHProjects(
  params: NIHSearchParams = {}
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const errors: ScrapeError[] = [];

  try {
    // Build search criteria
    const criteria: NIHSearchCriteria = {};

    // Text search
    if (params.keywords) {
      criteria.advanced_text_search = {
        search_field: 'projecttitle,terms,abstract',
        search_text: params.keywords,
        operator: 'and'
      };
    }

    // Fiscal years - default to current and next
    const currentYear = new Date().getFullYear();
    criteria.fiscal_years = params.fiscalYears || [currentYear, currentYear + 1];

    // Agencies
    if (params.agencies && params.agencies.length > 0) {
      criteria.agencies = params.agencies;
    }

    // Activity codes (e.g., R43 for SBIR Phase I)
    if (params.activityCodes && params.activityCodes.length > 0) {
      criteria.activity_codes = params.activityCodes;
    }

    // State filter
    if (params.states && params.states.length > 0) {
      criteria.org_states = params.states;
    }

    // Active projects only
    if (params.isActive !== undefined) {
      criteria.is_active = params.isActive;
    }

    // Build request
    const request: NIHSearchRequest = {
      criteria,
      limit: Math.min(params.limit || DEFAULT_LIMIT, MAX_RESULTS_PER_REQUEST),
      offset: params.offset || 0,
      sort_field: 'award_notice_date',
      sort_order: 'desc'
    };

    // Make API call
    const response = await fetch(`${NIH_API_BASE}/projects/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NIH API error: ${response.status} - ${errorText}`);
    }

    const data: NIHSearchResponse = await response.json();

    // Transform to normalized format
    const opportunities = data.results.map(project => transformNIHProject(project));

    return {
      success: true,
      source: SOURCE_ID,
      opportunities,
      totalFound: data.meta.total,
      newCount: 0,      // Will be calculated during upsert
      updatedCount: 0,
      unchangedCount: 0,
      errors: errors.length > 0 ? errors : undefined,
      durationMs: Date.now() - startTime,
      scrapedAt: new Date().toISOString()
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    errors.push({
      code: 'NIH_API_ERROR',
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
 * Search for SBIR/STTR opportunities specifically
 */
export async function searchNIHSBIR(
  params: Omit<NIHSearchParams, 'activityCodes'> = {}
): Promise<ScrapeResult> {
  return searchNIHProjects({
    ...params,
    activityCodes: [
      'R43',  // SBIR Phase I
      'R44',  // SBIR Phase II
      'R41',  // STTR Phase I
      'R42',  // STTR Phase II
    ]
  });
}

/**
 * Get details for a specific project
 */
export async function getNIHProjectDetails(
  projectNumber: string
): Promise<ScrapedOpportunity | null> {
  try {
    const response = await fetch(`${NIH_API_BASE}/projects/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        criteria: {
          project_nums: [projectNumber]
        },
        limit: 1,
        offset: 0
      })
    });

    if (!response.ok) {
      return null;
    }

    const data: NIHSearchResponse = await response.json();

    if (data.results.length === 0) {
      return null;
    }

    return transformNIHProject(data.results[0]);

  } catch {
    return null;
  }
}

/**
 * Health check for NIH API
 */
export async function checkNIHHealth(): Promise<{
  healthy: boolean;
  message?: string;
  responseTimeMs?: number;
}> {
  const startTime = Date.now();

  try {
    const response = await fetch(`${NIH_API_BASE}/projects/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        criteria: {
          fiscal_years: [new Date().getFullYear()]
        },
        limit: 1,
        offset: 0
      })
    });

    const responseTimeMs = Date.now() - startTime;

    if (response.ok) {
      const data: NIHSearchResponse = await response.json();
      return {
        healthy: true,
        message: `API responding. Total projects: ${data.meta.total.toLocaleString()}`,
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
 * Transform NIH project to normalized ScrapedOpportunity
 */
function transformNIHProject(project: NIHProject): ScrapedOpportunity {
  // Determine agency from institute codes
  const primaryInstitute = project.agency_ic_fundings?.[0];
  const agency = primaryInstitute
    ? `NIH - ${primaryInstitute.name}`
    : 'National Institutes of Health';

  // Calculate total value from all funding sources
  const totalValue = project.agency_ic_fundings?.reduce(
    (sum, f) => sum + (f.total_cost || 0),
    0
  ) || project.award_amount;

  // Build source URL
  const sourceUrl = `https://reporter.nih.gov/project-details/${project.appl_id}`;

  // Get PI contact info
  const contactPi = project.pis?.find(pi => pi.is_contact_pi) || project.pis?.[0];

  // Determine opportunity type
  let opportunityType = 'grant';
  const projectNum = project.project_num?.toUpperCase() || '';
  if (projectNum.includes('R43') || projectNum.includes('R41')) {
    opportunityType = 'sbir_sttr';
  } else if (projectNum.includes('R44') || projectNum.includes('R42')) {
    opportunityType = 'sbir_sttr';
  } else if (projectNum.includes('HHSN') || projectNum.includes('75N')) {
    opportunityType = 'solicitation';  // Contract
  }

  return {
    externalId: project.appl_id.toString(),
    source: SOURCE_ID,
    sourceUrl,

    title: project.project_title || 'Untitled Project',
    description: project.abstract_text || undefined,
    agency,
    subAgency: primaryInstitute?.name || undefined,

    naicsCode: '541714',  // Research and Development in Biotechnology
    opportunityType: normalizeOpportunityType(opportunityType),

    postedDate: project.award_notice_date || project.budget_start || undefined,
    closeDate: project.budget_end || undefined,

    estimatedValue: totalValue || undefined,

    placeOfPerformance: project.organization ? {
      state: project.organization.org_state,
      city: project.organization.org_city,
      zip: project.organization.org_zipcode,
      country: project.organization.org_country
    } : undefined,

    contact: contactPi ? {
      name: `${contactPi.first_name} ${contactPi.last_name}`.trim(),
    } : undefined,

    contractingOffice: project.organization?.org_name,

    status: project.is_active ? 'active' : 'archived',

    rawData: {
      project_num: project.project_num,
      opportunity_number: project.opportunity_number,
      funding_mechanism: project.funding_mechanism,
      spending_categories: project.spending_categories,
      terms: project.terms
    },

    scrapedAt: new Date().toISOString()
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  NIH_INSTITUTES,
  SOURCE_ID as NIH_SOURCE_ID
};

// Note: All types are exported via `export interface` above
