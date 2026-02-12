// Budget Authority Utility
// Fetches and compares FY2025 vs FY2026 budget data from USASpending API
// and provides cached lookups from agency-budget-data.json

import agencyToptierCodes from '@/data/agency-toptier-codes.json';
import agencyBudgetDataRaw from '@/data/agency-budget-data.json';

const USASPENDING_BASE = 'https://api.usaspending.gov/api/v2';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type BudgetTrend = 'surging' | 'growing' | 'stable' | 'declining' | 'cut';

export interface AgencyBudgetSnapshot {
  budgetAuthority: number;
  obligated: number;
  outlays: number;
}

export interface AgencyBudgetData {
  agency: string;
  toptierCode: string;
  fy2025: AgencyBudgetSnapshot;
  fy2026: AgencyBudgetSnapshot;
  change: {
    amount: number;       // raw dollar change in budget authority
    percent: number;      // e.g., 1.05 = 5% increase, 0.88 = 12% decrease
    trend: BudgetTrend;
  };
}

export interface BudgetCheckupReport {
  agencyBudgets: AgencyBudgetData[];
  winners: AgencyBudgetData[];      // top agencies by % increase
  losers: AgencyBudgetData[];       // agencies with biggest % decrease
  summary: {
    totalFY2025: number;
    totalFY2026: number;
    overallChange: number;          // percent as decimal (1.05 = 5% increase)
    agenciesGrowing: number;
    agenciesDeclining: number;
    biggestWinner: string;
    biggestLoser: string;
  };
  recommendations: string[];
}

interface CachedBudgetDatabase {
  lastUpdated: string;
  fiscalYears: number[];
  agencies: Record<string, {
    toptierCode: string;
    fy2025: AgencyBudgetSnapshot;
    fy2026: AgencyBudgetSnapshot;
    change: { amount: number; percent: number; trend: BudgetTrend };
  }>;
}

interface ToptierAgencyResult {
  agency_name: string;
  toptier_code: string;
  abbreviation: string;
  budget_authority_amount: number;          // per-agency budget authority
  current_total_budget_authority_amount: number; // total federal budget (all agencies)
  percentage_of_total_budget_authority: number;
  obligated_amount: number;
  outlay_amount: number;
  active_fy: string;
  active_fq: string;
}

// ──────────────────────────────────────────────
// API Functions (for admin build endpoint)
// ──────────────────────────────────────────────

/**
 * Fetch all toptier agencies with their budget data for a given fiscal year.
 * Uses the toptier_agencies endpoint which returns budget authority, obligations, and outlays.
 */
export async function fetchAllToptierBudgets(fiscalYear?: number): Promise<Array<{
  agencyName: string;
  toptierCode: string;
  abbreviation: string;
  budgetAuthority: number;
  obligated: number;
  outlays: number;
}>> {
  const url = fiscalYear
    ? `${USASPENDING_BASE}/references/toptier_agencies/?sort=budget_authority_amount&order=desc`
    : `${USASPENDING_BASE}/references/toptier_agencies/?sort=budget_authority_amount&order=desc`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`USASpending toptier_agencies returned ${response.status}`);
  }

  const data = await response.json();
  const results: Array<{
    agencyName: string;
    toptierCode: string;
    abbreviation: string;
    budgetAuthority: number;
    obligated: number;
    outlays: number;
  }> = [];

  if (data.results && Array.isArray(data.results)) {
    for (const agency of data.results as ToptierAgencyResult[]) {
      const budget = agency.budget_authority_amount || 0;
      if (budget <= 0) continue;

      results.push({
        agencyName: agency.agency_name,
        toptierCode: agency.toptier_code,
        abbreviation: agency.abbreviation || '',
        budgetAuthority: budget,
        obligated: agency.obligated_amount || 0,
        outlays: agency.outlay_amount || 0,
      });
    }
  }

  return results;
}

/**
 * Fetch budgetary resources for a specific agency — returns ALL fiscal years in one call.
 * Uses the /agency/{code}/budgetary_resources/ endpoint.
 */
export async function fetchAgencyBudgetaryResources(
  toptierCode: string
): Promise<Array<{
  fiscalYear: number;
  budgetAuthority: number;
  obligated: number;
  outlays: number;
}>> {
  const url = `${USASPENDING_BASE}/agency/${toptierCode}/budgetary_resources/`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`USASpending agency/${toptierCode}/budgetary_resources returned ${response.status}`);
  }

  const data = await response.json();
  const results: Array<{
    fiscalYear: number;
    budgetAuthority: number;
    obligated: number;
    outlays: number;
  }> = [];

  if (data.agency_data_by_year && Array.isArray(data.agency_data_by_year)) {
    for (const yearData of data.agency_data_by_year) {
      results.push({
        fiscalYear: yearData.fiscal_year,
        budgetAuthority: yearData.agency_budgetary_resources || 0,
        obligated: yearData.agency_total_obligated || 0,
        outlays: yearData.agency_total_outlayed || 0,
      });
    }
  }

  return results;
}

