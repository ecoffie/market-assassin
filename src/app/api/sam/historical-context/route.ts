import { NextRequest, NextResponse } from 'next/server';

interface HistoricalAward {
  awardId: string;
  piid: string;
  contractNumber: string;
  recipient: string;
  recipientUei: string;
  awardDate: string;
  obligatedAmount: number;
  baseAndExercisedOptionsValue: number;
  description: string;
  naicsCode: string;
  pscCode: string;
  awardType: string;
  awardingAgency: string;
  awardingOffice: string;
  periodOfPerformanceStart: string;
  periodOfPerformanceEnd: string;
  placeOfPerformance: string;
  setAside: string | null;
  contractLink: string;
}

interface HistoricalContextResponse {
  success: boolean;
  opportunity: {
    title: string;
    agency: string;
    naics: string;
  };
  historicalContext: {
    totalPastAwards: number;
    totalHistoricalValue: number;
    incumbents: Array<{
      name: string;
      totalAwards: number;
      totalValue: number;
      lastAwardDate: string;
      isCurrentIncumbent: boolean;
    }>;
    priceRange: {
      min: number;
      max: number;
      average: number;
    };
    recentAwards: HistoricalAward[];
    contractHistory: Array<{
      year: number;
      awardCount: number;
      totalValue: number;
    }>;
  };
  metadata: {
    searchCriteria: {
      agency: string;
      naics: string;
      keywords: string[];
    };
    fetchedAt: string;
    source: string;
  };
  error?: string;
}

/**
 * Search USASpending for historical awards related to an opportunity
 */
async function searchHistoricalAwards(
  agency: string,
  naics: string,
  title: string,
  limit: number = 50
): Promise<HistoricalAward[]> {
  // Extract keywords from title for searching
  const stopWords = ['the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'at', 'by', 'with', 'services', 'support', 'contract'];
  const keywords = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.includes(w))
    .slice(0, 5);

  // Build USASpending API request
  const requestBody = {
    filters: {
      time_period: [
        {
          start_date: '2019-10-01',
          end_date: new Date().toISOString().split('T')[0],
        },
      ],
      award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
      ...(naics && { naics_codes: [{ code: naics, require_exact_match: true }] }),
    },
    fields: [
      'Award ID',
      'Recipient Name',
      'Recipient UEI',
      'Award Amount',
      'Total Outlays',
      'Description',
      'Start Date',
      'End Date',
      'Awarding Agency',
      'Awarding Sub Agency',
      'NAICS Code',
      'PSC Code',
      'Award Type',
      'Contract Award Type',
      'Place of Performance City',
      'Place of Performance State',
      'Type of Set Aside',
      'generated_internal_id',
      'PIID',
      'Contract Award Unique Key',
    ],
    page: 1,
    limit: limit,
    sort: 'Award Amount',
    order: 'desc',
  };

  try {
    const response = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error('[Historical] USASpending API error:', response.status);
      return [];
    }

    const data = await response.json();
    const results = data.results || [];

    return results.map((award: any) => ({
      awardId: award['generated_internal_id'] || award['Award ID'] || '',
      piid: award['PIID'] || '',
      contractNumber: award['Contract Award Unique Key'] || award['Award ID'] || '',
      recipient: award['Recipient Name'] || 'Unknown',
      recipientUei: award['Recipient UEI'] || '',
      awardDate: award['Start Date'] || '',
      obligatedAmount: award['Award Amount'] || 0,
      baseAndExercisedOptionsValue: award['Total Outlays'] || award['Award Amount'] || 0,
      description: award['Description'] || '',
      naicsCode: award['NAICS Code'] || '',
      pscCode: award['PSC Code'] || '',
      awardType: award['Award Type'] || award['Contract Award Type'] || '',
      awardingAgency: award['Awarding Agency'] || '',
      awardingOffice: award['Awarding Sub Agency'] || '',
      periodOfPerformanceStart: award['Start Date'] || '',
      periodOfPerformanceEnd: award['End Date'] || '',
      placeOfPerformance: [award['Place of Performance City'], award['Place of Performance State']].filter(Boolean).join(', '),
      setAside: award['Type of Set Aside'] || null,
      contractLink: award['generated_internal_id']
        ? `https://www.usaspending.gov/award/${award['generated_internal_id']}`
        : '',
    }));
  } catch (error) {
    console.error('[Historical] Error fetching from USASpending:', error);
    return [];
  }
}

