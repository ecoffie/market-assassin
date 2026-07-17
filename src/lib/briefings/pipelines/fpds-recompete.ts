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
import { expandNaicsPrefixes, hasNaicsPrefixes } from '@/lib/industry-presets';

// The LIVE recompete source (Supabase `recompete_opportunities`, synced hourly).
// ONE shared query — see src/lib/recompete/query.ts. Never hand-roll a second one.
import { queryExpiringContracts, type ExpiringContract } from '@/lib/recompete/query';

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

  // IMPORTANT: USASpending API requires full 6-digit NAICS codes
  // Expand any 3-4 digit prefixes (e.g., "236" -> ["236115", "236116", ...])
  let codesToUse = naicsCodes;
  if (hasNaicsPrefixes(naicsCodes)) {
    const expanded = expandNaicsPrefixes(naicsCodes);
    console.log(`[Recompete] Expanded ${naicsCodes.length} NAICS prefixes to ${expanded.length} full codes`);
    codesToUse = expanded;
  }

  const allContracts: RecompeteContract[] = [];

  // Fetch from USASpending via our SAM wrapper for each NAICS code
  // Limit to avoid rate limiting - expanded lists can be long
  for (const naicsCode of codesToUse.slice(0, 10)) {
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
 * Fetch + filter expiring contracts for a SINGLE NAICS code.
 *
 * This is the unit of work that's actually user-independent: the result depends
 * only on (naicsCode, monthsToExpiration), NOT on any user's agencies/watchlist
 * (fetchExpiringContracts ignores those). That makes it safe to fetch each unique
 * NAICS ONCE and share the result across every user who watches it — how the
 * snapshot cron avoids one API call per user-NAICS (thousands) in favor of one
 * per unique NAICS (hundreds). Same filter as fetchExpiringContracts.
 */
export async function fetchExpiringForNaicsCode(
  naicsCode: string,
  monthsToExpiration = 12
): Promise<RecompeteContract[]> {
  const samContracts = await getSAMExpiringContracts(naicsCode, monthsToExpiration);
  const out: RecompeteContract[] = [];
  for (const award of samContracts) {
    const contract = samAwardToRecompete(award);
    if (
      contract.daysUntilExpiration > 0 &&
      contract.daysUntilExpiration <= monthsToExpiration * 30 &&
      contract.obligatedAmount >= 100000
    ) {
      out.push(contract);
    }
  }
  return out;
}

/**
 * The NAICS codes actually queried for a user — mirrors the slicing/prefix-
 * expansion fetchRecompetesForUser + fetchExpiringContracts apply (first 5 raw
 * codes → expand prefixes → cap at 10). Kept in lockstep so the deduped cron
 * produces the same per-user result as the old per-user fetch.
 */
export function recompeteCodesForUser(naicsCodes: string[]): string[] {
  let codes = (naicsCodes || []).slice(0, 5);
  if (hasNaicsPrefixes(codes)) {
    codes = expandNaicsPrefixes(codes);
  }
  return codes.slice(0, 10);
}

/**
 * Assemble one user's RecompeteSearchResult from a prefetched per-NAICS cache —
 * pure in-memory filtering, no API calls. Dedupes by PIID (a contract can surface
 * under more than one of a user's codes), then sorts soonest-expiring first.
 */
export function assembleRecompetesFromCache(
  userCodes: string[],
  cache: Map<string, RecompeteContract[]>,
  limit = 200
): RecompeteSearchResult {
  const seen = new Set<string>();
  const all: RecompeteContract[] = [];
  for (const code of userCodes) {
    for (const contract of cache.get(code) || []) {
      const key = contract.piid || contract.contractNumber || `${contract.incumbentName}:${contract.ultimateCompletionDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(contract);
    }
  }
  all.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);
  return {
    contracts: all.slice(0, limit),
    totalCount: all.length,
    fetchedAt: new Date().toISOString(),
  };
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
 * Convert a `recompete_opportunities` row into the RecompeteContract shape the
 * briefing generators consume. Fields the table doesn't carry stay null/false —
 * we do NOT invent them (an absent set-aside is not "not a set-aside").
 */
function dbRowToRecompete(row: ExpiringContract): RecompeteContract {
  const end = row.period_of_performance_current_end || '';
  const daysUntilExpiration = calculateDaysUntilExpiration(end);
  const piid = row.piid || row.contract_id || '';

  return {
    contractNumber: piid,
    orderNumber: null,
    piid,

    incumbentName: row.incumbent_name || 'Unknown',
    incumbentDuns: null, // DUNS deprecated
    incumbentCage: null,
    incumbentUei: row.incumbent_uei || null,

    obligatedAmount: row.total_obligation ?? 0,
    baseAndAllOptionsValue: row.potential_total_value ?? row.total_obligation ?? 0,
    naicsCode: row.naics_code || '',
    naicsDescription: row.naics_description || '',
    psc: row.psc_code || '',

    contractingOffice: row.awarding_sub_agency || '',
    contractingOfficeName: row.awarding_sub_agency || '',
    agency: row.awarding_agency || '',
    department: row.awarding_agency || '',

    signedDate: row.period_of_performance_start || '',
    effectiveDate: row.period_of_performance_start || '',
    currentCompletionDate: end,
    ultimateCompletionDate: end,

    setAsideType: row.set_aside_type || null,
    isSmallBusiness: false, // not carried by the table — do not infer
    isWomenOwned: false,
    isVeteranOwned: false,
    isServiceDisabledVeteranOwned: false,
    is8aProgram: false,
    isHubZone: false,

    placeOfPerformanceState: row.place_of_performance_state || '',

    daysUntilExpiration,
    expirationRisk: getExpirationRisk(daysUntilExpiration),

    numberOfBids: row.number_of_offers ?? undefined,
    competitionLevel: undefined,
    competitionType: row.competition_type || undefined,
  };
}

/**
 * Fetch expiring contracts from the LIVE `recompete_opportunities` table — the
 * same indexed Supabase rows the MCP `get_expiring_contracts` tool and the
 * Recompete Tracker read, synced hourly from USASpending.
 *
 * Replaces the old `contracts-data.json` build-time dump (issue #292): that file
 * was frozen 2026-04-08, held grouped/synthetic rows whose PIID and expiry date
 * could describe DIFFERENT contracts (#280), and carried no UEI at all. It was
 * the PRIMARY source and shadowed every live path.
 *
 * Reuses the shared `queryExpiringContracts` (src/lib/recompete/query.ts) — it
 * already filters `quality_flag IS NULL` (excludes the flagged grouped_synthetic
 * rows) and applies the expiry window server-side. Do NOT hand-roll a second
 * query against this table.
 */
export async function fetchExpiringContractsFromDb(
  params: RecompeteSearchParams & { baseUrl?: string }
): Promise<RecompeteSearchResult> {
  const {
    naicsCodes = [],
    monthsToExpiration = 12,
    limit = 200,
  } = params;

  // Mirrors the per-user cap the USASpending path applies (first 10 codes).
  // No prefix expansion needed: queryExpiringContracts treats a <6-char code as
  // a prefix (`naics_code LIKE '236%'`) and a 6-digit code as exact.
  const codesToUse = (naicsCodes.length > 0 ? naicsCodes : ['']).slice(0, 10);

  console.log(`[Recompete-DB] Querying recompete_opportunities for NAICS: ${naicsCodes.join(', ') || 'all'}`);

  try {
    const results = await Promise.all(
      codesToUse.map((naics) =>
        queryExpiringContracts({
          naics: naics || undefined,
          monthsWindow: monthsToExpiration,
          limit: Math.min(Math.max(limit, 1), 200),
        })
      )
    );

    // A Supabase failure must NOT masquerade as "no contracts" — that would look
    // like a clean empty briefing. Surface it as an error so the catch below
    // falls back to the live API, same as the old implementation did on throw.
    if (results.some((r) => r.degraded)) {
      throw new Error('recompete_opportunities query degraded');
    }

    // Dedupe: one contract can surface under more than one of a user's codes.
    const seen = new Set<string>();
    const contracts: RecompeteContract[] = [];
    for (const result of results) {
      for (const row of result.contracts) {
        const key = row.contract_id || row.piid || '';
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        contracts.push(dbRowToRecompete(row));
      }
    }

    // Soonest-expiring first (the window filter already ran in the query).
    contracts.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);

    console.log(`[Recompete-DB] Returning ${Math.min(contracts.length, limit)} contracts (${contracts.length} in window)`);

    return {
      contracts: contracts.slice(0, limit),
      totalCount: contracts.length,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[Recompete-DB] Error:`, error);
    // Fall back to the live USASpending API (unchanged behavior on failure).
    console.log(`[Recompete-DB] Falling back to USASpending API...`);
    return fetchExpiringContracts(params);
  }
}

export type { RecompeteContract, RecompeteSearchParams, RecompeteSearchResult };
