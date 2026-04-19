// IT Dashboard API Fetcher
// Fetches federal IT investment data from itdashboard.gov
// API: https://myit-api.cio.gov/v1

import { AgencyIntelligence, ITDashboardInvestment, FetcherOptions } from '../types';

const IT_DASHBOARD_API = 'https://myit-api.cio.gov/v1';

// CFO Act agencies that report to IT Dashboard
const CFO_ACT_AGENCIES = [
  { code: '005', name: 'Department of Agriculture', abbr: 'USDA' },
  { code: '006', name: 'Department of Commerce', abbr: 'DOC' },
  { code: '007', name: 'Department of Defense', abbr: 'DOD' },
  { code: '009', name: 'Department of Education', abbr: 'ED' },
  { code: '010', name: 'Department of Energy', abbr: 'DOE' },
  { code: '011', name: 'Department of Health and Human Services', abbr: 'HHS' },
  { code: '012', name: 'Department of Homeland Security', abbr: 'DHS' },
  { code: '014', name: 'Department of Housing and Urban Development', abbr: 'HUD' },
  { code: '015', name: 'Department of the Interior', abbr: 'DOI' },
  { code: '016', name: 'Department of Justice', abbr: 'DOJ' },
  { code: '017', name: 'Department of Labor', abbr: 'DOL' },
  { code: '019', name: 'Department of State', abbr: 'DOS' },
  { code: '020', name: 'Department of Transportation', abbr: 'DOT' },
  { code: '021', name: 'Department of the Treasury', abbr: 'TREAS' },
  { code: '024', name: 'Office of Personnel Management', abbr: 'OPM' },
  { code: '026', name: 'Social Security Administration', abbr: 'SSA' },
  { code: '027', name: 'National Aeronautics and Space Administration', abbr: 'NASA' },
  { code: '028', name: 'Agency for International Development', abbr: 'USAID' },
  { code: '029', name: 'Environmental Protection Agency', abbr: 'EPA' },
  { code: '031', name: 'Nuclear Regulatory Commission', abbr: 'NRC' },
  { code: '033', name: 'Small Business Administration', abbr: 'SBA' },
  { code: '036', name: 'Department of Veterans Affairs', abbr: 'VA' },
  { code: '047', name: 'General Services Administration', abbr: 'GSA' },
  { code: '080', name: 'National Science Foundation', abbr: 'NSF' },
];

/**
 * Fetch IT investments from IT Dashboard API
 */
export async function fetchITInvestments(
  options: FetcherOptions = {}
): Promise<AgencyIntelligence[]> {
  const { agency, limit = 100, dryRun = false } = options;

  const results: AgencyIntelligence[] = [];
  const agenciesToFetch = agency
    ? CFO_ACT_AGENCIES.filter(a =>
        a.name.toLowerCase().includes(agency.toLowerCase()) ||
        a.abbr.toLowerCase() === agency.toLowerCase()
      )
    : CFO_ACT_AGENCIES;

  console.log(`[IT Dashboard] Fetching IT investments for ${agenciesToFetch.length} agencies...`);

  if (dryRun) {
    console.log(`[IT Dashboard] Dry run - would fetch from ${IT_DASHBOARD_API}`);
    return [];
  }

  for (const agencyInfo of agenciesToFetch) {
    try {
      // Fetch major IT investments for this agency
      const url = `${IT_DASHBOARD_API}/ITDB2/dataFeeds/MajorITInvestmentByAgency?agencyCode=${agencyInfo.code}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        console.warn(`[IT Dashboard] Failed to fetch ${agencyInfo.abbr}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const investments: ITDashboardInvestment[] = data.result || [];

      console.log(`[IT Dashboard] ${agencyInfo.abbr}: ${investments.length} investments`);

      // Only include high-risk or high-priority investments
      const significantInvestments = investments.filter(inv =>
        inv.RiskLevel === 'High' ||
        inv.CIOPriority === 'Yes' ||
        inv.TotalLifecycleCost > 100_000_000
      ).slice(0, limit);

      for (const inv of significantInvestments) {
        results.push({
          agency_name: agencyInfo.name,
          agency_code: agencyInfo.code,
          intelligence_type: 'it_investment',
          title: inv.InvestmentName,
          description: inv.Description || `${inv.InvestmentName} - ${inv.RiskLevel} risk, $${(inv.TotalLifecycleCost / 1_000_000).toFixed(1)}M lifecycle cost`,
          keywords: extractITKeywords(inv.InvestmentName, inv.Description),
          fiscal_year: new Date().getFullYear(),
          source_name: 'IT Dashboard API',
          source_url: `https://itdashboard.gov/drupal/summary/${inv.InvestmentID}`,
        });
      }

      // Rate limit: 100ms between agencies
      await new Promise(r => setTimeout(r, 100));

    } catch (error) {
      console.error(`[IT Dashboard] Error fetching ${agencyInfo.abbr}:`, error);
    }
  }

  console.log(`[IT Dashboard] Total: ${results.length} significant IT investments`);
  return results;
}

