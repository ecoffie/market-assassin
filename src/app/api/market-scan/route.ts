/**
 * Market Scan API
 *
 * Comprehensive market intelligence for NAICS + location.
 * Returns spending analysis, visibility gap, and ranked opportunities.
 *
 * GET /api/market-scan?naics=541512&state=FL
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  industryNames,
  naicsExpansion,
  getStateFromZip,
  getBorderingStates,
} from '@/lib/utils/usaspending-helpers';

// ============================================================================
// TYPES
// ============================================================================

interface MarketScanParams {
  naics: string;
  state?: string;
  zipCode?: string;
  years?: number;
  includeGrants?: boolean;
  includeSbir?: boolean;
  setAside?: string;
}

interface AgencySpending {
  agency: string;
  subAgency?: string;
  spending: number;
  awards: number;
  percentOfTotal: number;
  trend: 'up' | 'down' | 'stable';
}

interface Opportunity {
  id: string;
  title: string;
  agency: string;
  value?: number;
  closeDate?: string;
  setAside?: string;
  source: 'sam.gov' | 'forecast' | 'grants.gov' | 'nih_reporter' | 'recompete';
  score?: number;
  daysUntilClose?: number;
  link?: string;
}

interface GapAnalysis {
  totalSpending: number;
  samPostedValue: number;
  gapAmount: number;
  gapPercentage: number;
  interpretation: 'hidden_market' | 'partial_visibility' | 'well_covered';
  interpretationText: string;
}

interface MarketScanResult {
  success: boolean;
  naics: string;
  naicsDescription: string;
  state?: string;
  states?: string[];
  analysisDate: string;

  // Summary
  summary: {
    threeYearSpending: number;
    totalAwards: number;
    visibilityGap: number;
    marketType: 'concentrated' | 'distributed' | 'niche' | 'robust';
    trend: 'growing' | 'stable' | 'declining';
    trendPercent: number;
  };

  // Detailed sections
  topAgencies: AgencySpending[];
  gapAnalysis: GapAnalysis;

  // Opportunities by category
  samOpportunities: Opportunity[];
  forecasts: Opportunity[];
  grants: Opportunity[];
  sbirOpportunities: Opportunity[];
  recompetes: Opportunity[];

  // All opportunities ranked
  rankedOpportunities: Opportunity[];

  // Metadata
  dataSources: string[];
  generatedAt: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get NAICS description from code
 */
function getNaicsDescription(code: string): string {
  // Check exact match first
  if (industryNames[code]) {
    return industryNames[code];
  }

  // Try prefix matches
  for (let i = code.length - 1; i >= 2; i--) {
    const prefix = code.substring(0, i);
    if (industryNames[prefix]) {
      return industryNames[prefix];
    }
  }

  return `NAICS ${code}`;
}

/**
 * Determine market type based on agency distribution
 */
function determineMarketType(
  agencies: AgencySpending[],
  totalSpending: number
): 'concentrated' | 'distributed' | 'niche' | 'robust' {
  if (totalSpending < 10_000_000) {
    return 'niche';
  }

  if (agencies.length === 0) {
    return 'niche';
  }

  const topAgencyPercent = agencies[0]?.percentOfTotal || 0;

  if (topAgencyPercent > 60) {
    return 'concentrated';
  }

  if (agencies.length > 10 && topAgencyPercent < 30) {
    return 'distributed';
  }

  return 'robust';
}

/**
 * Calculate days until close date
 */
function daysUntilClose(closeDate: string | undefined): number | undefined {
  if (!closeDate) return undefined;

  const close = new Date(closeDate);
  const now = new Date();
  const diffTime = close.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays > 0 ? diffDays : 0;
}

/**
 * Score an opportunity for ranking
 */
