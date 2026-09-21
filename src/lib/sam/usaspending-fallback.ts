/**
 * USASpending.gov API Fallback
 *
 * Provides bid count and competition data when SAM.gov Contract Awards API
 * is unavailable (requires System Account) or rate limited.
 *
 * USASpending API docs: https://api.usaspending.gov/docs/endpoints
 *
 * Key endpoint: POST /api/v2/search/spending_by_award/
 * Returns: number_of_offers_received, extent_competed, extent_competed_description
 */

import type { ContractAward, ContractAwardSearchParams, ContractAwardSearchResult } from './contract-awards';

const USASPENDING_BASE_URL = 'https://api.usaspending.gov/api/v2';

// Competition level mapping (same as SAM.gov)
const EXTENT_COMPETED_MAP: Record<string, string> = {
  'A': 'Full and Open Competition',
  'B': 'Not Available for Competition',
  'C': 'Not Competed',
  'D': 'Full and Open (Excl. Sources)',
  'E': 'Follow-On to Competed',
  'F': 'Competed under SAP',
  'G': 'Not Competed under SAP',
  'CDO': 'Competed under BPA',
  'NDO': 'Not Competed under BPA'
};

/**
 * Get competition level from bid count
 */
function getCompetitionLevel(numberOfOffers: number, extentCompeted: string): ContractAward['competitionLevel'] {
  if (extentCompeted === 'C' || extentCompeted === 'B') {
    return 'sole_source';
  }
  if (numberOfOffers <= 2) return 'low';
  if (numberOfOffers <= 5) return 'medium';
  return 'high';
}

/**
 * Safely get nested value from object
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((current, key) => {
    return current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined;
  }, obj as unknown);
}

/**
 * Transform USASpending award to our ContractAward type
 *
 * USASpending award detail structure:
 * - recipient.recipient_name, recipient.recipient_uei
 * - period_of_performance.start_date, period_of_performance.end_date
 * - naics_hierarchy.base_code.code, naics_hierarchy.base_code.description
 * - awarding_agency.toptier_agency.name, awarding_agency.subtier_agency.name
 * - place_of_performance.city_name, place_of_performance.state_code
 * - latest_transaction_contract_data.number_of_offers_received, extent_competed
 */
