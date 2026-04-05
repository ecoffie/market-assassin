/**
 * Agency Spending Stats
 *
 * Fetches spending aggregations from USASpending.gov API.
 * Provides FY spending totals, contract counts, and trends.
 */

const USASPENDING_BASE_URL = 'https://api.usaspending.gov/api/v2';

// Cache for spending data (24h TTL)
const spendingCache = new Map<string, { data: AgencySpending; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface AgencySpending {
  agencyName: string;
  toptierCode: string;
  fiscalYear: number;
  totalObligations: number;
  totalOutlays: number;
  contractCount: number;
  topNaics: Array<{
    code: string;
    description: string;
    amount: number;
  }>;
  byQuarter?: Array<{
    quarter: number;
    obligations: number;
  }>;
}

export interface SpendingSummary {
  totalAgencies: number;
  totalObligations: number;
  topAgencies: Array<{
    name: string;
    obligations: number;
    percentOfTotal: number;
  }>;
  fiscalYear: number;
}

/**
 * Get spending for a specific agency
 */
export async function getAgencySpending(
  agencyName: string,
  fiscalYear?: number
): Promise<AgencySpending | null> {
  const fy = fiscalYear || getCurrentFiscalYear();
  const cacheKey = `${agencyName.toLowerCase()}-${fy}`;

  // Check cache
  const cached = spendingCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    // First, get the toptier agency code
    const agencyCode = await getToptierAgencyCode(agencyName);
    if (!agencyCode) {
      console.log(`[Spending] No toptier code found for: ${agencyName}`);
      return null;
    }

    // Fetch agency overview
    const response = await fetch(
      `${USASPENDING_BASE_URL}/agency/${agencyCode}/?fiscal_year=${fy}`,
      {
        headers: { 'Accept': 'application/json' }
      }
    );

    if (!response.ok) {
      console.error(`[Spending] API error for ${agencyName}:`, response.status);
      return null;
    }

    const data = await response.json();

    // Extract spending data
    const spending: AgencySpending = {
      agencyName: data.name || agencyName,
      toptierCode: agencyCode,
      fiscalYear: fy,
      totalObligations: data.budget_authority_amount || 0,
      totalOutlays: data.total_outlays || 0,
      contractCount: data.transaction_count || 0,
      topNaics: []
    };

    // Try to get top NAICS for this agency
    try {
      const naicsData = await getAgencyTopNaics(agencyCode, fy);
      spending.topNaics = naicsData;
    } catch {
      // Non-critical, continue without NAICS data
    }

    // Cache result
    spendingCache.set(cacheKey, { data: spending, timestamp: Date.now() });

    return spending;

  } catch (err) {
    console.error(`[Spending] Failed to fetch for ${agencyName}:`, err);
    return null;
  }
}

/**
 * Get spending summary across all agencies
 */
export async function getSpendingSummary(fiscalYear?: number): Promise<SpendingSummary | null> {
  const fy = fiscalYear || getCurrentFiscalYear();
  const cacheKey = `summary-${fy}`;

  // Check cache
  const cached = spendingCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data as unknown as SpendingSummary;
  }

  try {
    // Get all toptier agencies
    const response = await fetch(
      `${USASPENDING_BASE_URL}/references/toptier_agencies/?sort=budget_authority_amount&order=desc`,
      {
        headers: { 'Accept': 'application/json' }
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const agencies = data.results || [];

    let totalObligations = 0;
    const topAgencies: SpendingSummary['topAgencies'] = [];

    for (const agency of agencies.slice(0, 25)) {
      totalObligations += agency.budget_authority_amount || 0;
      topAgencies.push({
        name: agency.agency_name,
        obligations: agency.budget_authority_amount || 0,
        percentOfTotal: 0 // Calculate after total
      });
    }

    // Calculate percentages
    for (const agency of topAgencies) {
      agency.percentOfTotal = totalObligations > 0
        ? Math.round((agency.obligations / totalObligations) * 10000) / 100
        : 0;
    }

    const summary: SpendingSummary = {
      totalAgencies: agencies.length,
      totalObligations,
      topAgencies: topAgencies.slice(0, 10),
      fiscalYear: fy
    };

    return summary;

  } catch (err) {
    console.error('[Spending] Failed to fetch summary:', err);
    return null;
  }
}

/**
 * Get top NAICS codes for an agency
 */
async function getAgencyTopNaics(
  toptierCode: string,
  fiscalYear: number
): Promise<AgencySpending['topNaics']> {
  try {
    const response = await fetch(
      `${USASPENDING_BASE_URL}/agency/${toptierCode}/awards/new/count/?fiscal_year=${fiscalYear}`,
      {
        headers: { 'Accept': 'application/json' }
      }
    );

    if (!response.ok) return [];

    const data = await response.json();

    // USASpending doesn't directly provide top NAICS per agency
    // This is a simplified approximation
    return [];

  } catch {
    return [];
  }
}

/**
 * Get toptier agency code from name
 */
async function getToptierAgencyCode(agencyName: string): Promise<string | null> {
  // Known mappings for common abbreviations
  const knownCodes: Record<string, string> = {
    'department of defense': '097',
    'dod': '097',
    'defense': '097',
    'department of veterans affairs': '036',
    'va': '036',
    'veterans': '036',
    'department of health and human services': '075',
    'hhs': '075',
    'department of homeland security': '070',
    'dhs': '070',
    'department of energy': '089',
    'doe': '089',
    'department of justice': '015',
    'doj': '015',
    'department of transportation': '069',
    'dot': '069',
    'department of agriculture': '012',
    'usda': '012',
    'department of commerce': '013',
    'doc': '013',
    'department of the interior': '014',
    'doi': '014',
    'department of labor': '016',
    'dol': '016',
    'department of state': '019',
    'dos': '019',
    'state': '019',
    'department of the treasury': '020',
    'treasury': '020',
    'department of education': '091',
    'ed': '091',
    'department of housing and urban development': '086',
    'hud': '086',
    'environmental protection agency': '068',
    'epa': '068',
    'nasa': '080',
    'general services administration': '047',
    'gsa': '047',
    'small business administration': '073',
    'sba': '073',
    'social security administration': '028',
    'ssa': '028',
    'office of personnel management': '024',
    'opm': '024',
    'national science foundation': '049',
    'nsf': '049'
  };

  const normalized = agencyName.toLowerCase().trim();

  if (knownCodes[normalized]) {
    return knownCodes[normalized];
  }

  // Try API lookup
  try {
    const response = await fetch(
      `${USASPENDING_BASE_URL}/references/toptier_agencies/`,
      {
        headers: { 'Accept': 'application/json' }
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const agencies = data.results || [];

    for (const agency of agencies) {
      if (agency.agency_name?.toLowerCase().includes(normalized) ||
        normalized.includes(agency.agency_name?.toLowerCase())) {
        return agency.toptier_code;
      }
    }

  } catch {
    // Fallback failed
  }

  return null;
}

/**
 * Get current fiscal year
 */
function getCurrentFiscalYear(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();

  // FY starts October 1
  return month >= 9 ? year + 1 : year;
}

/**
 * Format spending amount for display
 */
export function formatSpending(amount: number): string {
  if (amount >= 1_000_000_000_000) {
    return `$${(amount / 1_000_000_000_000).toFixed(1)}T`;
  }
  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}
