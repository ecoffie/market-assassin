/**
 * Recompete Pipeline
 *
 * Fetches expiring contracts for recompete tracking.
 * UPDATED March 2026: Now uses USASpending API (FPDS retired Feb 24, 2026)
 *
 * Returns contract end dates, incumbents, values, NAICS, and competition data.
 */

import {
  getExpiringContracts as getSAMExpiringContracts,
  searchContractAwards,
  type ContractAward
} from '@/lib/sam';

interface RecompeteContract {
  contractNumber: string;
  orderNumber: string | null;
  piid: string; // Procurement Instrument Identifier

  // Vendor info
  incumbentName: string;
  incumbentDuns: string | null;
  incumbentCage: string | null;
  incumbentUei: string | null; // NEW: UEI (DUNS replacement)

  // Contract details
  obligatedAmount: number;
  baseAndAllOptionsValue: number;
  naicsCode: string;
  naicsDescription: string;
  psc: string;

  // Agency info
  contractingOffice: string;
  contractingOfficeName: string;
  agency: string;
  department: string;

  // Dates
  signedDate: string;
  effectiveDate: string;
  currentCompletionDate: string;
  ultimateCompletionDate: string;

  // Set-aside info
  setAsideType: string | null;
  isSmallBusiness: boolean;
  isWomenOwned: boolean;
  isVeteranOwned: boolean;
  isServiceDisabledVeteranOwned: boolean;
  is8aProgram: boolean;
  isHubZone: boolean;

  // Location
  placeOfPerformanceState: string;

  // Calculated fields
  daysUntilExpiration: number;
  expirationRisk: 'low' | 'medium' | 'high' | 'critical';

  // NEW: Competition intelligence from USASpending
  numberOfBids?: number;
  competitionLevel?: 'sole_source' | 'low' | 'medium' | 'high';
  competitionType?: string; // e.g., "Full and Open Competition"
}

interface RecompeteSearchParams {
  naicsCodes?: string[];
  agencies?: string[];
  incumbents?: string[];
  monthsToExpiration?: number;
  limit?: number;
}

interface RecompeteSearchResult {
  contracts: RecompeteContract[];
  totalCount: number;
  fetchedAt: string;
}

/**
 * Calculate days until contract expiration
 */
