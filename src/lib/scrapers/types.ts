/**
 * Multi-Site Aggregation - Core Types
 *
 * Shared types for the scraper framework.
 * All scrapers normalize data to ScrapedOpportunity format.
 */

// ============================================================================
// SCRAPED OPPORTUNITY - Normalized format for all sources
// ============================================================================

export interface ScrapedOpportunity {
  // Source tracking
  externalId: string;             // ID from source system
  source: SourceId;               // Which source this came from
  sourceUrl: string;              // Direct link to opportunity

  // Core data
  title: string;
  description?: string;
  agency: string;
  subAgency?: string;

  // Classification
  naicsCode?: string;
  pscCode?: string;
  setAside?: SetAsideType;
  opportunityType: OpportunityType;

  // Dates
  postedDate?: string;            // ISO 8601 format
  closeDate?: string;             // ISO 8601 format
  responseDate?: string;          // ISO 8601 format

  // Value
  estimatedValue?: number;        // In USD
  awardValue?: number;            // In USD (if awarded)

  // Location
  placeOfPerformance?: {
    state?: string;
    city?: string;
    zip?: string;
    country?: string;
  };

  // Contact
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  contractingOffice?: string;

  // Documents
  documentUrls?: string[];

  // Status
  status: OpportunityStatus;

  // Metadata
  rawData?: Record<string, unknown>;  // Original data for debugging
  scrapedAt: string;                   // ISO 8601 format
}

// ============================================================================
// SOURCE CONFIGURATION
// ============================================================================

export type SourceId =
  // Existing
  | 'sam_gov'
  | 'grants_gov'
  // Tier 1: High-Volume
  | 'dla_dibbs'
  | 'navy_neco'
  | 'unison'
  | 'acq_gateway'
  // Tier 2: Research/BAAs
  | 'nih_reporter'
  | 'darpa_baa'
  | 'nsf_sbir'
  // Tier 3: DOE National Labs
  | 'ornl'
  | 'lanl'
  | 'snl'
  | 'llnl'
  | 'pnnl'
  | 'inl'
  | 'anl'
  | 'bnl'
  | 'slac'
  | 'nrel'
  | 'pppl'
  | 'srnl'
  | 'jlab'
  | 'ames'
  | 'netl'
  | 'fnal'
  | 'lbnl';

export type ScraperType = 'api' | 'firecrawl' | 'rss' | 'browser';

export type SourceTier = 1 | 2 | 3;

export interface SourceConfig {
  id: SourceId;
  name: string;
  baseUrl: string;
  scraperType: ScraperType;
  tier: SourceTier;
  rateLimit: {
    perMinute: number;
    perDay: number;
  };
  config: Record<string, unknown>;
  isEnabled: boolean;
}

// ============================================================================
// OPPORTUNITY TYPES
// ============================================================================

export type OpportunityType =
  | 'solicitation'          // RFP, RFQ, IFB
  | 'presolicitation'       // Pre-sol notice
  | 'sources_sought'        // Sources Sought / RFI
  | 'combined_synopsis'     // Combined synopsis/solicitation
  | 'award'                 // Contract award notice
  | 'intent_to_award'       // Intent to sole source
  | 'modification'          // Contract modification
  | 'forecast'              // Planned procurement
  | 'baa'                   // Broad Agency Announcement
  | 'grant'                 // Grant opportunity
  | 'sbir_sttr'             // SBIR/STTR solicitation
  | 'reverse_auction'       // Reverse auction
  | 'other';

export type SetAsideType =
  | 'SBA'                   // Small Business
  | '8A'                    // 8(a)
  | 'WOSB'                  // Woman-Owned Small Business
  | 'EDWOSB'                // Economically Disadvantaged WOSB
  | 'SDVOSB'                // Service-Disabled Veteran-Owned
  | 'VOSB'                  // Veteran-Owned Small Business
  | 'HUBZone'               // HUBZone
  | 'SDB'                   // Small Disadvantaged Business
  | 'ISBEE'                 // Indian Small Business Economic Enterprise
  | 'AIAN'                  // Alaska Native/Indian
  | 'partial_set_aside'     // Partial set-aside
  | 'total_set_aside'       // Total set-aside
  | 'unrestricted'          // Full and open
  | null;

export type OpportunityStatus =
  | 'active'
  | 'awarded'
  | 'cancelled'
  | 'archived'
  | 'closed';

// ============================================================================
// SCRAPE RESULTS
// ============================================================================

