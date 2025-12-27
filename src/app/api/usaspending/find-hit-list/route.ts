import { NextRequest, NextResponse } from 'next/server';
import { CoreInputs } from '@/types/federal-market-assassin';
import {
  setAsideMap,
  veteranMap,
  naicsExpansion,
  enhanceOfficeName,
} from '@/lib/utils/usaspending-helpers';

interface HitListContract {
  id: string;
  title: string;
  agency: string;
  office: string;
  naics: string;
  amount: number;
  setAside: string;
  awardDate: string;
  description: string;
  contractingOfficeName: string;
  potentialValue: number;
  competitionLevel: 'low' | 'medium' | 'high';
  winProbability: 'high' | 'medium' | 'low';
}

/**
 * Find low-competition "hit list" opportunities based on USAspending historical data
 * Criteria for hit list:
 * - Small to medium contract values ($25K - $5M)
 * - Recent awards (last 12 months)
 * - Set-aside opportunities
 * - NAICS code match
 * - Single-award IDVs or standalone contracts
 */
export async function POST(request: NextRequest) {
  try {
    const body: CoreInputs = await request.json();
    const { businessType, naicsCode, veteranStatus } = body;

    console.log('🎯 Hit List search request:', body);

    // Build set-aside type codes
    const setAsideTypeCodes: string[] = [];
    if (businessType && setAsideMap[businessType]) {
      setAsideTypeCodes.push(...setAsideMap[businessType]);
    }
    if (veteranStatus && veteranMap[veteranStatus]) {
      setAsideTypeCodes.push(...veteranMap[veteranStatus]);
    }

    // Build filters for hit list opportunities
    const filters: any = {
      award_type_codes: ['A', 'B', 'C', 'D'], // All contract types
      time_period: [
        {
          start_date: '2023-01-01', // Last 24 months for more results
          end_date: '2025-12-31'
        }
      ],
      award_amounts: [
        {
          lower_bound: 10000,     // Min $10K (include smaller opportunities)
          upper_bound: 10000000   // Max $10M (expanded range)
        }
      ]
    };

    // Add NAICS filter
    if (naicsCode && naicsCode.trim()) {
      let trimmedNaics = naicsCode.trim();

      // Normalize sector-level NAICS codes (like 810000, 81000, 8100) to 2-digit
      if (trimmedNaics.length === 6 && trimmedNaics.endsWith('0000')) {
        trimmedNaics = trimmedNaics.substring(0, 2);
      } else if (trimmedNaics.length === 5 && trimmedNaics.endsWith('000')) {
        trimmedNaics = trimmedNaics.substring(0, 2);
      } else if (trimmedNaics.length === 4 && trimmedNaics.endsWith('00')) {
        trimmedNaics = trimmedNaics.substring(0, 2);
      } else if (trimmedNaics.length === 6 && trimmedNaics.endsWith('000')) {
        // Subsector-level like 811000 -> 3-digit
        trimmedNaics = trimmedNaics.substring(0, 3);
      } else if (trimmedNaics.length === 5 && trimmedNaics.endsWith('00')) {
        // Subsector-level like 81100 -> 3-digit
        trimmedNaics = trimmedNaics.substring(0, 3);
      }

      // Expand 2-digit NAICS to all 6-digit codes in that sector
      if (trimmedNaics.length === 2) {
        const expandedCodes = naicsExpansion[trimmedNaics];
        if (expandedCodes && expandedCodes.length > 0) {
          // Limit to first 20 codes for hit list to keep query manageable
          filters.naics_codes = expandedCodes.slice(0, 20);
        } else {
          // Skip NAICS filter if we can't expand - will search all contracts
          console.log(`⚠️ No NAICS expansion found for sector ${trimmedNaics}, searching without NAICS filter`);
        }
      } else if (trimmedNaics.length === 3) {
        // Expand 3-digit NAICS to related codes
        const expandedCodes = naicsExpansion[trimmedNaics];
        if (expandedCodes && expandedCodes.length > 0) {
          filters.naics_codes = expandedCodes;
        } else {
          filters.naics_codes = [trimmedNaics];
        }
      } else {
        // Valid 6-digit NAICS code
        filters.naics_codes = [trimmedNaics];
      }
    }

    // Add set-aside filter (important for hit list)
    if (setAsideTypeCodes.length > 0) {
      filters.set_aside_type_codes = setAsideTypeCodes;
    }

    console.log('🔍 Searching USAspending for hit list opportunities...');
    console.log('Filters:', JSON.stringify(filters, null, 2));

    // Query USAspending API
    const response = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filters,
        fields: [
          'Award ID',
          'Recipient Name',
          'Start Date',
          'End Date',
          'Award Amount',
          'Awarding Agency',
          'Awarding Sub Agency',
          'Award Type',
          'recipient_id',
          'Description',
          'NAICS Code',
          'NAICS Description',
          'Award Base Action Date',
          'Period of Performance Start Date',
          'Period of Performance Current End Date',
          'Awarding Office Name',
          'type_of_set_aside',
          'type_of_set_aside_description'
        ],
        page: 1,
        limit: 100, // Get top 100 opportunities
        sort: 'Award Amount',
        order: 'desc'
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`USAspending API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`✅ Found ${data.results?.length || 0} hit list opportunities`);

    // Process and score opportunities
    const hitListOpportunities: HitListContract[] = (data.results || []).map((result: any, index: number) => {
      const amount = parseFloat(result['Award Amount']) || 0;
      const setAside = result['type_of_set_aside_description'] || result['type_of_set_aside'] || 'Unrestricted';

      // Calculate competition level based on award amount
      let competitionLevel: 'low' | 'medium' | 'high' = 'low';
      if (amount > 5000000) {
        competitionLevel = 'high';
      } else if (amount > 1000000) {
        competitionLevel = 'medium';
      } else {
        competitionLevel = 'low'; // Sweet spot: $10K-$1M
      }

      // Calculate win probability based on set-aside and amount
      let winProbability: 'high' | 'medium' | 'low' = 'medium';
      const hasSetAside = setAside.toLowerCase().includes('small business') ||
                          setAside.toLowerCase().includes('8(a)') ||
                          setAside.toLowerCase().includes('sdvosb') ||
                          setAside.toLowerCase().includes('wosb') ||
                          setAside.toLowerCase().includes('hubzone') ||
                          setAside.toLowerCase().includes('veteran');

      if (hasSetAside) {
        if (amount < 250000) {
          winProbability = 'high'; // High win probability: Set-aside + small contract
        } else if (amount < 1000000) {
          winProbability = 'high'; // Still high for set-asides under $1M
        } else {
          winProbability = 'medium';
        }
      } else {
        // Unrestricted competitions
        if (amount < 100000) {
          winProbability = 'medium'; // Smaller unrestricted can still be won
        } else {
          winProbability = 'low';
        }
      }

      const officeName = result['Awarding Office Name'] || 'Unknown Office';
      const enhancedOfficeName = enhanceOfficeName(officeName) || officeName;

      return {
        id: result['Award ID'] || `hit-list-${index + 1}`,
        // generated_internal_id is automatically returned by USAspending API
        // It's the correct ID for building award URLs like /award/CONT_AWD_...
        generatedInternalId: result['generated_internal_id'] || null,
        title: result['Description'] || 'Contract Opportunity',
        agency: result['Awarding Agency'] || 'Unknown Agency',
        office: enhancedOfficeName,
        naics: result['NAICS Code'] || naicsCode || '',
        amount,
        setAside,
        awardDate: result['Award Base Action Date'] || result['Start Date'] || '',
        description: result['NAICS Description'] || '',
        contractingOfficeName: enhancedOfficeName,
        potentialValue: amount,
        competitionLevel,
        winProbability,
      };
    });

    // Sort by win probability and amount (prioritize high-probability, mid-range opportunities)
    const sortedOpportunities = hitListOpportunities.sort((a, b) => {
      const winProbScore = { high: 3, medium: 2, low: 1 };
      const aScore = winProbScore[a.winProbability];
      const bScore = winProbScore[b.winProbability];

      if (aScore !== bScore) {
        return bScore - aScore; // Higher win probability first
      }

      // For same win probability, prefer mid-range amounts ($100K-$1M)
      const getAmountScore = (amount: number) => {
        if (amount >= 100000 && amount <= 1000000) return 3; // Sweet spot
        if (amount >= 50000 && amount < 100000) return 2;
        if (amount > 1000000) return 1;
        return 0;
      };

      return getAmountScore(b.amount) - getAmountScore(a.amount);
    });

    return NextResponse.json({
      success: true,
      opportunities: sortedOpportunities.slice(0, 50), // Return top 50
      metadata: {
        totalFound: sortedOpportunities.length,
        searchCriteria: {
          naicsCode,
          businessType,
          setAsideTypes: setAsideTypeCodes,
          amountRange: '$10K - $10M',
          timePeriod: 'Last 24 months'
        }
      }
    });

  } catch (error) {
    console.error('❌ Hit list search error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to search for hit list opportunities',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