/**
 * Fetch CIO priorities and IT challenges
 */
export async function fetchCIOPriorities(
  options: FetcherOptions = {}
): Promise<AgencyIntelligence[]> {
  const { dryRun = false } = options;

  const results: AgencyIntelligence[] = [];

  console.log('[IT Dashboard] Fetching CIO priorities...');

  if (dryRun) {
    console.log('[IT Dashboard] Dry run - would fetch CIO priorities');
    return [];
  }

  try {
    // Fetch CIO IT Spend data
    const url = `${IT_DASHBOARD_API}/ITDB2/dataFeeds/ITSpendByAgency`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`IT Dashboard API error: ${response.status}`);
    }

    const data = await response.json();
    const spendData = data.result || [];

    for (const item of spendData) {
      const agencyInfo = CFO_ACT_AGENCIES.find(a => a.code === item.AgencyCode);
      if (!agencyInfo) continue;

      // Create pain point from IT spend trends
      if (item.CloudSpend && item.DataCenterSpend) {
        results.push({
          agency_name: agencyInfo.name,
          agency_code: agencyInfo.code,
          intelligence_type: 'pain_point',
          title: 'Cloud Migration and Data Center Optimization',
          description: `${agencyInfo.abbr} IT spend: $${(item.TotalSpend / 1_000_000_000).toFixed(1)}B total, ${((item.CloudSpend / item.TotalSpend) * 100).toFixed(0)}% cloud, ${((item.DataCenterSpend / item.TotalSpend) * 100).toFixed(0)}% data center`,
          keywords: ['cloud', 'data center', 'IT modernization', 'infrastructure'],
          fiscal_year: new Date().getFullYear(),
          source_name: 'IT Dashboard API',
          source_url: `https://itdashboard.gov/drupal/Agency/${agencyInfo.abbr}`,
        });
      }
    }
  } catch (error) {
    console.error('[IT Dashboard] Error fetching CIO priorities:', error);
  }

  return results;
}

function extractITKeywords(name: string, description?: string): string[] {
  const text = `${name} ${description || ''}`.toLowerCase();
  const keywords: string[] = [];

  const itTerms = [
    'cloud', 'cybersecurity', 'modernization', 'legacy', 'data center',
    'ai', 'artificial intelligence', 'machine learning', 'automation',
    'erp', 'crm', 'hrms', 'financial system', 'grants management',
    'network', 'infrastructure', 'security', 'zero trust',
    'saas', 'paas', 'iaas', 'devops', 'agile',
  ];

  for (const term of itTerms) {
    if (text.includes(term)) {
      keywords.push(term);
    }
  }

  return keywords.slice(0, 10);
}

export default {
  fetchITInvestments,
  fetchCIOPriorities,
};
