/**
 * DARPA BAA Scraper
 *
 * Fetches DARPA Broad Agency Announcements from SAM.gov.
 * DARPA posts all BAAs to SAM.gov as the official source.
 *
 * Key Features:
 * - Uses SAM.gov Opportunities API
 * - Filters by DARPA as contracting agency
 * - Identifies BAAs vs regular solicitations
 * - Covers all DARPA offices (I2O, TTO, BTO, MTO, STO, DSO)
 */

import {
  ScrapedOpportunity,
  ScrapeResult,
  ScrapeError,
  SourceId,
  normalizeOpportunityType,
  normalizeSetAside,
} from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface SAMOpportunity {
  noticeId: string;
  title: string;
  solicitationNumber?: string;
  department?: string;
  subTier?: string;
  office?: string;
  postedDate?: string;
  responseDeadLine?: string;
  archiveDate?: string;
  type?: string;           // 'p' presol, 'o' solicitation, 'k' combined, etc.
  baseType?: string;
  setAside?: string;
  setAsideDescription?: string;
  naicsCode?: string;
  classificationCode?: string;  // PSC
  description?: string;
  organizationType?: string;
  additionalInfoLink?: string;
  uiLink?: string;
  officeAddress?: {
    city?: string;
    state?: string;
    zipcode?: string;
  };
  placeOfPerformance?: {
    city?: {
      name?: string;
    };
    state?: {
      code?: string;
    };
    zip?: string;
    country?: {
      code?: string;
    };
  };
  pointOfContact?: Array<{
    fax?: string;
    type?: string;
    email?: string;
    phone?: string;
    title?: string;
    fullName?: string;
  }>;
  award?: {
    date?: string;
    amount?: number;
    awardee?: {
      name?: string;
    };
  };
}