/**
 * Analyze awards to extract incumbent and pricing intelligence
 */
function analyzeHistoricalAwards(awards: HistoricalAward[]) {
  // Group by recipient to find incumbents
  const recipientMap = new Map<string, {
    name: string;
    awards: HistoricalAward[];
    totalValue: number;
    lastAwardDate: string;
  }>();

  for (const award of awards) {
    const existing = recipientMap.get(award.recipient);
    if (existing) {
      existing.awards.push(award);
      existing.totalValue += award.obligatedAmount;
      if (award.awardDate > existing.lastAwardDate) {
        existing.lastAwardDate = award.awardDate;
      }
    } else {
      recipientMap.set(award.recipient, {
        name: award.recipient,
        awards: [award],
        totalValue: award.obligatedAmount,
        lastAwardDate: award.awardDate,
      });
    }
  }

  // Sort incumbents by total value
  const incumbents = Array.from(recipientMap.values())
    .map(r => ({
      name: r.name,
      totalAwards: r.awards.length,
      totalValue: r.totalValue,
      lastAwardDate: r.lastAwardDate,
      isCurrentIncumbent: new Date(r.lastAwardDate) > new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // Within last year
    }))
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 10);

  // Calculate price range
  const amounts = awards.map(a => a.obligatedAmount).filter(a => a > 0);
  const priceRange = {
    min: amounts.length > 0 ? Math.min(...amounts) : 0,
    max: amounts.length > 0 ? Math.max(...amounts) : 0,
    average: amounts.length > 0 ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0,
  };

  // Group by year for contract history
  const yearMap = new Map<number, { count: number; value: number }>();
  for (const award of awards) {
    const year = new Date(award.awardDate).getFullYear();
    if (!isNaN(year)) {
      const existing = yearMap.get(year);
      if (existing) {
        existing.count++;
        existing.value += award.obligatedAmount;
      } else {
        yearMap.set(year, { count: 1, value: award.obligatedAmount });
      }
    }
  }

  const contractHistory = Array.from(yearMap.entries())
    .map(([year, data]) => ({ year, awardCount: data.count, totalValue: data.value }))
    .sort((a, b) => b.year - a.year);

  return {
    totalPastAwards: awards.length,
    totalHistoricalValue: awards.reduce((sum, a) => sum + a.obligatedAmount, 0),
    incumbents,
    priceRange,
    contractHistory,
  };
}

/**
 * POST endpoint - Get historical context for an opportunity
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, agency, naics, office } = body;

    if (!naics) {
      return NextResponse.json(
        { success: false, error: 'NAICS code is required' },
        { status: 400 }
      );
    }

    console.log('[Historical] Fetching context for:', { title, agency, naics });

    // Fetch historical awards from USASpending
    const awards = await searchHistoricalAwards(agency, naics, title || '', 100);

    console.log(`[Historical] Found ${awards.length} historical awards`);

    // Analyze the awards
    const analysis = analyzeHistoricalAwards(awards);

    // Get most recent awards for display
    const recentAwards = awards
      .sort((a, b) => new Date(b.awardDate).getTime() - new Date(a.awardDate).getTime())
      .slice(0, 10);

    const response: HistoricalContextResponse = {
      success: true,
      opportunity: {
        title: title || 'Unknown Opportunity',
        agency: agency || 'Unknown Agency',
        naics: naics,
      },
      historicalContext: {
        ...analysis,
        recentAwards,
      },
      metadata: {
        searchCriteria: {
          agency: agency || '',
          naics,
          keywords: title ? title.split(' ').slice(0, 5) : [],
        },
        fetchedAt: new Date().toISOString(),
        source: 'USASpending.gov',
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Historical] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch historical context',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint - API documentation
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/sam/historical-context',
    description: 'Get historical contract context for a SAM.gov opportunity',
    method: 'POST',
    body: {
      title: 'string - Opportunity title',
      agency: 'string - Awarding agency name',
      naics: 'string (required) - NAICS code',
      office: 'string (optional) - Contracting office',
    },
    response: {
      historicalContext: {
        totalPastAwards: 'number',
        totalHistoricalValue: 'number',
        incumbents: 'Array of companies who won similar contracts',
        priceRange: '{ min, max, average }',
        recentAwards: 'Array of recent contract awards',
        contractHistory: 'Awards by year',
      },
    },
  });
}