function calculateDaysUntilExpiration(endDateStr: string): number {
  if (!endDateStr) return 999;
  const endDate = new Date(endDateStr);
  const today = new Date();
  const diff = endDate.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Determine expiration risk level
 */
function getExpirationRisk(daysUntil: number): 'low' | 'medium' | 'high' | 'critical' {
  if (daysUntil <= 30) return 'critical';
  if (daysUntil <= 90) return 'high';
  if (daysUntil <= 180) return 'medium';
  return 'low';
}

/**
 * Convert SAM/USASpending ContractAward to RecompeteContract
 */
function samAwardToRecompete(award: ContractAward): RecompeteContract {
  const daysUntilExpiration = award.daysUntilExpiration ?? calculateDaysUntilExpiration(award.periodOfPerformanceCurrentEndDate);

  return {
    contractNumber: award.piid,
    orderNumber: null,
    piid: award.piid,

    incumbentName: award.recipientName,
    incumbentDuns: null, // DUNS deprecated
    incumbentCage: null,
    incumbentUei: award.recipientUei || null,

    obligatedAmount: award.totalObligation,
    baseAndAllOptionsValue: award.currentTotalValueOfAward,
    naicsCode: award.naicsCode,
    naicsDescription: award.naicsDescription,
    psc: award.pscCode || '',

    contractingOffice: award.awardingSubAgencyName || '',
    contractingOfficeName: award.awardingSubAgencyName || '',
    agency: award.awardingAgencyName,
    department: award.awardingAgencyName,

    signedDate: award.actionDate || award.periodOfPerformanceStartDate,
    effectiveDate: award.periodOfPerformanceStartDate,
    currentCompletionDate: award.periodOfPerformanceCurrentEndDate,
    ultimateCompletionDate: award.periodOfPerformancePotentialEndDate || award.periodOfPerformanceCurrentEndDate,

    setAsideType: null, // Would need to map from extentCompeted
    isSmallBusiness: false, // Not available in USASpending response
    isWomenOwned: false,
    isVeteranOwned: false,
    isServiceDisabledVeteranOwned: false,
    is8aProgram: false,
    isHubZone: false,

    placeOfPerformanceState: award.placeOfPerformanceState || '',

    daysUntilExpiration,
    expirationRisk: getExpirationRisk(daysUntilExpiration),

    // NEW: Competition intelligence
    numberOfBids: award.numberOfOffersReceived,
    competitionLevel: award.competitionLevel,
    competitionType: award.extentCompetedDescription,
  };
}

/**
 * Fetch expiring contracts from USASpending (FPDS retired Feb 2026)
 */
export async function fetchExpiringContracts(
  params: RecompeteSearchParams
): Promise<RecompeteSearchResult> {
  const {
    naicsCodes = [],
    monthsToExpiration = 12,
    limit = 200,
  } = params;

  console.log(`[Recompete] Fetching expiring contracts for NAICS: ${naicsCodes.join(', ') || 'all'}`);

  const allContracts: RecompeteContract[] = [];

  // Fetch from USASpending via our SAM wrapper for each NAICS code
  for (const naicsCode of naicsCodes.slice(0, 5)) { // Limit to 5 NAICS codes
    try {
      const samContracts = await getSAMExpiringContracts(naicsCode, monthsToExpiration);

      for (const award of samContracts) {
        const contract = samAwardToRecompete(award);

        // Filter by expiration window and minimum value ($100k+)
        if (contract.daysUntilExpiration > 0 &&
          contract.daysUntilExpiration <= monthsToExpiration * 30 &&
          contract.obligatedAmount >= 100000) {
          allContracts.push(contract);
        }
      }

      console.log(`[Recompete] NAICS ${naicsCode}: ${samContracts.length} awards`);
    } catch (error) {
      console.error(`[Recompete] Error fetching NAICS ${naicsCode}:`, error);
    }
  }

  // Sort by days until expiration (soonest first)
  allContracts.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);

  console.log(`[Recompete] Total expiring contracts: ${allContracts.length}`);

  return {
    contracts: allContracts.slice(0, limit),
    totalCount: allContracts.length,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch recompetes for a specific user's watchlist
 */
export async function fetchRecompetesForUser(
  userProfile: {
    naics_codes: string[];
    agencies: string[];
    watched_companies: string[];
    watched_contracts: string[];
  }
): Promise<RecompeteSearchResult> {
  return fetchExpiringContracts({
    naicsCodes: userProfile.naics_codes?.slice(0, 5) || [],
    agencies: userProfile.agencies?.slice(0, 10) || [],
    incumbents: userProfile.watched_companies?.slice(0, 10) || [],
    monthsToExpiration: 12,
    limit: 200,
  });
}

/**
 * Compare two snapshots and identify changes
 */
export function diffRecompetes(
  today: RecompeteContract[],
  yesterday: RecompeteContract[]
): {
  newRecompetes: RecompeteContract[];
  enteredWindow: RecompeteContract[]; // Now <90 days
  timelineChanges: Array<{
    contract: RecompeteContract;
    changes: string[];
  }>;
  incumbentChanges: Array<{
    contract: RecompeteContract;
    previousIncumbent: string;
  }>;
} {
  const yesterdayMap = new Map(
    yesterday.map(c => [c.contractNumber || c.incumbentName + c.naicsCode, c])
  );
  const todayMap = new Map(
    today.map(c => [c.contractNumber || c.incumbentName + c.naicsCode, c])
  );

  // NEW RECOMPETES: in today but not yesterday
  const newRecompetes = today.filter(c =>
    !yesterdayMap.has(c.contractNumber || c.incumbentName + c.naicsCode)
  );

  // ENTERED WINDOW: was >90 days, now <=90 days
  const enteredWindow: RecompeteContract[] = [];
  const timelineChanges: Array<{ contract: RecompeteContract; changes: string[] }> = [];
  const incumbentChanges: Array<{ contract: RecompeteContract; previousIncumbent: string }> = [];

  for (const contract of today) {
    const key = contract.contractNumber || contract.incumbentName + contract.naicsCode;
    const prev = yesterdayMap.get(key);
    if (!prev) continue;

    // Check if entered 90-day window
    if (prev.daysUntilExpiration > 90 && contract.daysUntilExpiration <= 90) {
      enteredWindow.push(contract);
    }

    // Check timeline changes
    const changes: string[] = [];
    if (contract.currentCompletionDate !== prev.currentCompletionDate) {
      changes.push(`end_date_moved: ${prev.currentCompletionDate} → ${contract.currentCompletionDate}`);
    }
    if (contract.obligatedAmount !== prev.obligatedAmount) {
      const diff = contract.obligatedAmount - prev.obligatedAmount;
      changes.push(`obligation_changed: ${diff > 0 ? '+' : ''}$${diff.toLocaleString()}`);
    }
    if (changes.length > 0) {
      timelineChanges.push({ contract, changes });
    }

    // Check incumbent changes
    if (contract.incumbentName !== prev.incumbentName) {
      incumbentChanges.push({
        contract,
        previousIncumbent: prev.incumbentName,
      });
    }
  }

  return {
    newRecompetes,
    enteredWindow,
    timelineChanges,
    incumbentChanges,
  };
}

/**
 * Score a recompete opportunity for displacement potential
 */
export function scoreRecompete(
  contract: RecompeteContract,
  userProfile: {
    naics_codes: string[];
    agencies: string[];
    watched_companies: string[];
  }
): {
  displacementScore: number;
  factors: string[];
} {
  let score = 0;
  const factors: string[] = [];

  // NAICS match (highest weight)
  if (userProfile.naics_codes.includes(contract.naicsCode)) {
    score += 30;
    factors.push('exact_naics_match');
  } else if (userProfile.naics_codes.some(n =>
    contract.naicsCode.startsWith(n) || n.startsWith(contract.naicsCode)
  )) {
    score += 15;
    factors.push('related_naics');
  }

  // Urgency bonus
  if (contract.expirationRisk === 'critical') {
    score += 25;
    factors.push('expires_within_30_days');
  } else if (contract.expirationRisk === 'high') {
    score += 20;
    factors.push('expires_within_90_days');
  } else if (contract.expirationRisk === 'medium') {
    score += 10;
    factors.push('expires_within_180_days');
  }

  // Small business set-aside
  if (contract.isSmallBusiness || contract.setAsideType) {
    score += 15;
    factors.push('small_business_setaside');
  }

  // Watched competitor is incumbent
  if (userProfile.watched_companies.some(c =>
    contract.incumbentName.toLowerCase().includes(c.toLowerCase())
  )) {
    score += 20;
    factors.push('watched_competitor_incumbent');
  }

  // Contract value (larger = more opportunity)
  if (contract.obligatedAmount >= 10000000) {
    score += 15;
    factors.push('high_value_contract');
  } else if (contract.obligatedAmount >= 1000000) {
    score += 10;
    factors.push('million_dollar_contract');
  }

  // NEW: Low competition = higher displacement potential
  if (contract.competitionLevel === 'sole_source') {
    score += 20;
    factors.push('sole_source_contract');
  } else if (contract.competitionLevel === 'low') {
    score += 15;
    factors.push('low_competition_2_or_fewer_bids');
  } else if (contract.numberOfBids !== undefined && contract.numberOfBids <= 3) {
    score += 10;
    factors.push('moderate_competition_3_bids');
  }

  return {
    displacementScore: Math.min(score, 100),
    factors,
  };
}

/**
 * Fetch expiring contracts from local pre-populated data (contracts-data.js)
 * This uses the same data as the Recompete Tracker - comprehensive FPDS dump
 */
export async function fetchExpiringContractsFromLocal(
  params: RecompeteSearchParams & { baseUrl?: string }
): Promise<RecompeteSearchResult> {
  const {
    naicsCodes = [],
    monthsToExpiration = 12,
    limit = 200,
    baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tools.govcongiants.org',
  } = params;

  console.log(`[Recompete-Local] Fetching from contracts-data.js for NAICS: ${naicsCodes.join(', ') || 'all'}`);

  try {
    // Fetch the pre-populated contracts data
    const dataUrl = `${baseUrl}/contracts-data.js?v=${Date.now()}`;
    const response = await fetch(dataUrl, { signal: AbortSignal.timeout(15000) });

    if (!response.ok) {
      throw new Error(`Failed to fetch contracts-data.js: ${response.status}`);
    }

    const text = await response.text();
    // Parse: strip "const expiringContractsData = " prefix and trailing ";"
    const jsonStr = text.replace(/^[^[]*/, '').replace(/;?\s*$/, '');
    const allContracts = JSON.parse(jsonStr) as LocalContract[];

    console.log(`[Recompete-Local] Loaded ${allContracts.length} contracts from local data`);

    // Filter by NAICS codes (match prefix)
    const naicsPrefixes = naicsCodes.map(code => code.slice(0, 3)); // First 3 digits
    const matchingContracts = allContracts.filter(contract => {
      if (!contract.NAICS) return false;
      const contractNaics = contract.NAICS.split(' - ')[0].trim();
      // Match full code or prefix
      return naicsCodes.some(code => contractNaics.startsWith(code)) ||
             naicsPrefixes.some(prefix => contractNaics.startsWith(prefix));
    });

    console.log(`[Recompete-Local] ${matchingContracts.length} contracts match NAICS filter`);

    // Convert to RecompeteContract format
    const recompeteContracts: RecompeteContract[] = matchingContracts.map(contract => {
      const daysUntilExpiration = calculateDaysUntilExpiration(parseLocalDate(contract.Expiration));
      const naicsParts = (contract.NAICS || '').split(' - ');
      const naicsCode = naicsParts[0]?.trim() || '';
      const naicsDescription = naicsParts.slice(1).join(' - ').trim() || '';

      return {
        contractNumber: contract['Award ID']?.split(' (')[0]?.trim() || '',
        orderNumber: null,
        piid: contract['Award ID']?.split(' (')[0]?.trim() || '',

        incumbentName: contract.Recipient || 'Unknown',
        incumbentDuns: null,
        incumbentCage: null,
        incumbentUei: null,

        obligatedAmount: parseValue(contract['Total Value']),
        baseAndAllOptionsValue: parseValue(contract['Total Value']),
        naicsCode,
        naicsDescription,
        psc: '',

        contractingOffice: contract.Office || '',
        contractingOfficeName: contract.Office || '',
        agency: contract.Agency || '',
        department: contract.Agency || '',

        signedDate: parseLocalDate(contract['Start Date']),
        effectiveDate: parseLocalDate(contract['Start Date']),
        currentCompletionDate: parseLocalDate(contract.Expiration),
        ultimateCompletionDate: parseLocalDate(contract.Expiration),

        setAsideType: null,
        isSmallBusiness: false,
        isWomenOwned: false,
        isVeteranOwned: false,
        isServiceDisabledVeteranOwned: false,
        is8aProgram: false,
        isHubZone: false,

        placeOfPerformanceState: contract.State || '',

        daysUntilExpiration,
        expirationRisk: getExpirationRisk(daysUntilExpiration),

        numberOfBids: undefined,
        competitionLevel: undefined,
        competitionType: undefined,
      };
    });

    // Filter by expiration window (future contracts only, within monthsToExpiration)
    const maxDays = monthsToExpiration * 30;
    const filtered = recompeteContracts.filter(c =>
      c.daysUntilExpiration > 0 && c.daysUntilExpiration <= maxDays
    );

    // Sort by days until expiration (soonest first)
    filtered.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);

    console.log(`[Recompete-Local] Returning ${Math.min(filtered.length, limit)} contracts (${filtered.length} in window)`);

    return {
      contracts: filtered.slice(0, limit),
      totalCount: filtered.length,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[Recompete-Local] Error:`, error);
    // Fall back to USASpending API
    console.log(`[Recompete-Local] Falling back to USASpending API...`);
    return fetchExpiringContracts(params);
  }
}

// Local contract format from contracts-data.js
interface LocalContract {
  Recipient: string;
  Agency: string;
  Office?: string;
  NAICS: string;
  State?: string;
  'Total Value': string;
  'Contract Count'?: number;
  Expiration: string;
  'Award ID': string;
  'Start Date': string;
  Contracts?: Array<{
    'Award ID': string;
    'Start Date': string;
    Expiration: string;
    Value: string;
  }>;
}

// Parse "$1,234,567.89 " to number
function parseValue(valueStr: string | undefined): number {
  if (!valueStr) return 0;
  const cleaned = valueStr.replace(/[$,\s]/g, '');
  return parseFloat(cleaned) || 0;
}

// Parse "M/D/YYYY" to ISO date string
function parseLocalDate(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length !== 3) return '';
  const [month, day, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export type { RecompeteContract, RecompeteSearchParams, RecompeteSearchResult };