interface SAMSearchResponse {
  totalRecords?: number;
  opportunitiesData?: SAMOpportunity[];
  error?: {
    code?: string;
    message?: string;
  };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2/search';
const SOURCE_ID: SourceId = 'darpa_baa';
const DEFAULT_LIMIT = 100;

// DARPA office mappings
const DARPA_OFFICES = [
  'I2O',   // Information Innovation Office
  'TTO',   // Tactical Technology Office
  'BTO',   // Biological Technologies Office
  'MTO',   // Microsystems Technology Office
  'STO',   // Strategic Technology Office
  'DSO',   // Defense Sciences Office
];

// Notice type mappings
const NOTICE_TYPES = {
  'p': 'presolicitation',
  'o': 'solicitation',
  'k': 'combined_synopsis',
  'r': 'sources_sought',
  's': 'special_notice',
  'i': 'intent_to_award',
  'a': 'award',
};

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

export interface DARPASearchParams {
  keywords?: string;
  office?: string;           // DARPA office (I2O, TTO, BTO, etc.)
  noticeTypes?: string[];    // SAM notice type codes
  postedFrom?: string;       // YYYY-MM-DD
  postedTo?: string;         // YYYY-MM-DD
  limit?: number;
  offset?: number;
}

/**
 * Search SAM.gov for DARPA BAAs and opportunities
 */
export async function searchDARPABAAs(
  params: DARPASearchParams = {}
): Promise<ScrapeResult> {
  const startTime = Date.now();
  const errors: ScrapeError[] = [];

  // Check for API key
  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      source: SOURCE_ID,
      opportunities: [],
      totalFound: 0,
      newCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      errors: [{
        code: 'MISSING_API_KEY',
        message: 'SAM_API_KEY environment variable not set',
        retryable: false
      }],
      durationMs: Date.now() - startTime,
      scrapedAt: new Date().toISOString()
    };
  }

  try {
    // Build query parameters
    const queryParams = new URLSearchParams();

    // API key
    queryParams.set('api_key', apiKey);

    // Filter for DARPA
    queryParams.set('postedFrom', params.postedFrom || getDefaultPostedFrom());
    queryParams.set('postedTo', params.postedTo || formatDate(new Date()));

    // Search for DARPA in title/description
    // SAM.gov doesn't have a direct agency filter, so we search by keyword
    const searchKeywords = params.keywords
      ? `DARPA ${params.keywords}`
      : 'DARPA';
    queryParams.set('q', searchKeywords);

    // Notice types - default to active opportunity types
    const noticeTypes = params.noticeTypes || ['p', 'o', 'k', 'r', 's'];
    queryParams.set('ptype', noticeTypes.join(','));

    // Pagination
    queryParams.set('limit', (params.limit || DEFAULT_LIMIT).toString());
    if (params.offset) {
      queryParams.set('offset', params.offset.toString());
    }

    const url = `${SAM_API_BASE}?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SAM API error: ${response.status} - ${errorText}`);
    }

    const data: SAMSearchResponse = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'SAM API returned error');
    }

    // Filter results to only include DARPA opportunities
    const darpaOpps = (data.opportunitiesData || []).filter(opp => {
      const text = `${opp.title} ${opp.department} ${opp.subTier} ${opp.office}`.toUpperCase();
      return text.includes('DARPA') || text.includes('DEFENSE ADVANCED RESEARCH');
    });

    const opportunities = darpaOpps.map(opp => transformSAMOpportunity(opp));

    return {
      success: true,
      source: SOURCE_ID,
      opportunities,
      totalFound: darpaOpps.length,
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
      code: 'SAM_API_ERROR',
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
 * Get DARPA opportunities by specific office
 */
export async function searchDARPAByOffice(
  office: string,
  params: Omit<DARPASearchParams, 'office'> = {}
): Promise<ScrapeResult> {
  return searchDARPABAAs({
    ...params,
    keywords: `${office} ${params.keywords || ''}`.trim()
  });
}

/**
 * Health check for DARPA BAA scraper (via SAM.gov)
 */
export async function checkDARPAHealth(): Promise<{
  healthy: boolean;
  message?: string;
  responseTimeMs?: number;
}> {
  const startTime = Date.now();

  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    return {
      healthy: false,
      message: 'SAM_API_KEY not configured',
      responseTimeMs: Date.now() - startTime
    };
  }

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      q: 'DARPA',
      limit: '1',
      postedFrom: getDefaultPostedFrom(),
      postedTo: formatDate(new Date())
    });

    const response = await fetch(`${SAM_API_BASE}?${params.toString()}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    const responseTimeMs = Date.now() - startTime;

    if (response.ok) {
      const data: SAMSearchResponse = await response.json();
      return {
        healthy: true,
        message: `SAM.gov API responding. DARPA results available: ${data.totalRecords || 0}`,
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
 * Transform SAM.gov opportunity to normalized ScrapedOpportunity
 */
function transformSAMOpportunity(opp: SAMOpportunity): ScrapedOpportunity {
  // Determine opportunity type from notice type
  const noticeType = opp.type?.toLowerCase() || opp.baseType?.toLowerCase() || '';
  let opportunityType = NOTICE_TYPES[noticeType as keyof typeof NOTICE_TYPES] || 'solicitation';

  // If it's a BAA, mark as BAA type
  const title = (opp.title || '').toUpperCase();
  if (title.includes('BAA') || title.includes('BROAD AGENCY ANNOUNCEMENT')) {
    opportunityType = 'baa';
  }

  // Primary contact
  const primaryContact = opp.pointOfContact?.find(c => c.type === 'primary') || opp.pointOfContact?.[0];

  // Build source URL
  const sourceUrl = opp.uiLink ||
    `https://sam.gov/opp/${opp.noticeId}/view`;

  return {
    externalId: opp.noticeId,
    source: SOURCE_ID,
    sourceUrl,

    title: opp.title || 'Untitled',
    description: opp.description,
    agency: 'Defense Advanced Research Projects Agency (DARPA)',
    subAgency: opp.office || opp.subTier,

    naicsCode: opp.naicsCode,
    pscCode: opp.classificationCode,
    setAside: normalizeSetAside(opp.setAside || opp.setAsideDescription),
    opportunityType: normalizeOpportunityType(opportunityType),

    postedDate: opp.postedDate,
    closeDate: opp.responseDeadLine,

    estimatedValue: opp.award?.amount,

    placeOfPerformance: opp.placeOfPerformance ? {
      state: opp.placeOfPerformance.state?.code,
      city: opp.placeOfPerformance.city?.name,
      zip: opp.placeOfPerformance.zip,
      country: opp.placeOfPerformance.country?.code
    } : opp.officeAddress ? {
      state: opp.officeAddress.state,
      city: opp.officeAddress.city,
      zip: opp.officeAddress.zipcode
    } : undefined,

    contact: primaryContact ? {
      name: primaryContact.fullName,
      email: primaryContact.email,
      phone: primaryContact.phone
    } : undefined,

    contractingOffice: opp.office,

    documentUrls: opp.additionalInfoLink ? [opp.additionalInfoLink] : undefined,

    status: opp.archiveDate && new Date(opp.archiveDate) < new Date() ? 'archived' : 'active',

    rawData: {
      solicitationNumber: opp.solicitationNumber,
      department: opp.department,
      subTier: opp.subTier,
      noticeType: opp.type,
      organizationType: opp.organizationType
    },

    scrapedAt: new Date().toISOString()
  };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get default posted from date (90 days ago)
 */
function getDefaultPostedFrom(): string {
  const date = new Date();
  date.setDate(date.getDate() - 90);
  return formatDate(date);
}

/**
 * Format date as MM/dd/yyyy for SAM.gov API
 */
function formatDate(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  SOURCE_ID as DARPA_SOURCE_ID,
  DARPA_OFFICES
};