/**
 * Fetch budget data for a specific agency and fiscal year.
 * Convenience wrapper around fetchAgencyBudgetaryResources.
 */
export async function fetchAgencyBudget(
  toptierCode: string,
  fiscalYear: number
): Promise<AgencyBudgetSnapshot> {
  const allYears = await fetchAgencyBudgetaryResources(toptierCode);
  const yearData = allYears.find(y => y.fiscalYear === fiscalYear);

  return {
    budgetAuthority: yearData?.budgetAuthority || 0,
    obligated: yearData?.obligated || 0,
    outlays: yearData?.outlays || 0,
  };
}

/**
 * Classify an agency's budget trend based on year-over-year percent change.
 */
export function classifyAgencyTrend(percentChange: number): BudgetTrend {
  // percentChange is a ratio: 1.20 = 20% increase, 0.80 = 20% decrease
  const pctDelta = (percentChange - 1) * 100;
  if (pctDelta >= 20) return 'surging';
  if (pctDelta >= 5) return 'growing';
  if (pctDelta > -5) return 'stable';
  if (pctDelta > -20) return 'declining';
  return 'cut';
}

/**
 * Compare year-over-year budgets for a single agency.
 * Fetches FY2025 + FY2026 in a single API call via budgetary_resources endpoint.
 */
export async function compareYearOverYear(
  toptierCode: string
): Promise<{ fy2025: AgencyBudgetSnapshot; fy2026: AgencyBudgetSnapshot; change: { amount: number; percent: number; trend: BudgetTrend } }> {
  const allYears = await fetchAgencyBudgetaryResources(toptierCode);

  const fy2025Data = allYears.find(y => y.fiscalYear === 2025);
  const fy2026Data = allYears.find(y => y.fiscalYear === 2026);

  const fy2025: AgencyBudgetSnapshot = {
    budgetAuthority: fy2025Data?.budgetAuthority || 0,
    obligated: fy2025Data?.obligated || 0,
    outlays: fy2025Data?.outlays || 0,
  };

  const fy2026: AgencyBudgetSnapshot = {
    budgetAuthority: fy2026Data?.budgetAuthority || 0,
    obligated: fy2026Data?.obligated || 0,
    outlays: fy2026Data?.outlays || 0,
  };

  const amount = fy2026.budgetAuthority - fy2025.budgetAuthority;
  const percent = fy2025.budgetAuthority > 0
    ? fy2026.budgetAuthority / fy2025.budgetAuthority
    : 1;
  const trend = classifyAgencyTrend(percent);

  return { fy2025, fy2026, change: { amount, percent, trend } };
}

/**
 * Build a full budget checkup for a list of agencies.
 * Used by the admin build endpoint to generate cached data.
 */
export async function buildBudgetCheckup(agencyNames: string[]): Promise<BudgetCheckupReport> {
  const toptierCodes = agencyToptierCodes as Record<string, { code: string; abbreviation: string }>;

  const budgetData: AgencyBudgetData[] = [];

  for (const agencyName of agencyNames) {
    const mapping = toptierCodes[agencyName];
    if (!mapping) continue;

    try {
      const result = await compareYearOverYear(mapping.code);
      budgetData.push({
        agency: agencyName,
        toptierCode: mapping.code,
        ...result,
      });

      // Rate limit: 500ms between API calls
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.warn(`[budget-authority] Failed to fetch budget for ${agencyName}:`, error);
    }
  }

  return buildCheckupFromData(budgetData);
}

// ──────────────────────────────────────────────
// Cached Data Lookup Functions
// ──────────────────────────────────────────────

const cachedBudgetDB = agencyBudgetDataRaw as CachedBudgetDatabase;

function loadCachedBudgetData(): CachedBudgetDatabase | null {
  if (!cachedBudgetDB || !cachedBudgetDB.agencies || Object.keys(cachedBudgetDB.agencies).length === 0) {
    return null;
  }
  return cachedBudgetDB;
}

/**
 * Normalize an agency name for fuzzy matching against cached data.
 */
function normalizeAgencyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim();
}

/**
 * Get budget data for a single agency from the cached JSON.
 * Supports exact match and fuzzy matching.
 */