export interface ScrapeResult {
  success: boolean;
  source: SourceId;
  opportunities: ScrapedOpportunity[];
  totalFound: number;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  errors?: ScrapeError[];
  durationMs: number;
  scrapedAt: string;
}

export interface ScrapeError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

// ============================================================================
// SEARCH PARAMETERS
// ============================================================================

export interface MultisiteSearchParams {
  // Filter by source
  sources?: SourceId[];
  excludeSources?: SourceId[];

  // Classification filters
  naicsCodes?: string[];
  pscCodes?: string[];
  setAsides?: SetAsideType[];
  opportunityTypes?: OpportunityType[];

  // Agency filters
  agencies?: string[];

  // Text search
  keywords?: string[];
  titleContains?: string;

  // Date filters
  postedFrom?: string;      // ISO 8601
  postedTo?: string;        // ISO 8601
  closingAfter?: string;    // ISO 8601
  closingBefore?: string;   // ISO 8601

  // Value filters
  minValue?: number;
  maxValue?: number;

  // Location filters
  states?: string[];

  // Status
  status?: OpportunityStatus[];

  // Pagination
  limit?: number;
  offset?: number;

  // Sorting
  sortBy?: 'posted_date' | 'close_date' | 'estimated_value' | 'relevance';
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// SCRAPER INTERFACE
// ============================================================================

export interface BaseScraper {
  readonly sourceId: SourceId;
  readonly config: SourceConfig;

  /**
   * Scrape opportunities from the source
   */
  scrape(params?: Record<string, unknown>): Promise<ScrapeResult>;

  /**
   * Get details for a specific opportunity
   */
  getOpportunityDetails(externalId: string): Promise<ScrapedOpportunity | null>;