function scoreOpportunity(
  opp: Opportunity,
  userSetAside?: string
): number {
  let score = 50; // Base score

  // Value boost (larger contracts = higher score)
  if (opp.value) {
    if (opp.value > 10_000_000) score += 20;
    else if (opp.value > 1_000_000) score += 15;
    else if (opp.value > 100_000) score += 10;
    else if (opp.value > 25_000) score += 5;
  }

  // Urgency boost (closing soon = higher score)
  if (opp.daysUntilClose !== undefined) {
    if (opp.daysUntilClose <= 7) score += 25;
    else if (opp.daysUntilClose <= 14) score += 15;
    else if (opp.daysUntilClose <= 30) score += 10;
  }

  // Set-aside match boost
  if (userSetAside && opp.setAside) {
    const userLower = userSetAside.toLowerCase();
    const oppLower = opp.setAside.toLowerCase();
    if (
      oppLower.includes(userLower) ||
      userLower.includes(oppLower) ||
      oppLower.includes('small business')
    ) {
      score += 15;
    }
  }

  // Source type boost
  switch (opp.source) {
    case 'sam.gov':
      score += 10; // Active solicitations
      break;
    case 'recompete':
      score += 8; // Good planning opportunity
      break;
    case 'forecast':
      score += 5; // Future planning
      break;
    case 'grants.gov':
      score += 3;
      break;
    case 'nih_reporter':
      score += 3;
      break;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Format currency for display
 */
function formatCurrency(amount: number): string {
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

// ============================================================================
// DATA FETCHING FUNCTIONS
// ============================================================================

/**
 * Expand NAICS code to full list if it's a sector/subsector prefix
 */
function expandNaicsCode(naics: string): string[] {
  // If it's already a 6-digit code, return as-is
  if (naics.length === 6) {
    return [naics];
  }

  // Check for expansion mapping
  const expanded = naicsExpansion[naics];
  if (expanded && expanded.length > 0) {
    return expanded;
  }

  // Try 3-digit prefix expansion
  if (naics.length >= 3) {
    const prefix3 = naics.substring(0, 3);
    const expanded3 = naicsExpansion[prefix3];
    if (expanded3 && expanded3.length > 0) {
      return expanded3;
    }
  }

  // Try 2-digit sector expansion
  if (naics.length >= 2) {
    const prefix2 = naics.substring(0, 2);
    const expanded2 = naicsExpansion[prefix2];
    if (expanded2 && expanded2.length > 0) {
      return expanded2;
    }
  }

  // Return original code if no expansion found
  return [naics];
}

/**
 * Fetch spending data from USASpending API
 */
async function fetchSpendingData(
  naics: string,
  states: string[],
  setAside?: string
): Promise<{ agencies: AgencySpending[]; totalSpending: number; totalAwards: number }> {
  try {
    // Expand NAICS code if needed
    const naicsCodes = expandNaicsCode(naics);
    console.log(`📊 Querying USASpending with ${naicsCodes.length} NAICS codes`);

    // Build filters for USASpending API
    // Note: Using the correct format that works with USASpending v2 API
    const filters: Record<string, unknown> = {
      award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
      time_period: [
        {
          start_date: '2022-10-01',
          end_date: '2025-09-30',
        },
      ],
      naics_codes: naicsCodes,
    };

    // Add state filter - use place_of_performance_scope for state filtering
    if (states.length > 0) {
      filters.place_of_performance_scope = 'domestic';
      filters.place_of_performance_locations = states.map((state) => ({
        country: 'USA',
        state,
      }));
    }

    // Add set-aside filter if provided
    if (setAside) {
      const setAsideCodes = getSetAsideCodes(setAside);
      if (setAsideCodes.length > 0) {
        filters.set_aside_type_codes = setAsideCodes;
      }
    }

    console.log('📊 USASpending filters:', JSON.stringify(filters, null, 2));

    const response = await fetch(
      'https://api.usaspending.gov/api/v2/search/spending_by_award/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters,
          fields: [
            'Award ID',
            'Recipient Name',
            'Award Amount',
            'Awarding Agency',
            'Awarding Sub Agency',
            'Awarding Office',
            'NAICS Code',
            'Place of Performance State Code',
            'Set-Aside Type',
          ],
          page: 1,
          limit: 100,
          order: 'desc',
          sort: 'Award Amount',
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('USASpending API error:', response.status, errorText.slice(0, 500));
      return { agencies: [], totalSpending: 0, totalAwards: 0 };
    }

    const data = await response.json();
    let awards = data.results || [];

    // Fetch additional pages if there are more results (up to 500 total)
    let page = 2;
    while (awards.length < 500 && data.page_metadata?.hasNext) {
      const nextResponse = await fetch(
        'https://api.usaspending.gov/api/v2/search/spending_by_award/',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters,
            fields: [
              'Award ID',
              'Recipient Name',
              'Award Amount',
              'Awarding Agency',
              'Awarding Sub Agency',
              'Awarding Office',
              'NAICS Code',
              'Place of Performance State Code',
              'Set-Aside Type',
            ],
            page,
            limit: 100,
            order: 'desc',
            sort: 'Award Amount',
          }),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!nextResponse.ok) break;

      const nextData = await nextResponse.json();
      if (!nextData.results?.length) break;

      awards = awards.concat(nextData.results);
      page++;

      // Max 5 pages (500 results)
      if (page > 5) break;
    }

    // Aggregate by agency
    const agencyMap = new Map<
      string,
      { spending: number; awards: number; subAgency?: string }
    >();

    for (const award of awards) {
      const agency = award['Awarding Agency'] || 'Unknown';
      const subAgency = award['Awarding Sub Agency'];
      const amount = award['Award Amount'] || 0;

      const existing = agencyMap.get(agency) || {
        spending: 0,
        awards: 0,
        subAgency,
      };
      existing.spending += amount;
      existing.awards += 1;
      agencyMap.set(agency, existing);
    }

    // Calculate totals
    let totalSpending = Array.from(agencyMap.values()).reduce(
      (sum, a) => sum + a.spending,
      0
    );
    let totalAwards = awards.length;

    // If state search returned no results, try nationwide
    if (totalAwards === 0 && states.length > 0) {
      console.log('📊 No results with state filter, trying nationwide...');

      const nationwideFilters = { ...filters };
      delete nationwideFilters.place_of_performance_locations;
      delete nationwideFilters.place_of_performance_scope;

      const retryResponse = await fetch(
        'https://api.usaspending.gov/api/v2/search/spending_by_award/',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: nationwideFilters,
            fields: [
              'Award ID',
              'Recipient Name',
              'Award Amount',
              'Awarding Agency',
              'Awarding Sub Agency',
              'Awarding Office',
              'NAICS Code',
              'Place of Performance State Code',
              'Set-Aside Type',
            ],
            page: 1,
            limit: 100,
            order: 'desc',
            sort: 'Award Amount',
          }),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (retryResponse.ok) {
        const retryData = await retryResponse.json();
        const retryAwards = retryData.results || [];

        // Re-aggregate
        agencyMap.clear();
        for (const award of retryAwards) {
          const agency = award['Awarding Agency'] || 'Unknown';
          const subAgency = award['Awarding Sub Agency'];
          const amount = award['Award Amount'] || 0;

          const existing = agencyMap.get(agency) || {
            spending: 0,
            awards: 0,
            subAgency,
          };
          existing.spending += amount;
          existing.awards += 1;
          agencyMap.set(agency, existing);
        }

        totalSpending = Array.from(agencyMap.values()).reduce(
          (sum, a) => sum + a.spending,
          0
        );
        totalAwards = retryAwards.length;
        console.log(`✅ Nationwide search: ${totalAwards} awards, $${totalSpending.toLocaleString()}`);
      }
    }

    // Convert to array and calculate percentages
    const agencies: AgencySpending[] = Array.from(agencyMap.entries())
      .map(([agency, data]) => ({
        agency,
        subAgency: data.subAgency,
        spending: data.spending,
        awards: data.awards,
        percentOfTotal: totalSpending > 0 ? (data.spending / totalSpending) * 100 : 0,
        trend: 'stable' as const, // Would need historical data for actual trend
      }))
      .sort((a, b) => b.spending - a.spending)
      .slice(0, 15);

    return { agencies, totalSpending, totalAwards };
  } catch (error) {
    console.error('Error fetching spending data:', error);
    return { agencies: [], totalSpending: 0, totalAwards: 0 };
  }
}