export function getBudgetForAgency(agencyName: string): AgencyBudgetData | null {
  const db = loadCachedBudgetData();
  if (!db) return null;

  // Exact match
  if (db.agencies[agencyName]) {
    const entry = db.agencies[agencyName];
    return { agency: agencyName, ...entry };
  }

  // Case-insensitive match
  const normalizedInput = normalizeAgencyName(agencyName);
  for (const [key, entry] of Object.entries(db.agencies)) {
    if (normalizeAgencyName(key) === normalizedInput) {
      return { agency: key, ...entry };
    }
  }

  // Partial match
  for (const [key, entry] of Object.entries(db.agencies)) {
    const normalizedKey = normalizeAgencyName(key);
    if (normalizedInput.includes(normalizedKey) || normalizedKey.includes(normalizedInput)) {
      return { agency: key, ...entry };
    }
  }

  return null;
}

/**
 * Get budget data for multiple agencies.
 */
export function getBudgetForSelectedAgencies(agencyNames: string[]): AgencyBudgetData[] {
  return agencyNames
    .map(name => getBudgetForAgency(name))
    .filter((d): d is AgencyBudgetData => d !== null);
}

/**
 * Get agencies sorted by budget change — winners first, losers last.
 */
export function getWinnersAndLosers(limit?: number): {
  winners: AgencyBudgetData[];
  losers: AgencyBudgetData[];
} {
  const db = loadCachedBudgetData();
  if (!db) return { winners: [], losers: [] };

  const allAgencies: AgencyBudgetData[] = Object.entries(db.agencies).map(
    ([name, entry]) => ({ agency: name, ...entry })
  );

  // Sort by percent change descending
  allAgencies.sort((a, b) => b.change.percent - a.change.percent);

  const winners = allAgencies
    .filter(a => a.change.percent > 1) // budget increased
    .slice(0, limit || 10);

  const losers = allAgencies
    .filter(a => a.change.percent < 1) // budget decreased
    .sort((a, b) => a.change.percent - b.change.percent) // worst first
    .slice(0, limit || 10);

  return { winners, losers };
}

/**
 * Build a BudgetCheckupReport from a list of AgencyBudgetData.
 * Used both by the live API build and by cached data lookups.
 */
export function buildCheckupFromData(budgetData: AgencyBudgetData[]): BudgetCheckupReport {
  const sorted = [...budgetData].sort((a, b) => b.change.percent - a.change.percent);

  const winners = sorted.filter(a => a.change.percent > 1);
  const losers = sorted.filter(a => a.change.percent < 1).reverse(); // worst first

  const totalFY2025 = budgetData.reduce((sum, a) => sum + a.fy2025.budgetAuthority, 0);
  const totalFY2026 = budgetData.reduce((sum, a) => sum + a.fy2026.budgetAuthority, 0);
  const overallChange = totalFY2025 > 0 ? totalFY2026 / totalFY2025 : 1;

  const biggestWinner = winners[0]?.agency || 'N/A';
  const biggestLoser = losers[0]?.agency || 'N/A';

  const recommendations: string[] = [];

  if (winners.length > 0) {
    const topWinner = winners[0];
    const pctUp = ((topWinner.change.percent - 1) * 100).toFixed(1);
    recommendations.push(
      `${topWinner.agency} budget ${topWinner.change.trend === 'surging' ? 'surged' : 'grew'} +${pctUp}% — prioritize outreach`
    );
  }

  if (losers.length > 0) {
    const topLoser = losers[0];
    const pctDown = ((1 - topLoser.change.percent) * 100).toFixed(1);
    recommendations.push(
      `${topLoser.agency} budget ${topLoser.change.trend === 'cut' ? 'cut' : 'declined'} -${pctDown}% — expect fewer new contracts, focus on recompetes`
    );
  }

  recommendations.push(
    'Agencies with growing budgets are more likely to release new solicitations',
    'Focus capability statements on agencies with "surging" or "growing" budgets',
    'For agencies with declining budgets, emphasize cost-savings and efficiency in proposals',
    'Monitor agencies with "stable" budgets — they still have active procurement cycles'
  );

  return {
    agencyBudgets: budgetData,
    winners: winners.slice(0, 10),
    losers: losers.slice(0, 10),
    summary: {
      totalFY2025,
      totalFY2026,
      overallChange,
      agenciesGrowing: winners.length,
      agenciesDeclining: losers.length,
      biggestWinner,
      biggestLoser,
    },
    recommendations,
  };
}

/**
 * Build a BudgetCheckupReport from cached data for specific agencies.
 * This is the main function used by the report generator.
 */
export function buildCachedBudgetCheckup(agencyNames: string[]): BudgetCheckupReport | null {
  const budgetData = getBudgetForSelectedAgencies(agencyNames);
  if (budgetData.length === 0) return null;

  return buildCheckupFromData(budgetData);
}

/**
 * Get all cached budget data as a flat array.
 */
export function getAllBudgetData(): AgencyBudgetData[] {
  const db = loadCachedBudgetData();
  if (!db) return [];

  return Object.entries(db.agencies).map(
    ([name, entry]) => ({ agency: name, ...entry })
  );
}
