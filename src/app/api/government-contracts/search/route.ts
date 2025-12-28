import { NextRequest, NextResponse } from 'next/server';
import {
  getStateFromZip,
  getBorderingStates,
  setAsideMap,
  veteranMap,
  naicsExpansion,
  industryNames,
  enhanceOfficeName,
  lookupOfficeNameFromSAM,
  usaceDistrictMap,
  SearchFilters,
  OfficeSpending,
  SearchSuggestions,
} from '@/lib/government-contracts';

const USASPENDING_API = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

// Fields to request from USAspending API
const FIELDS = [
  'Award ID',
  'Recipient Name',
  'Award Amount',
  'Awarding Agency',
  'Awarding Sub Agency',
  'Awarding Agency Code',
  'Awarding Sub Agency Code',
  'Awarding Office',
  'NAICS Code',
  'NAICS Description',
  'Place of Performance State Code',
  'Place of Performance City Code',
  'Primary Place of Performance',
  'Set-Aside Type',
  'Number of Offers Received'
];

interface SearchRequestBody {
  businessFormation?: string;
  naicsCode?: string;
  zipCode?: string;
  goodsOrServices?: string;
  veteranStatus?: string;
}

async function generateSearchSuggestions(params: {
  currentResults: number;
  currentAgencies: number;
  businessFormation?: string;
  naicsCode?: string;
  zipCode?: string;
  veteranStatus?: string;
  filters: SearchFilters;
}): Promise<SearchSuggestions | null> {
  const {
    currentResults,
    currentAgencies,
    businessFormation,
    naicsCode,
    zipCode,
    filters,
  } = params;

  const suggestions: SearchSuggestions = {
    message: `Found ${currentResults} contracts from ${currentAgencies} ${currentAgencies === 1 ? 'agency' : 'agencies'}. Here are some ways to expand your search:`,
    alternatives: []
  };

  // Suggestion 1: Try other set-aside types
  if (businessFormation) {
    const otherSetAsides = Object.keys(setAsideMap).filter(type => type !== businessFormation);
    const setAsidePromises = otherSetAsides.slice(0, 3).map(async (setAsideType) => {
      try {
        const testFilters = {
          ...filters,
          set_aside_type_codes: setAsideMap[setAsideType]
        };

        const response = await fetch(USASPENDING_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: testFilters,
            fields: ['Award ID'],
            page: 1,
            limit: 100
          }),
          signal: AbortSignal.timeout(5000)
        });

        const data = await response.json();
        const count = data?.results?.length || 0;
        const estimatedTotal = count === 100 ? 1000 : count;

        if (estimatedTotal > currentResults) {
          return {
            type: 'set-aside',
            label: setAsideType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
            value: setAsideType,
            estimatedContracts: estimatedTotal,
            description: `~${estimatedTotal.toLocaleString()} contracts available for ${setAsideType.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} businesses`
          };
        }
      } catch {
        // Silently continue
      }
      return null;
    });

    const setAsideResults = (await Promise.all(setAsidePromises)).filter(Boolean);
    suggestions.alternatives.push(...(setAsideResults as typeof suggestions.alternatives));
  }

  // Suggestion 2: Expand geographic area
  if (zipCode && filters.place_of_performance_locations) {
    try {
      const expandedFilters = { ...filters };
      delete expandedFilters.place_of_performance_locations;

      const response = await fetch(USASPENDING_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: expandedFilters,
          fields: ['Award ID'],
          page: 1,
          limit: 100
        }),
        signal: AbortSignal.timeout(5000)
      });

      const data = await response.json();
      const count = data?.results?.length || 0;
      const estimatedTotal = count === 100 ? 1000 : count;

      if (estimatedTotal > currentResults * 1.5) {
        const stateFromZip = getStateFromZip(zipCode);
        suggestions.alternatives.push({
          type: 'location',
          label: 'Nationwide Search',
          value: 'nationwide',
          estimatedContracts: estimatedTotal,
          description: `~${estimatedTotal.toLocaleString()} contracts available nationwide (currently searching in ${stateFromZip} and bordering states)`
        });
      }
    } catch {
      // Silently continue
    }
  }

  // Suggestion 3: Expand NAICS
  if (naicsCode && naicsCode.length >= 4) {
    const naicsPrefix = naicsCode.substring(0, 3);
    try {
      const testFilters = { ...filters };
      delete testFilters.naics_codes;
      delete testFilters.place_of_performance_locations;

      const response = await fetch(USASPENDING_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: testFilters,
          fields: ['Award ID'],
          page: 1,
          limit: 100
        }),
        signal: AbortSignal.timeout(5000)
      });

      const data = await response.json();
      const count = data?.results?.length || 0;
      const estimatedTotal = count === 100 ? 1000 : count;

      if (estimatedTotal > currentResults * 1.5) {
        const industryName = industryNames[naicsPrefix] || `NAICS ${naicsPrefix}`;
        suggestions.alternatives.push({
          type: 'naics-prefix',
          label: `All ${industryName} (NAICS ${naicsPrefix}xx)`,
          value: `naics-prefix:${naicsPrefix}`,
          estimatedContracts: estimatedTotal,
          description: `~${estimatedTotal.toLocaleString()} contracts in the ${industryName} industry (all ${naicsPrefix}xx codes)`
        });
      }
    } catch {
      // Silently continue
    }
  }

  return suggestions.alternatives.length > 0 ? suggestions : null;
}