/**
 * Get set-aside type codes for USASpending
 */
function getSetAsideCodes(setAside: string): string[] {
  const mapping: Record<string, string[]> = {
    '8a': ['8A', '8AN'],
    wosb: ['WOSB', 'EDWOSB'],
    hubzone: ['HZBZ', 'HUBZ'],
    sdvosb: ['SDVOSB', 'SDVOSBC'],
    vosb: ['VOSB', 'VO'],
    small: ['SBA', 'SBP', 'SMALL BUSINESS SET-ASIDE'],
  };

  const lower = setAside.toLowerCase();
  for (const [key, codes] of Object.entries(mapping)) {
    if (lower.includes(key)) {
      return codes;
    }
  }
  return [];
}

/**
 * Fetch SAM.gov opportunities
 */
async function fetchSamOpportunities(
  naics: string,
  state?: string
): Promise<Opportunity[]> {
  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    console.warn('SAM_API_KEY not set');
    return [];
  }

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      ncode: naics,
      ptype: 'p,r,k,o,s,i', // All notice types
      limit: '100',
    });

    if (state) {
      params.set('state', state);
    }

    // Get posted in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    params.set('postedFrom', formatSamDate(thirtyDaysAgo));
    params.set('postedTo', formatSamDate(new Date()));

    const url = `https://api.sam.gov/opportunities/v2/search?${params}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error('SAM.gov API error:', response.status);
      return [];
    }

    const data = await response.json();
    const opps = data.opportunitiesData || [];

    return opps.map((opp: Record<string, unknown>) => {
      const closeDate = opp.responseDeadLine as string | undefined;
      return {
        id: opp.noticeId as string,
        title: (opp.title as string) || 'Untitled',
        agency: (opp.department as string) || (opp.subtierAgency as string) || 'Unknown',
        value: undefined, // SAM.gov doesn't always include value
        closeDate,
        setAside: (opp.setAsideDescription as string) || undefined,
        source: 'sam.gov' as const,
        daysUntilClose: daysUntilClose(closeDate),
        link: opp.uiLink as string,
      };
    });
  } catch (error) {
    console.error('Error fetching SAM opportunities:', error);
    return [];
  }
}

/**
 * Format date for SAM.gov API (MM/dd/yyyy)
 */
function formatSamDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Fetch forecasts from SAM.gov
 */
async function fetchForecasts(
  naics: string,
  topAgencies: string[]
): Promise<Opportunity[]> {
  // Forecasts come from acquisitiongateway.gov, not sam.gov
  // For now, return empty - would need to implement acquisitiongateway integration
  // TODO: Integrate with acquisition gateway API
  return [];
}

/**
 * Fetch grants from Grants.gov
 */
async function fetchGrants(keywords: string[]): Promise<Opportunity[]> {
  try {
    const searchBody = {
      oppStatuses: 'posted',
      rows: 25,
      sortBy: 'openDate|desc',
      keyword: keywords.join(' '),
    };

    const response = await fetch(
      'https://apply07.grants.gov/grantsws/rest/opportunities/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchBody),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) {
      console.error('Grants.gov API error:', response.status);
      return [];
    }

    const data = await response.json();
    const grants = data.oppHits || [];

    return grants.map((grant: Record<string, unknown>) => {
      const closeDate = grant.closeDate as string | undefined;
      return {
        id: grant.oppNumber as string,
        title: (grant.title as string) || 'Untitled',
        agency: (grant.agencyName as string) || 'Unknown',
        value: grant.awardCeiling as number | undefined,
        closeDate,
        source: 'grants.gov' as const,
        daysUntilClose: daysUntilClose(closeDate),
        link: `https://www.grants.gov/search-results-detail/${grant.oppNumber}`,
      };
    });
  } catch (error) {
    console.error('Error fetching grants:', error);
    return [];
  }
}

