// USASpending API Fetcher
// Fetches contract patterns, agency spending, and procurement trends
// API: https://api.usaspending.gov/api/v2

import { AgencyIntelligence, FetcherOptions } from '../types';

const USASPENDING_API = 'https://api.usaspending.gov/api/v2';

/**
 * Fetch agency spending patterns from USASpending
 */
export async function fetchAgencySpendingPatterns(
  options: FetcherOptions = {}
): Promise<AgencyIntelligence[]> {
  const { fiscalYear = new Date().getFullYear(), limit = 200, dryRun = false } = options;

  const results: AgencyIntelligence[] = [];

  console.log(`[USASpending] Fetching agency spending patterns for FY${fiscalYear}...`);

  if (dryRun) {
    console.log('[USASpending] Dry run - would fetch spending data');
    return [];
  }

  try {
    // Fetch toptier agencies with spending data
    const response = await fetch(`${USASPENDING_API}/references/toptier_agencies/`);

    if (!response.ok) {
      throw new Error(`USASpending API error: ${response.status}`);
    }

    const data = await response.json();
    const agencies = data.results || [];

    console.log(`[USASpending] Found ${agencies.length} toptier agencies`);

    for (const agency of agencies.slice(0, limit)) {
      // Create contract pattern intelligence
      results.push({
        agency_name: agency.agency_name,
        agency_code: agency.toptier_code,
        intelligence_type: 'contract_pattern',
        title: `FY${fiscalYear} Contract Spending: ${agency.agency_name}`,
        description: `Total obligated: $${(agency.budget_authority_amount / 1_000_000_000).toFixed(1)}B. Congressional justification outlay: $${(agency.current_total_budget_authority_amount / 1_000_000_000).toFixed(1)}B`,
        keywords: ['spending', 'contracts', 'procurement', 'budget'],
        fiscal_year: fiscalYear,
        source_name: 'USASpending API',
        source_url: `https://www.usaspending.gov/agency/${agency.agency_slug}`,
      });
    }
  } catch (error) {
    console.error('[USASpending] Error fetching agency spending:', error);
  }

  return results;
}

/**
 * Fetch NAICS spending by agency for a specific NAICS code
 */
export async function fetchNAICSSpending(
  naicsCode: string,
  options: FetcherOptions = {}
): Promise<AgencyIntelligence[]> {
  const { fiscalYear = new Date().getFullYear(), limit = 20, dryRun = false } = options;

  const results: AgencyIntelligence[] = [];

  console.log(`[USASpending] Fetching NAICS ${naicsCode} spending for FY${fiscalYear}...`);

  if (dryRun) {
    console.log('[USASpending] Dry run - would fetch NAICS spending');
    return [];
  }

  try {
    // Use spending by award endpoint filtered by NAICS
    const response = await fetch(`${USASPENDING_API}/search/spending_by_award/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          time_period: [
            {
              start_date: `${fiscalYear - 1}-10-01`,
              end_date: `${fiscalYear}-09-30`,
            },
          ],
          naics_codes: [naicsCode],
          award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
        },
        fields: [
          'Award ID',
          'Recipient Name',
          'Award Amount',
          'Awarding Agency',
          'Awarding Sub Agency',
          'Description',
        ],
        page: 1,
        limit: limit,
        sort: 'Award Amount',
        order: 'desc',
      }),
    });

    if (!response.ok) {
      throw new Error(`USASpending API error: ${response.status}`);
    }

    const data = await response.json();
    const awards = data.results || [];

    console.log(`[USASpending] Found ${awards.length} awards for NAICS ${naicsCode}`);

    // Group by agency
    const agencyAwards: Record<string, typeof awards> = {};
    for (const award of awards) {
      const agencyName = award['Awarding Agency'] || 'Unknown';
      if (!agencyAwards[agencyName]) {
        agencyAwards[agencyName] = [];
      }
      agencyAwards[agencyName].push(award);
    }

    // Create contract pattern for each agency
    for (const [agencyName, agencyData] of Object.entries(agencyAwards)) {
      const totalValue = agencyData.reduce((sum: number, a: Record<string, unknown>) => sum + (Number(a['Award Amount']) || 0), 0);
      const contractors = [...new Set(agencyData.map((a: Record<string, unknown>) => String(a['Recipient Name'])))];

      results.push({
        agency_name: agencyName,
        intelligence_type: 'contract_pattern',
        title: `NAICS ${naicsCode} Procurement Pattern`,
        description: `${agencyData.length} contracts totaling $${(totalValue / 1_000_000).toFixed(1)}M. Top contractors: ${contractors.slice(0, 3).join(', ')}`,
        keywords: [naicsCode, 'procurement', 'contract pattern', 'spending'],
        fiscal_year: fiscalYear,
        source_name: 'USASpending API',
        source_url: `https://www.usaspending.gov/search?naics=${naicsCode}`,
      });
    }
  } catch (error) {
    console.error('[USASpending] Error fetching NAICS spending:', error);
  }

  return results;
}

/**
 * Fetch subtier agencies for a toptier agency
 */
export async function fetchSubtierAgencies(
  toptierCode: string,
  options: FetcherOptions = {}
): Promise<AgencyIntelligence[]> {
  const { dryRun = false } = options;

  const results: AgencyIntelligence[] = [];

  console.log(`[USASpending] Fetching subtier agencies for ${toptierCode}...`);

  if (dryRun) {
    return [];
  }

  try {
    const response = await fetch(
      `${USASPENDING_API}/references/subtier_agencies/?toptier_agency=${toptierCode}`
    );

    if (!response.ok) {
      throw new Error(`USASpending API error: ${response.status}`);
    }

    const data = await response.json();
    const subtiers = data.results || [];

    console.log(`[USASpending] Found ${subtiers.length} subtier agencies`);

    for (const sub of subtiers) {
      results.push({
        agency_name: sub.subtier_agency_name,
        agency_code: sub.subtier_code,
        parent_agency: sub.toptier_agency_name,
        intelligence_type: 'contract_pattern',
        title: `${sub.subtier_agency_name} Organization`,
        description: `Subtier agency under ${sub.toptier_agency_name}`,
        source_name: 'USASpending API',
        source_url: `https://www.usaspending.gov/agency/${sub.toptier_agency_name}`,
      });
    }
  } catch (error) {
    console.error('[USASpending] Error fetching subtier agencies:', error);
  }

  return results;
}

export default {
  fetchAgencySpendingPatterns,
  fetchNAICSSpending,
  fetchSubtierAgencies,
};