function transformUSASpendingAward(raw: Record<string, unknown>): ContractAward {
  // USASpending puts contract-specific data in latest_transaction_contract_data
  const contractData = raw.latest_transaction_contract_data as Record<string, unknown> || {};

  const piid = (raw.piid as string) ||
    (raw['Award ID'] as string) ||
    (raw.generated_unique_award_id as string) || '';

  // Recipient data - can be nested (award detail) or flat (search result)
  const recipientObj = raw.recipient as Record<string, unknown>;
  const recipientName = recipientObj?.recipient_name as string ||
    (raw.recipient_name as string) ||
    (raw['Recipient Name'] as string) || '';
  const recipientUei = recipientObj?.recipient_uei as string ||
    (raw.recipient_uei as string) || '';

  // Competition data - the key fields we need
  const numberOfOffersStr = (contractData.number_of_offers_received as string) || '0';
  const numberOfOffers = parseInt(numberOfOffersStr, 10) || 0;
  const extentCompeted = (contractData.extent_competed as string) || '';
  const extentCompetedDesc = (contractData.extent_competed_description as string) ||
    EXTENT_COMPETED_MAP[extentCompeted] || extentCompeted;

  // Dates - nested in award detail, flat in search
  const periodOfPerf = raw.period_of_performance as Record<string, unknown>;
  const startDate = periodOfPerf?.start_date as string ||
    (raw.period_of_performance_start_date as string) ||
    (raw['Start Date'] as string) || '';
  const currentEndDate = periodOfPerf?.end_date as string ||
    (raw.period_of_performance_current_end_date as string) ||
    (raw['End Date'] as string) || '';
  const actionDate = (raw.date_signed as string) || (raw.action_date as string) || '';

  // Parse date and calculate days until expiration
  let daysUntilExpiration: number | undefined;
  if (currentEndDate) {
    const expDate = new Date(currentEndDate);
    if (!isNaN(expDate.getTime())) {
      daysUntilExpiration = Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    }
  }

  // NAICS - nested in award detail
  const naicsHierarchy = raw.naics_hierarchy as Record<string, unknown>;
  const naicsBaseCode = naicsHierarchy?.base_code as Record<string, unknown>;
  const naicsCode = naicsBaseCode?.code as string ||
    (raw.naics_code as string) ||
    (raw['NAICS Code'] as string) || '';
  const naicsDescription = naicsBaseCode?.description as string ||
    (raw.naics_description as string) ||
    (raw['NAICS Description'] as string) || '';

  // PSC - nested in award detail
  const pscHierarchy = raw.psc_hierarchy as Record<string, unknown>;
  const pscBaseCode = pscHierarchy?.base_code as Record<string, unknown>;
  const pscCode = pscBaseCode?.code as string ||
    (raw.product_or_service_code as string) ||
    (raw['Product or Service Code (PSC)'] as string) || '';

  // Dollars
  const totalObligation = Number(raw.total_obligation) || 0;
  const awardAmount = Number(raw['Award Amount']) || Number(raw.base_and_all_options) || totalObligation;

  // Agency - nested in award detail
  const awardingAgency = raw.awarding_agency as Record<string, unknown>;
  const toptierAgency = awardingAgency?.toptier_agency as Record<string, unknown>;
  const subtierAgency = awardingAgency?.subtier_agency as Record<string, unknown>;
  const awardingAgencyName = toptierAgency?.name as string ||
    (raw.awarding_toptier_agency_name as string) || '';
  const awardingSubAgencyName = subtierAgency?.name as string ||
    (raw.awarding_subtier_agency_name as string) || '';

  // Place of performance - nested in award detail
  const placeOfPerf = raw.place_of_performance as Record<string, unknown>;
  const popCity = placeOfPerf?.city_name as string ||
    (raw.pop_city_name as string) || '';
  const popState = placeOfPerf?.state_code as string ||
    (raw.pop_state_code as string) || '';
  const popZip = placeOfPerf?.zip5 as string ||
    (raw.pop_zip5 as string) || '';

  // Description
  const description = (raw.description as string) ||
    (raw['Description'] as string) || '';

  // Contract type
  const contractType = (contractData.type_of_contract_pricing as string) || '';

  // Modification
  const modNumber = (raw.latest_transaction_id as string) || '0';

  return {
    piid,
    contractAwardUniqueKey: (raw.generated_unique_award_id as string) || piid,
    recipientName,
    recipientUei,
    awardingAgencyName,
    awardingSubAgencyName,
    naicsCode,
    naicsDescription,
    pscCode,
    totalObligation,
    currentTotalValueOfAward: awardAmount,
    baseAndExercisedOptionsValue: awardAmount,
    potentialTotalValueOfAward: Number(raw.base_and_all_options_value) || awardAmount,
    periodOfPerformanceStartDate: startDate,
    periodOfPerformanceCurrentEndDate: currentEndDate,
    periodOfPerformancePotentialEndDate: (raw.period_of_performance_potential_end_date as string) || currentEndDate,
    numberOfOffersReceived: numberOfOffers,
    extentCompeted,
    extentCompetedDescription: extentCompetedDesc,
    typeOfContractPricing: contractType,
    contractDescription: description,
    placeOfPerformanceCity: popCity,
    placeOfPerformanceState: popState,
    placeOfPerformanceZip: popZip,
    modificationNumber: modNumber,
    actionDate,
    isBaseAward: true, // USASpending returns aggregated awards
    competitionLevel: getCompetitionLevel(numberOfOffers, extentCompeted),
    daysUntilExpiration
  };
}

