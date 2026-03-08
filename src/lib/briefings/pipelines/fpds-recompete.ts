/**
 * FPDS Recompete Pipeline
 *
 * Fetches expiring contracts from FPDS for recompete tracking.
 * Returns contract end dates, incumbents, values, and NAICS.
 */

import { fetchFPDSByNaics, FPDSAward } from '@/lib/utils/fpds-api';

interface RecompeteContract {
  contractNumber: string;
  orderNumber: string | null;
  piid: string; // Procurement Instrument Identifier

  // Vendor info
  incumbentName: string;
  incumbentDuns: string | null;
  incumbentCage: string | null;

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
 * Convert FPDS award to RecompeteContract
 */
function fpdsAwardToRecompete(award: FPDSAward): RecompeteContract {
  const daysUntilExpiration = calculateDaysUntilExpiration(award.signedDate);
  // Note: FPDS doesn't directly expose end date in all cases
  // We'll use signedDate + estimated duration when available

  return {
    contractNumber: '', // Will be populated from full FPDS data
    orderNumber: null,
    piid: '',

    incumbentName: award.vendorName,
    incumbentDuns: null,
    incumbentCage: null,

    obligatedAmount: award.obligatedAmount,
    baseAndAllOptionsValue: award.obligatedAmount, // Approximate
    naicsCode: award.naicsCode,
    naicsDescription: award.naicsDescription,
    psc: '',

    contractingOffice: award.contractingOffice.officeId,
    contractingOfficeName: award.contractingOffice.officeName,
    agency: award.contractingOffice.agencyName,
    department: award.contractingOffice.departmentName,

    signedDate: award.signedDate,
    effectiveDate: award.signedDate,
    currentCompletionDate: '', // Need full FPDS query
    ultimateCompletionDate: '',

    setAsideType: award.setAsideType || null,
    isSmallBusiness: award.isSmallBusiness,
    isWomenOwned: award.isWomenOwned,
    isVeteranOwned: award.isVeteranOwned,
    isServiceDisabledVeteranOwned: award.isServiceDisabledVeteranOwned,
    is8aProgram: award.is8aProgram,
    isHubZone: award.isHubZone,

    placeOfPerformanceState: award.placeOfPerformanceState,

    daysUntilExpiration,
    expirationRisk: getExpirationRisk(daysUntilExpiration),
  };
}

/**
 * Fetch expiring contracts from FPDS
 */
export async function fetchExpiringContracts(
  params: RecompeteSearchParams
): Promise<RecompeteSearchResult> {
  const {
    naicsCodes = [],
    agencies = [],
    monthsToExpiration = 12,
    limit = 200,
  } = params;

  console.log(`[FPDS Recompete] Fetching expiring contracts for NAICS: ${naicsCodes.join(', ') || 'all'}`);

  const allContracts: RecompeteContract[] = [];

  // Fetch from FPDS for each NAICS code
  for (const naicsCode of naicsCodes.slice(0, 5)) { // Limit to 5 NAICS codes
    try {
      const fpdsResult = await fetchFPDSByNaics(naicsCode, { maxRecords: limit });

      for (const award of fpdsResult.awards) {
        const contract = fpdsAwardToRecompete(award);

        // Filter by expiration window
        if (contract.daysUntilExpiration <= monthsToExpiration * 30) {
          allContracts.push(contract);
        }
      }

      console.log(`[FPDS Recompete] NAICS ${naicsCode}: ${fpdsResult.awards.length} awards`);
    } catch (error) {
      console.error(`[FPDS Recompete] Error fetching NAICS ${naicsCode}:`, error);
    }
  }

  // Sort by days until expiration (soonest first)
  allContracts.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);

  console.log(`[FPDS Recompete] Total expiring contracts: ${allContracts.length}`);

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

  return {
    displacementScore: Math.min(score, 100),
    factors,
  };
}

export type { RecompeteContract, RecompeteSearchParams, RecompeteSearchResult };