/**
 * Fetch SBIR/STTR from multisite aggregation
 */
async function fetchSbirOpportunities(
  naics: string,
  keywords: string[]
): Promise<Opportunity[]> {
  try {
    // Query our aggregated_opportunities table
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return [];
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from('aggregated_opportunities')
      .select('*')
      .eq('status', 'active')
      .in('source', ['nih_reporter', 'nsf_sbir', 'sbir_gov'])
      .order('posted_date', { ascending: false })
      .limit(25);

    if (error) {
      console.error('Supabase error:', error);
      return [];
    }

    return (data || []).map((opp) => {
      const closeDate = opp.close_date;
      return {
        id: opp.external_id || opp.id,
        title: opp.title || 'Untitled',
        agency: opp.agency || 'Unknown',
        value: opp.estimated_value,
        closeDate,
        source: 'nih_reporter' as const,
        daysUntilClose: daysUntilClose(closeDate),
        link: opp.source_url,
      };
    });
  } catch (error) {
    console.error('Error fetching SBIR opportunities:', error);
    return [];
  }
}

/**
 * Fetch recompete opportunities from USASpending
 * (Contracts expiring in next 12 months)
 */
async function fetchRecompetes(
  naics: string,
  states: string[]
): Promise<Opportunity[]> {
  try {
    // Get contracts with period of performance ending in next 12 months
    const now = new Date();
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    const filters: Record<string, unknown> = {
      award_type_codes: ['A', 'B', 'C', 'D'],
      naics_codes: [naics],
      // Filter by end date would go here if USASpending supported it
      // For now, we'll fetch recent awards and estimate
    };

    if (states.length > 0) {
      filters.place_of_performance_locations = states.map((state) => ({
        country: 'USA',
        state,
      }));
    }

    const response = await fetch(
      'https://api.usaspending.gov/api/v2/search/spending_by_award/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters,
          fields: [
            'Award ID',
            'Recipient Name',
            'Award Amount',
            'Awarding Agency',
            'Awarding Sub Agency',
            'Period of Performance Current End Date',
          ],
          page: 1,
          limit: 50,
          order: 'desc',
          sort: 'Award Amount',
        }),
        signal: AbortSignal.timeout(30000),
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const awards = data.results || [];

    // Filter to contracts ending in next 12 months
    return awards
      .filter((award: Record<string, unknown>) => {
        const endDate = award['Period of Performance Current End Date'] as string;
        if (!endDate) return false;

        const end = new Date(endDate);
        return end > now && end <= oneYearFromNow;
      })
      .map((award: Record<string, unknown>) => {
        const endDate = award['Period of Performance Current End Date'] as string;
        return {
          id: award['Award ID'] as string,
          title: `Recompete: ${award['Recipient Name'] || 'Contract'}`,
          agency: (award['Awarding Agency'] as string) || 'Unknown',
          value: award['Award Amount'] as number,
          closeDate: endDate,
          source: 'recompete' as const,
          daysUntilClose: daysUntilClose(endDate),
        };
      })
      .slice(0, 20);
  } catch (error) {
    console.error('Error fetching recompetes:', error);
    return [];
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Parse parameters
  const naics = searchParams.get('naics');
  const state = searchParams.get('state');
  const zipCode = searchParams.get('zipCode');
  const yearsParam = searchParams.get('years');
  const includeGrants = searchParams.get('includeGrants') !== 'false';
  const includeSbir = searchParams.get('includeSbir') !== 'false';
  const setAside = searchParams.get('setAside') || undefined;

  // Validate required params
  if (!naics) {
    return NextResponse.json(
      { success: false, error: 'naics parameter is required' },
      { status: 400 }
    );
  }

  // Get state from zip if provided
  let primaryState = state;
  if (!primaryState && zipCode) {
    primaryState = getStateFromZip(zipCode);
  }

  // Get search states (primary + bordering for better coverage)
  const searchStates: string[] = [];
  if (primaryState) {
    searchStates.push(primaryState);
    const bordering = getBorderingStates(primaryState);
    if (bordering.length > 0) {
      searchStates.push(...bordering.slice(0, 3)); // Add up to 3 bordering states
    }
  }

  console.log(`📊 Market Scan: NAICS ${naics}, States: ${searchStates.join(', ') || 'nationwide'}`);

  // Generate keywords from NAICS for grants search
  const naicsDescription = getNaicsDescription(naics);
  const keywords = naicsDescription.toLowerCase().split(/[\s,]+/).filter(w => w.length > 3);

  // Fetch all data in parallel
  const [
    spendingResult,
    samOpps,
    forecasts,
    grants,
    sbirOpps,
    recompetes,
  ] = await Promise.all([
    fetchSpendingData(naics, searchStates, setAside),
    fetchSamOpportunities(naics, primaryState || undefined),
    fetchForecasts(naics, []), // Pass top agencies once available
    includeGrants ? fetchGrants(keywords) : Promise.resolve([]),
    includeSbir ? fetchSbirOpportunities(naics, keywords) : Promise.resolve([]),
    fetchRecompetes(naics, searchStates),
  ]);

  // Calculate visibility gap
  const samPostedValue = samOpps.reduce((sum, o) => sum + (o.value || 25000), 0); // Assume $25K if no value
  const gapAmount = spendingResult.totalSpending - samPostedValue;
  const gapPercentage = spendingResult.totalSpending > 0
    ? ((gapAmount / spendingResult.totalSpending) * 100)
    : 0;

  let interpretation: 'hidden_market' | 'partial_visibility' | 'well_covered';
  let interpretationText: string;

  if (gapPercentage > 70) {
    interpretation = 'hidden_market';
    interpretationText = `${gapPercentage.toFixed(0)}% of federal spending in this NAICS is NOT posted on SAM.gov. These contracts go through IDIQs, BPAs, GSA Schedule, or agency-specific portals. Focus on capability statements and past performance to access this hidden market.`;
  } else if (gapPercentage > 40) {
    interpretation = 'partial_visibility';
    interpretationText = `About ${(100 - gapPercentage).toFixed(0)}% of opportunities are visible on SAM.gov. The remaining ${gapPercentage.toFixed(0)}% flows through vehicle holders or direct awards. Monitor SAM.gov actively but also pursue vehicle access.`;
  } else {
    interpretation = 'well_covered';
    interpretationText = `This market has good visibility on SAM.gov with ${(100 - gapPercentage).toFixed(0)}% of spending posted as open opportunities. Focus on competitive positioning and response quality.`;
  }

  const gapAnalysis: GapAnalysis = {
    totalSpending: spendingResult.totalSpending,
    samPostedValue,
    gapAmount,
    gapPercentage,
    interpretation,
    interpretationText,
  };

  // Combine and score all opportunities
  const allOpportunities: Opportunity[] = [
    ...samOpps,
    ...forecasts,
    ...grants,
    ...sbirOpps,
    ...recompetes,
  ];

  // Score and rank
  const rankedOpportunities = allOpportunities
    .map((opp) => ({
      ...opp,
      score: scoreOpportunity(opp, setAside),
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 50);

  // Determine market type
  const marketType = determineMarketType(
    spendingResult.agencies,
    spendingResult.totalSpending
  );

  // Build response
  const result: MarketScanResult = {
    success: true,
    naics,
    naicsDescription,
    state: primaryState || undefined,
    states: searchStates.length > 0 ? searchStates : undefined,
    analysisDate: new Date().toISOString().split('T')[0],

    summary: {
      threeYearSpending: spendingResult.totalSpending,
      totalAwards: spendingResult.totalAwards,
      visibilityGap: gapPercentage,
      marketType,
      trend: 'stable', // Would need historical comparison
      trendPercent: 0,
    },

    topAgencies: spendingResult.agencies,
    gapAnalysis,

    samOpportunities: samOpps.slice(0, 20),
    forecasts: forecasts.slice(0, 10),
    grants: grants.slice(0, 10),
    sbirOpportunities: sbirOpps.slice(0, 10),
    recompetes: recompetes.slice(0, 10),

    rankedOpportunities,

    dataSources: [
      'USASpending.gov (FY22-25)',
      'SAM.gov',
      includeGrants ? 'Grants.gov' : null,
      includeSbir ? 'NIH RePORTER' : null,
    ].filter(Boolean) as string[],

    generatedAt: new Date().toISOString(),
  };

  console.log(`✅ Market Scan complete: ${formatCurrency(spendingResult.totalSpending)} spending, ${rankedOpportunities.length} opportunities`);

  return NextResponse.json(result);
}