/**
 * Search USASpending for contract awards
 *
 * Uses POST /api/v2/search/spending_by_award/
 */
export async function searchUSASpendingAwards(
  params: ContractAwardSearchParams
): Promise<ContractAwardSearchResult> {
  const page = params.page || 1;
  const size = params.size || 50;

  // Build filters array for USASpending API
  const filters: Record<string, unknown> = {
    award_type_codes: ['A', 'B', 'C', 'D'], // All contract types
  };

  // NAICS filter
  if (params.naicsCode) {
    filters.naics_codes = {
      require: [params.naicsCode]
    };
  }

  // Agency filter
  if (params.agencyCode) {
    filters.agencies = [{
      type: 'awarding',
      tier: 'toptier',
      name: params.agencyCode
    }];
  }

  // Recipient filter
  if (params.vendorUei) {
    filters.recipient_search_text = [params.vendorUei];
  }

  // Date range filter
  if (params.dateSignedFrom || params.dateSignedTo) {
    filters.time_period = [{
      start_date: params.dateSignedFrom || '2020-01-01',
      end_date: params.dateSignedTo || new Date().toISOString().split('T')[0]
    }];
  }

  // NOTE: USASpending search API doesn't support filtering by end_date directly
  // We'll fetch recent contracts and filter client-side by daysUntilExpiration
  // The expiresWithinDays param is handled in the transform step below

  // Competition filter
  if (params.extentCompeted) {
    filters.extent_competed = [params.extentCompeted];
  }

  // Request body
  const requestBody = {
    filters,
    fields: [
      'Award ID',
      'Recipient Name',
      'Recipient UEI',
      'Award Amount',
      'Total Outlays',
      'Description',
      'Contract Award Type',
      'def_codes',
      'COVID-19 Obligations',
      'COVID-19 Outlays',
      'Infrastructure Obligations',
      'Infrastructure Outlays',
      'awarding_agency_id',
      'Start Date',
      'End Date',
      'Last Date to Order',
      'NAICS Code',
      'NAICS Description',
      'Product or Service Code (PSC)',
      'PSC Description',
      'generated_unique_award_id'
    ],
    page,
    limit: size,
    sort: 'Award Amount',
    order: 'desc',
    subawards: false
  };

  try {
    console.log('[USASpending] Searching awards with filters:', JSON.stringify(filters));

    const response = await fetch(`${USASPENDING_BASE_URL}/search/spending_by_award/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[USASpending] API error:', response.status, errorText);
      return {
        contracts: [],
        totalCount: 0,
        page,
        pageSize: size,
        hasMore: false,
        fromCache: false
      };
    }

    const data = await response.json();
    const results = data.results || [];

    // We need to fetch additional details for each award to get competition data
    // The search endpoint returns generated_internal_id (not generated_unique_award_id)
    const contractsWithDetails = await Promise.all(
      results.slice(0, 25).map(async (result: Record<string, unknown>) => {
        // USASpending search returns generated_internal_id for award detail lookups
        const awardId = (result.generated_internal_id as string) ||
          (result.generated_unique_award_id as string);
        if (!awardId) {
          return transformUSASpendingAward(result);
        }

        try {
          // Fetch full award details including competition data
          const detailResponse = await fetch(`${USASPENDING_BASE_URL}/awards/${encodeURIComponent(awardId)}/`);
          if (detailResponse.ok) {
            const details = await detailResponse.json();
            return transformUSASpendingAward(details);
          }
        } catch (err) {
          console.warn(`[USASpending] Failed to get details for ${awardId}:`, err);
        }

        return transformUSASpendingAward(result);
      })
    );

    // Apply client-side expiration filter if requested
    let filteredContracts = contractsWithDetails;
    if (params.expiresWithinDays) {
      filteredContracts = contractsWithDetails.filter(c => {
        const days = c.daysUntilExpiration || 999;
        return days > 0 && days <= params.expiresWithinDays!;
      });
      console.log(`[USASpending] Filtered to ${filteredContracts.length} contracts expiring within ${params.expiresWithinDays} days`);
    }

    return {
      contracts: filteredContracts,
      totalCount: data.page_metadata?.total || results.length,
      page,
      pageSize: size,
      hasMore: data.page_metadata?.hasNext || false,
      fromCache: false
    };

  } catch (err) {
    console.error('[USASpending] Request failed:', err);
    return {
      contracts: [],
      totalCount: 0,
      page,
      pageSize: size,
      hasMore: false,
      fromCache: false
    };
  }
}

/**
 * Get single award details by ID
 *
 * Uses GET /api/v2/awards/{award_id}/
 */
export async function getUSASpendingAward(awardId: string): Promise<ContractAward | null> {
  try {
    const response = await fetch(`${USASPENDING_BASE_URL}/awards/${encodeURIComponent(awardId)}/`);

    if (!response.ok) {
      console.error('[USASpending] Award fetch error:', response.status);
      return null;
    }

    const data = await response.json();
    return transformUSASpendingAward(data);

  } catch (err) {
    console.error('[USASpending] Award fetch failed:', err);
    return null;
  }
}

/**
 * Search for expiring contracts using USASpending
 *
 * Note: USASpending doesn't have a direct "expiring within X days" filter,
 * so we fetch recent contracts and filter client-side
 */
export async function getExpiringContractsUSASpending(
  naicsCode: string,
  expiringMonths: number = 18
): Promise<ContractAward[]> {
  // Calculate date range
  const today = new Date();
  const futureDate = new Date(today.getTime() + expiringMonths * 30 * 24 * 60 * 60 * 1000);

  // Build advanced search request
  const filters = {
    award_type_codes: ['A', 'B', 'C', 'D'],
    naics_codes: {
      require: [naicsCode]
    },
    // Get contracts that were active recently (proxy for expiring soon)
    time_period: [{
      date_type: 'date_signed',
      start_date: new Date(today.getTime() - 5 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end_date: today.toISOString().split('T')[0]
    }]
  };

  try {
    const response = await fetch(`${USASPENDING_BASE_URL}/search/spending_by_award/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filters,
        fields: [
          'Award ID',
          'Recipient Name',
          'Award Amount',
          'Start Date',
          'End Date',
          'NAICS Code',
          'generated_unique_award_id'
        ],
        page: 1,
        limit: 100,
        sort: 'End Date',
        order: 'asc',
        subawards: false
      })
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const results = data.results || [];

    // Fetch details for each to get competition data
    const contracts: ContractAward[] = [];

    for (const result of results.slice(0, 50)) {
      const awardId = result.generated_unique_award_id;
      if (!awardId) continue;

      try {
        const detailResponse = await fetch(`${USASPENDING_BASE_URL}/awards/${encodeURIComponent(awardId)}/`);
        if (detailResponse.ok) {
          const details = await detailResponse.json();
          const contract = transformUSASpendingAward(details);

          // Filter: only include if expiring within our window
          if (contract.daysUntilExpiration !== undefined &&
            contract.daysUntilExpiration > 0 &&
            contract.daysUntilExpiration <= expiringMonths * 30) {
            contracts.push(contract);
          }
        }
      } catch {
        // Skip failed requests
      }
    }

    // Sort by days until expiration
    return contracts.sort((a, b) =>
      (a.daysUntilExpiration || 999) - (b.daysUntilExpiration || 999)
    );

  } catch (err) {
    console.error('[USASpending] Expiring contracts search failed:', err);
    return [];
  }
}

/**
 * Get low-competition contracts from USASpending
 */
export async function getLowCompetitionContractsUSASpending(
  naicsCode: string,
  expiringMonths: number = 12
): Promise<ContractAward[]> {
  const contracts = await getExpiringContractsUSASpending(naicsCode, expiringMonths);

  return contracts.filter(c =>
    c.competitionLevel === 'sole_source' || c.competitionLevel === 'low'
  );
}