export async function POST(request: NextRequest) {
  try {
    const body: SearchRequestBody = await request.json();
    const {
      businessFormation,
      naicsCode,
      zipCode,
      goodsOrServices,
      veteranStatus
    } = body;

    console.log('Government contract search request:', body);

    // Build set-aside type codes
    const setAsideTypeCodes: string[] = [];
    if (businessFormation && setAsideMap[businessFormation]) {
      setAsideTypeCodes.push(...setAsideMap[businessFormation]);
    }
    if (veteranStatus && veteranMap[veteranStatus]) {
      setAsideTypeCodes.push(...veteranMap[veteranStatus]);
    }

    // Build filters
    const filters: SearchFilters = {
      award_type_codes: ['A', 'B', 'C', 'D'],
      time_period: [
        {
          start_date: '2022-10-01',
          end_date: '2025-09-30'
        }
      ]
    };

    let naicsCorrectionMessage: string | null = null;

    // Add NAICS filter
    if (naicsCode && naicsCode.trim()) {
      let trimmedNaics = naicsCode.trim();

      // Detect invalid 6-digit codes ending in 000
      if (trimmedNaics.length === 6 && trimmedNaics.endsWith('000')) {
        const prefix = trimmedNaics.substring(0, 3);
        const industryName = industryNames[prefix] || `${prefix}xx industry`;
        naicsCorrectionMessage = `NAICS ${trimmedNaics} was expanded to search all ${prefix}xx codes in the ${industryName} sector.`;
        trimmedNaics = prefix;
      }

      if (trimmedNaics.length === 3) {
        const expandedCodes = naicsExpansion[trimmedNaics];
        if (expandedCodes && expandedCodes.length > 0) {
          filters.naics_codes = expandedCodes;
        } else {
          filters.naics_codes = [trimmedNaics];
        }
      } else {
        filters.naics_codes = [trimmedNaics];
      }
    }

    // Add set-aside filter
    if (setAsideTypeCodes.length > 0) {
      filters.set_aside_type_codes = setAsideTypeCodes;
    }

    // Add location filter
    if (zipCode && zipCode.trim()) {
      const stateFromZip = getStateFromZip(zipCode);
      if (stateFromZip) {
        const borderingStates = getBorderingStates(stateFromZip);
        const stateCodes = [stateFromZip, ...borderingStates];
        filters.place_of_performance_locations = stateCodes.map(state => ({
          country: 'USA',
          state: state
        }));
      }
    }

    // Determine number of pages based on filter restrictiveness
    const filterCount = [
      naicsCode && naicsCode.trim(),
      setAsideTypeCodes.length > 0,
      zipCode && zipCode.trim()
    ].filter(Boolean).length;

    let maxPages = 10;
    if (filterCount >= 3) {
      maxPages = 50;
    } else if (filterCount === 2) {
      maxPages = 25;
    }

    const limit = 100;
    let allAwards: Record<string, unknown>[] = [];

    // Fetch contracts from USAspending API
    for (let page = 1; page <= maxPages; page++) {
      try {
        const response = await fetch(USASPENDING_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters,
            fields: FIELDS,
            page,
            limit,
            order: 'desc',
            sort: 'Award Amount'
          }),
          signal: AbortSignal.timeout(30000)
        });

        const data = await response.json();

        if (data && data.results) {
          allAwards.push(...data.results);
          if (data.results.length < limit) break;
        } else {
          break;
        }
      } catch (error) {
        console.error(`Error fetching page ${page}:`, error);
        break;
      }

      if (page < maxPages) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`Retrieved ${allAwards.length} total contracts from USAspending`);

    let wasAutoAdjusted = false;

    // Handle zero results with fallback strategy
    if (allAwards.length === 0) {
      console.log('No contracts found. Attempting auto-broadening...');

      let fallbackFilters: SearchFilters | null = null;
      let fallbackMessage: string | null = null;

      if (zipCode && filters.place_of_performance_locations) {
        fallbackFilters = { ...filters };
        delete fallbackFilters.place_of_performance_locations;
        const stateFromZip = getStateFromZip(zipCode);
        fallbackMessage = `No contracts found in ${stateFromZip} area. Showing nationwide results.`;
      } else if (businessFormation && naicsCode) {
        fallbackFilters = { ...filters };
        delete fallbackFilters.set_aside_type_codes;
        fallbackMessage = `No ${businessFormation} contracts found in NAICS ${naicsCode}. Showing all contracts in this industry.`;
      }

      if (fallbackFilters) {
        try {
          const fallbackAwards: Record<string, unknown>[] = [];
          for (let page = 1; page <= 10; page++) {
            const response = await fetch(USASPENDING_API, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filters: fallbackFilters,
                fields: FIELDS,
                page,
                limit: 100,
                order: 'desc',
                sort: 'Award Amount'
              }),
              signal: AbortSignal.timeout(30000)
            });

            const data = await response.json();
            if (data && data.results) {
              fallbackAwards.push(...data.results);
              if (data.results.length < 100) break;
            } else {
              break;
            }

            if (page < 10) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }

          if (fallbackAwards.length > 0) {
            allAwards = fallbackAwards;
            wasAutoAdjusted = true;
            if (fallbackMessage) {
              naicsCorrectionMessage = naicsCorrectionMessage
                ? `${naicsCorrectionMessage}\n\n${fallbackMessage}`
                : fallbackMessage;
            }
          }
        } catch (error) {
          console.error('Fallback search failed:', error);
        }
      }

      // If still no results, generate suggestions
      if (allAwards.length === 0) {
        const suggestions = await generateSearchSuggestions({
          currentResults: 0,
          currentAgencies: 0,
          businessFormation,
          naicsCode,
          zipCode,
          veteranStatus,
          filters
        });

        return NextResponse.json({
          success: true,
          searchCriteria: { businessFormation, naicsCode, zipCode, goodsOrServices, veteranStatus },
          summary: {
            totalAwards: 0,
            totalAgencies: 0,
            totalSpending: 0
          },
          agencies: [],
          suggestions,
          naicsCorrectionMessage
        });
      }
    }

    // Aggregate contracts by office
    const officeSpending: Record<string, OfficeSpending> = {};

    allAwards.forEach(award => {
      const awardingAgency = (award['Awarding Agency'] as string) || 'Unknown Agency';
      const rawAwardingSubAgency = (award['Awarding Sub Agency'] as string) || awardingAgency;
      const rawAwardingOffice = (award['Awarding Office'] as string) || rawAwardingSubAgency;

      const awardingSubAgency = enhanceOfficeName(rawAwardingSubAgency);
      const awardingOffice = enhanceOfficeName(rawAwardingOffice);

      const awardingAgencyCode = (award['Awarding Agency Code'] as string) || '';
      const awardingSubAgencyCode = (award['Awarding Sub Agency Code'] as string) || '';
      const location = (award['Place of Performance State Code'] as string) || null;
      const city = (award['Place of Performance City Code'] as string) || null;
      const primaryPlaceOfPerformance = (award['Primary Place of Performance'] as string) || null;
      const amount = (award['Award Amount'] as number) || 0;
      const setAsideType = (award['Set-Aside Type'] as string) || 'None';
      let numberOfOffersReceived = award['Number of Offers Received'] as number | string | null;

      if (numberOfOffersReceived === null || numberOfOffersReceived === undefined) {
        numberOfOffersReceived = null;
      }

      const officeId = (award as { agency_slug?: string; awarding_agency_id?: string }).agency_slug ||
                       (award as { agency_slug?: string; awarding_agency_id?: string }).awarding_agency_id ||
                       awardingAgency;
      const officeKey = `${officeId}|${awardingSubAgency}|${awardingOffice}`;

      if (!officeSpending[officeKey]) {
        const searchableOfficeCode = awardingSubAgencyCode || awardingAgencyCode || '';

        officeSpending[officeKey] = {
          agencyId: officeId,
          agencyCode: awardingAgencyCode,
          subAgencyCode: awardingSubAgencyCode,
          searchableOfficeCode,
          contractingOffice: awardingOffice,
          agencyName: awardingSubAgency,
          parentAgency: awardingAgency,
          location,
          city,
          primaryPlaceOfPerformance,
          totalSpending: 0,
          setAsideSpending: 0,
          contractCount: 0,
          setAsideContractCount: 0,
          totalOffers: 0,
          offersData: []
        };
      }

      officeSpending[officeKey].totalSpending += amount;
      officeSpending[officeKey].contractCount += 1;

      if (numberOfOffersReceived !== null && numberOfOffersReceived !== undefined) {
        let offersValue = 0;
        if (typeof numberOfOffersReceived === 'string') {
          offersValue = parseInt(numberOfOffersReceived.trim(), 10);
          if (isNaN(offersValue)) offersValue = 0;
        } else if (typeof numberOfOffersReceived === 'number') {
          offersValue = numberOfOffersReceived;
        }

        if (offersValue > 0) {
          officeSpending[officeKey].totalOffers += offersValue;
          officeSpending[officeKey].offersData.push(offersValue);
        }
      }

      const filteredBySetAside = setAsideTypeCodes.length > 0;
      const hasSetAsideField = setAsideType && setAsideType !== 'None' && setAsideType !== 'null';
      const isSetAside = filteredBySetAside || hasSetAsideField;

      if (isSetAside) {
        officeSpending[officeKey].setAsideSpending += amount;
        officeSpending[officeKey].setAsideContractCount += 1;
      }
    });

    // Calculate percentiles
    Object.values(officeSpending).forEach(office => {
      if (office.offersData && office.offersData.length > 0) {
        office.offersData.sort((a, b) => a - b);
        const len = office.offersData.length;

        const index5th = Math.max(0, Math.floor(len * 0.05));
        office.bidsPerContract5th = office.offersData[index5th];

        office.bidsPerContractAvg = Math.round((office.totalOffers / len) * 10) / 10;

        const index95th = Math.min(len - 1, Math.floor(len * 0.95));
        office.bidsPerContract95th = office.offersData[index95th];
      } else {
        office.bidsPerContract5th = null;
        office.bidsPerContractAvg = null;
        office.bidsPerContract95th = null;
      }
    });

    // Sort and get top offices
    let topOffices = Object.values(officeSpending)
      .sort((a, b) => {
        if (Math.abs(b.setAsideSpending - a.setAsideSpending) > 1000) {
          return b.setAsideSpending - a.setAsideSpending;
        }
        return b.totalSpending - a.totalSpending;
      })
      .slice(0, 50);

    // Enhance office names
    topOffices = topOffices.map(office => {
      const samOfficeName = lookupOfficeNameFromSAM(office.agencyId, office.agencyName);
      if (samOfficeName && samOfficeName !== office.agencyName && samOfficeName.length > 3) {
        return { ...office, agencyName: samOfficeName };
      }
      return office;
    });

    // Enhance USACE entries
    topOffices = topOffices.map(office => {
      const isUSACE = office.agencyName && (
        office.agencyName.toUpperCase().includes('USACE') ||
        office.agencyName.toUpperCase().includes('ARMY CORPS OF ENGINEERS') ||
        office.agencyName.toUpperCase().includes('U.S. ARMY ENGINEER')
      );

      if (isUSACE && office.city) {
        const cityUpper = office.city.toUpperCase();

        for (const [location, district] of Object.entries(usaceDistrictMap)) {
          if (cityUpper.includes(location) || location.includes(cityUpper)) {
            return { ...office, agencyName: `USACE - ${district}` };
          }
        }
      }

      return office;
    });

    // Generate suggestions if results are limited or auto-adjusted
    let suggestions: SearchSuggestions | null = null;
    if ((topOffices.length < 10 || wasAutoAdjusted) && (naicsCode || businessFormation || zipCode)) {
      suggestions = await generateSearchSuggestions({
        currentResults: allAwards.length,
        currentAgencies: topOffices.length,
        businessFormation,
        naicsCode,
        zipCode,
        veteranStatus,
        filters
      });
    }

    // Return results
    return NextResponse.json({
      success: true,
      searchCriteria: {
        businessFormation,
        naicsCode,
        zipCode,
        goodsOrServices,
        veteranStatus
      },
      summary: {
        totalAwards: allAwards.length,
        totalAgencies: topOffices.length,
        totalSpending: topOffices.reduce((sum, a) => sum + a.totalSpending, 0)
      },
      agencies: topOffices.map(office => ({
        agencyId: office.agencyId,
        agencyCode: office.agencyCode,
        subAgencyCode: office.subAgencyCode,
        searchableOfficeCode: office.searchableOfficeCode,
        contractingOffice: office.contractingOffice,
        agencyName: office.agencyName,
        parentAgency: office.parentAgency,
        location: office.location,
        city: office.city,
        primaryPlaceOfPerformance: office.primaryPlaceOfPerformance,
        totalSpending: office.totalSpending,
        setAsideSpending: office.setAsideSpending,
        contractCount: office.contractCount,
        setAsideContractCount: office.setAsideContractCount,
        bidsPerContract5th: office.bidsPerContract5th,
        bidsPerContractAvg: office.bidsPerContractAvg,
        bidsPerContract95th: office.bidsPerContract95th
      })),
      suggestions,
      naicsCorrectionMessage
    });

  } catch (error) {
    console.error('Government contract search error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to search government contracts',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