  /**
   * Check if the source is healthy/accessible
   */
  healthCheck(): Promise<{ healthy: boolean; message?: string; responseTimeMs?: number }>;
}

// ============================================================================
// RATE LIMIT STATE
// ============================================================================

export interface RateLimitState {
  sourceId: SourceId;
  lastRequestAt: number;
  requestsToday: number;
  dayStart: number;
  isBlocked: boolean;
  blockedUntil?: number;
}

// ============================================================================
// SCRAPE LOG ENTRY
// ============================================================================

export interface ScrapeLogEntry {
  id?: string;
  sourceId: SourceId;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: 'running' | 'success' | 'partial' | 'failed';
  opportunitiesFound: number;
  opportunitiesNew: number;
  opportunitiesUpdated: number;
  opportunitiesUnchanged: number;
  errorMessage?: string;
  errorDetails?: Record<string, unknown>;
  triggeredBy: 'cron' | 'manual' | 'slash_command' | 'mcp';
  params?: Record<string, unknown>;
}

// ============================================================================
// SOURCE HEALTH
// ============================================================================

export interface SourceHealth {
  sourceId: SourceId;
  name: string;
  isEnabled: boolean;
  lastScrapeAt?: string;
  lastScrapeStatus?: 'success' | 'partial' | 'failed';
  lastScrapeCount?: number;
  consecutiveFailures: number;
  avgResponseTimeMs?: number;
  lastError?: string;
  lastErrorAt?: string;
}

export interface MultisiteHealthReport {
  generatedAt: string;
  totalSources: number;
  enabledSources: number;
  healthySources: number;
  warningSources: number;   // Stale data (>24h)
  failedSources: number;    // Consecutive failures > 3
  totalOpportunities: number;
  newLast24h: number;
  sources: SourceHealth[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert source tier to human-readable label
 */
export function tierLabel(tier: SourceTier): string {
  switch (tier) {
    case 1: return 'High-Volume';
    case 2: return 'Research/BAAs';
    case 3: return 'DOE Labs';
  }
}

/**
 * Get all source IDs by tier
 */
export function getSourcesByTier(tier: SourceTier): SourceId[] {
  const tierMap: Record<SourceTier, SourceId[]> = {
    1: ['dla_dibbs', 'navy_neco', 'unison', 'acq_gateway'],
    2: ['nih_reporter', 'darpa_baa', 'nsf_sbir'],
    3: ['ornl', 'lanl', 'snl', 'llnl', 'pnnl', 'inl', 'anl', 'bnl', 'slac', 'nrel', 'pppl', 'srnl', 'jlab', 'ames', 'netl', 'fnal', 'lbnl']
  };
  return tierMap[tier];
}

/**
 * Get human-readable source name
 */
export function getSourceName(sourceId: SourceId): string {
  const names: Record<SourceId, string> = {
    sam_gov: 'SAM.gov',
    grants_gov: 'Grants.gov',
    dla_dibbs: 'DLA DIBBS',
    navy_neco: 'Navy NECO',
    unison: 'Unison Marketplace',
    acq_gateway: 'Acquisition Gateway',
    nih_reporter: 'NIH RePORTER',
    darpa_baa: 'DARPA BAAs',
    nsf_sbir: 'NSF SBIR/STTR',
    ornl: 'Oak Ridge National Lab',
    lanl: 'Los Alamos National Lab',
    snl: 'Sandia National Labs',
    llnl: 'Lawrence Livermore National Lab',
    pnnl: 'Pacific Northwest National Lab',
    inl: 'Idaho National Lab',
    anl: 'Argonne National Lab',
    bnl: 'Brookhaven National Lab',
    slac: 'SLAC National Accelerator Lab',
    nrel: 'National Renewable Energy Lab',
    pppl: 'Princeton Plasma Physics Lab',
    srnl: 'Savannah River National Lab',
    jlab: 'Thomas Jefferson National Lab',
    ames: 'Ames National Lab',
    netl: 'National Energy Technology Lab',
    fnal: 'Fermi National Accelerator Lab',
    lbnl: 'Lawrence Berkeley National Lab'
  };
  return names[sourceId] || sourceId;
}

/**
 * Normalize opportunity type from various source formats
 */
export function normalizeOpportunityType(raw: string): OpportunityType {
  const normalized = raw.toLowerCase().trim();

  if (normalized.includes('presol') || normalized.includes('pre-sol')) {
    return 'presolicitation';
  }
  if (normalized.includes('source') || normalized.includes('rfi')) {
    return 'sources_sought';
  }
  if (normalized.includes('combined')) {
    return 'combined_synopsis';
  }
  if (normalized.includes('award') && !normalized.includes('intent')) {
    return 'award';
  }
  if (normalized.includes('intent') || normalized.includes('sole source')) {
    return 'intent_to_award';
  }
  if (normalized.includes('mod')) {
    return 'modification';
  }
  if (normalized.includes('forecast') || normalized.includes('planned')) {
    return 'forecast';
  }
  if (normalized.includes('baa') || normalized.includes('broad agency')) {
    return 'baa';
  }
  if (normalized.includes('grant')) {
    return 'grant';
  }
  if (normalized.includes('sbir') || normalized.includes('sttr')) {
    return 'sbir_sttr';
  }
  if (normalized.includes('auction')) {
    return 'reverse_auction';
  }
  if (normalized.includes('rfp') || normalized.includes('rfq') || normalized.includes('ifb') || normalized.includes('solicit')) {
    return 'solicitation';
  }

  return 'other';
}

/**
 * Normalize set-aside type from various source formats
 */
export function normalizeSetAside(raw: string | null | undefined): SetAsideType {
  if (!raw) return null;

  const normalized = raw.toUpperCase().trim();

  if (normalized.includes('8(A)') || normalized.includes('8A')) {
    return '8A';
  }
  if (normalized.includes('EDWOSB')) {
    return 'EDWOSB';
  }
  if (normalized.includes('WOSB')) {
    return 'WOSB';
  }
  if (normalized.includes('SDVOSB')) {
    return 'SDVOSB';
  }
  if (normalized.includes('VOSB') || normalized.includes('VETERAN')) {
    return 'VOSB';
  }
  if (normalized.includes('HUBZONE')) {
    return 'HUBZone';
  }
  if (normalized.includes('SDB')) {
    return 'SDB';
  }
  if (normalized.includes('ISBEE') || normalized.includes('INDIAN')) {
    return 'ISBEE';
  }
  if (normalized.includes('AIAN') || normalized.includes('ALASKA')) {
    return 'AIAN';
  }
  if (normalized.includes('PARTIAL')) {
    return 'partial_set_aside';
  }
  if (normalized.includes('TOTAL') && normalized.includes('SET')) {
    return 'total_set_aside';
  }
  if (normalized.includes('SBA') || normalized.includes('SMALL BUSINESS')) {
    return 'SBA';
  }
  if (normalized.includes('FULL') || normalized.includes('OPEN') || normalized.includes('UNRESTRICTED')) {
    return 'unrestricted';
  }

  return null;
}
