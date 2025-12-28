/**
 * IDV Contract Search Module
 * GovCon Giants - USASpending.gov API Integration
 */

const API_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

// Award Type Codes
const IDV_CODES = ["IDV_A", "IDV_B", "IDV_B_A", "IDV_B_B", "IDV_B_C", "IDV_C", "IDV_D", "IDV_E"];
const TASK_ORDER_CODES = ["A", "B", "C", "D"];

// Types
export interface IDVSearchOptions {
  naicsCode?: string;
  pscCode?: string;
  agency?: string;
  minValue?: number;
  dateFrom?: string;
  dateTo?: string;
  state?: string;
  stateFilterType?: 'recipient' | 'pop';
  limit?: number;
  page?: number;
}

export interface IDVContract {
  awardId: string;
  recipientName: string;
  recipientUei: string;
  awardAmount: number;
  description: string;
  startDate: string;
  endDate: string;
  agency: string;
  subAgency: string;
  naicsCode: string;
  naicsDescription: string;
  pscCode: string;
  pscDescription: string;
  recipientState: string;
  popState: string;
  generatedId: string;
  usaSpendingUrl: string;
}

export interface IDVSearchResult {
  contracts: IDVContract[];
  totalCount: number;
  page: number;
  hasNextPage: boolean;
  searchType: 'idv_contracts' | 'task_orders';
}

/**
 * Search for IDV contracts or task orders
 */
export async function searchIDVContracts(options: IDVSearchOptions = {}): Promise<IDVSearchResult> {
  const {
    naicsCode,
    pscCode,
    agency,
    minValue = 0,
    dateFrom,
    dateTo,
    state,
    stateFilterType = 'recipient',
    limit = 50,
    page = 1
  } = options;

  const isTaskOrderSearch = state && stateFilterType === 'pop';

  const requestBody: Record<string, unknown> = {
    filters: {
      award_type_codes: isTaskOrderSearch ? TASK_ORDER_CODES : IDV_CODES,
      award_amounts: [{ lower_bound: minValue }]
    },
    fields: [
      "Award ID",
      "Recipient Name",
      "Recipient UEI",
      "Award Amount",
      "Total Outlays",
      "Description",
      "Start Date",
      "End Date",
      "Awarding Agency",
      "Awarding Sub Agency",
      "NAICS Code",
      "NAICS Description",
      "Product or Service Code",
      "Product or Service Code Description",
      "Contract Award Type",
      "Recipient State Code",
      "Place of Performance State Code",
      "generated_unique_award_id"
    ],
    page,
    limit,
    sort: "Award Amount",
    order: "desc",
    subawards: false
  };

  const filters = requestBody.filters as Record<string, unknown>;

  // Add time period filter
  if (dateFrom || dateTo) {
    const effectiveStartDate = dateFrom || '2000-01-01';
    const effectiveEndDate = dateTo || new Date().toISOString().split('T')[0];
    filters.time_period = [{
      start_date: effectiveStartDate,
      end_date: effectiveEndDate
    }];
  }

  // Add NAICS filter
  if (naicsCode) {
    let cleanNaics = naicsCode.replace(/0+$/, '') || naicsCode;
    if (cleanNaics.length === 1) cleanNaics = cleanNaics + '0';
    else if (cleanNaics.length === 3) cleanNaics = cleanNaics.substring(0, 2);
    else if (cleanNaics.length === 5) cleanNaics = cleanNaics + '0';
    filters.naics_codes = { require: [cleanNaics] };
  }

  // Add PSC code filter
  if (pscCode) {
    // PSC codes are typically 4 characters (e.g., "R425", "J045", "Z2JZ")
    // The API accepts the full code or prefix for broader matching
    const cleanPsc = pscCode.trim().toUpperCase();
    filters.psc_codes = { require: [cleanPsc] };
  }

  // Add agency filter
  if (agency) {
    filters.agencies = [{
      type: "awarding",
      tier: "toptier",
      name: agency
    }];
  }

  // Add state filter
  if (state) {
    if (stateFilterType === 'pop') {
      filters.place_of_performance_locations = [{
        country: "USA",
        state: state
      }];
    } else {
      filters.recipient_locations = [{
        country: "USA",
        state: state
      }];
    }
  }

  // Make API request
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`USASpending API error: ${response.status}`);
  }

  const data = await response.json();

  // Process results
  const contracts: IDVContract[] = (data.results || []).map((c: Record<string, unknown>) => ({
    awardId: c['Award ID'] as string || '',
    recipientName: c['Recipient Name'] as string || '',
    recipientUei: c['Recipient UEI'] as string || '',
    awardAmount: parseFloat(c['Award Amount'] as string) || 0,
    description: c['Description'] as string || '',
    startDate: c['Start Date'] as string || '',
    endDate: c['End Date'] as string || '',
    agency: c['Awarding Agency'] as string || '',
    subAgency: c['Awarding Sub Agency'] as string || '',
    naicsCode: c['NAICS Code'] as string || '',
    naicsDescription: c['NAICS Description'] as string || '',
    pscCode: c['Product or Service Code'] as string || '',
    pscDescription: c['Product or Service Code Description'] as string || '',
    recipientState: c['Recipient State Code'] as string || '',
    popState: c['Place of Performance State Code'] as string || '',
    generatedId: c['generated_unique_award_id'] as string || '',
    usaSpendingUrl: c['generated_unique_award_id']
      ? `https://www.usaspending.gov/award/${c['generated_unique_award_id']}`
      : `https://www.usaspending.gov/keyword_search/${encodeURIComponent(c['Award ID'] as string || '')}`
  }));

  return {
    contracts,
    totalCount: contracts.length,
    page,
    hasNextPage: data.page_metadata?.hasNext || false,
    searchType: isTaskOrderSearch ? 'task_orders' : 'idv_contracts'
  };
}

/**
 * Search by contractor headquarters state
 */
export async function searchByContractorState(state: string, options: Omit<IDVSearchOptions, 'state' | 'stateFilterType'> = {}) {
  return searchIDVContracts({ ...options, state, stateFilterType: 'recipient' });
}

/**
 * Search by work location (place of performance)
 */
export async function searchByWorkLocation(state: string, options: Omit<IDVSearchOptions, 'state' | 'stateFilterType'> = {}) {
  return searchIDVContracts({ ...options, state, stateFilterType: 'pop' });
}

/**
 * List of federal agencies
 */
export const AGENCIES = [
  "Department of Defense",
  "Department of Health and Human Services",
  "Department of Homeland Security",
  "Department of Veterans Affairs",
  "General Services Administration",
  "National Aeronautics and Space Administration",
  "Department of the Interior",
  "Department of Transportation",
  "Department of Energy",
  "Department of Justice",
  "Department of the Treasury",
  "Department of State"
] as const;

/**
 * List of US state codes
 */
export const STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL",
  "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
  "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
] as const;
