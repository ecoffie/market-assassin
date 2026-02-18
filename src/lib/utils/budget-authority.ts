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
  source?: string;
  sourceUrl?: string;
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

// ──────────────────────────────────────────────
// Sub-Agency → Parent Toptier Mapping
// Maps all 250 pain-point agencies to their parent toptier agency
// so sub-agencies inherit the parent's budget trend data.
// ──────────────────────────────────────────────

const SUB_AGENCY_PARENT_MAP: Record<string, string> = {
  // ── Department of Agriculture ──
  'Agricultural Marketing Service (AMS)': 'Department of Agriculture',
  'Agricultural Research Service': 'Department of Agriculture',
  'Animal and Plant Health Inspection Service (APHIS)': 'Department of Agriculture',
  'Farm Service Agency (FSA)': 'Department of Agriculture',
  'Food Safety and Inspection Service': 'Department of Agriculture',
  'Natural Resources Conservation Service': 'Department of Agriculture',
  'U.S. Forest Service': 'Department of Agriculture',
  'USDA Rural Development': 'Department of Agriculture',

  // ── Department of Commerce ──
  'Bureau of Economic Analysis (BEA)': 'Department of Commerce',
  'Bureau of Industry and Security (BIS)': 'Department of Commerce',
  'Census Bureau': 'Department of Commerce',
  'Economic Development Administration (EDA)': 'Department of Commerce',
  'International Trade Administration (ITA)': 'Department of Commerce',
  'Minority Business Development Agency (MBDA)': 'Department of Commerce',
  'National Institute of Standards and Technology': 'Department of Commerce',
  'NIST': 'Department of Commerce',
  'National Oceanic and Atmospheric Administration': 'Department of Commerce',
  'NOAA': 'Department of Commerce',
  'National Telecommunications and Information Administration (NTIA)': 'Department of Commerce',
  'National Weather Service (NWS)': 'Department of Commerce',
  'Patent and Trademark Office': 'Department of Commerce',

  // ── Department of Defense ──
  'Air Force Materiel Command': 'Department of Defense',
  'Air Force Sustainment Center': 'Department of Defense',
  'Army Contracting Command': 'Department of Defense',
  'Army Futures Command': 'Department of Defense',
  'Army Materiel Command': 'Department of Defense',
  'DARPA': 'Department of Defense',
  'Defense Commissary Agency (DeCA)': 'Department of Defense',
  'Defense Contract Audit Agency': 'Department of Defense',
  'Defense Contract Management Agency': 'Department of Defense',
  'Defense Counterintelligence and Security Agency (DCSA)': 'Department of Defense',
  'Defense Finance and Accounting Service (DFAS)': 'Department of Defense',
  'Defense Health Agency': 'Department of Defense',
  'Defense Information Systems Agency': 'Department of Defense',
  'Defense Intelligence Agency (DIA)': 'Department of Defense',
  'Defense Logistics Agency': 'Department of Defense',
  'Defense Threat Reduction Agency (DTRA)': 'Department of Defense',
  'Department of the Air Force': 'Department of Defense',
  'Department of the Army': 'Department of Defense',
  'Department of the Navy': 'Department of Defense',
  'Marine Corps Systems Command': 'Department of Defense',
  'Missile Defense Agency': 'Department of Defense',
  'National Guard Bureau': 'Department of Defense',
  'National Geospatial-Intelligence Agency (NGA)': 'Department of Defense',
  'National Reconnaissance Office (NRO)': 'Department of Defense',
  'NAVAIR': 'Department of Defense',
  'NAVFAC': 'Department of Defense',
  'NAVSEA': 'Department of Defense',
  'NAVWAR': 'Department of Defense',
  'Space Systems Command': 'Department of Defense',
  'USACE': 'Department of Defense',
  'U.S. Army Corps of Engineers Civil Works': 'Department of Defense',
  'U.S. Africa Command (AFRICOM)': 'Department of Defense',
  'U.S. Central Command (CENTCOM)': 'Department of Defense',
  'U.S. Cyber Command (CYBERCOM)': 'Department of Defense',
  'U.S. European Command (EUCOM)': 'Department of Defense',
  'U.S. Indo-Pacific Command (INDOPACOM)': 'Department of Defense',
  'U.S. Northern Command (NORTHCOM)': 'Department of Defense',
  'U.S. Southern Command (SOUTHCOM)': 'Department of Defense',
  'U.S. Space Command (SPACECOM)': 'Department of Defense',
  'U.S. Special Operations Command (SOCOM)': 'Department of Defense',
  'U.S. Strategic Command (STRATCOM)': 'Department of Defense',
  'U.S. Transportation Command (TRANSCOM)': 'Department of Defense',

  // ── Department of Education ──
  'Federal Student Aid (FSA)': 'Department of Education',
  'Office of Elementary and Secondary Education (OESE)': 'Department of Education',
  'Office of Postsecondary Education (OPE)': 'Department of Education',
  'Office of Special Education and Rehabilitative Services (OSERS)': 'Department of Education',

  // ── Department of Energy ──
  'ARPA-E (Advanced Research Projects Agency-Energy)': 'Department of Energy',
  'Bonneville Power Administration (BPA)': 'Department of Energy',
  'DOE Fossil Energy': 'Department of Energy',
  'DOE Nuclear Energy': 'Department of Energy',
  'DOE Office of Environmental Management': 'Department of Energy',
  'DOE Office of Science': 'Department of Energy',
  'Federal Energy Regulatory Commission (FERC)': 'Department of Energy',
  'NNSA': 'Department of Energy',
  'National Nuclear Security Administration': 'Department of Energy',
  'Office of Energy Efficiency and Renewable Energy (EERE)': 'Department of Energy',
  'Southeastern Power Administration (SEPA)': 'Department of Energy',
  'Southwestern Power Administration (SWPA)': 'Department of Energy',
  'Western Area Power Administration (WAPA)': 'Department of Energy',

  // ── Department of Health and Human Services ──
  'Administration for Children and Families (ACF)': 'Department of Health and Human Services',
  'Administration for Community Living (ACL)': 'Department of Health and Human Services',
  'Administration for Strategic Preparedness and Response (ASPR)': 'Department of Health and Human Services',
  'Agency for Healthcare Research and Quality (AHRQ)': 'Department of Health and Human Services',
  'CDC': 'Department of Health and Human Services',
  'Centers for Disease Control and Prevention': 'Department of Health and Human Services',
  'CMS': 'Department of Health and Human Services',
  'Centers for Medicare & Medicaid Services': 'Department of Health and Human Services',
  'FDA': 'Department of Health and Human Services',
  'Food and Drug Administration': 'Department of Health and Human Services',
  'Health Resources and Services Administration (HRSA)': 'Department of Health and Human Services',
  'Indian Health Service': 'Department of Health and Human Services',
  'NIH': 'Department of Health and Human Services',
  'National Institutes of Health': 'Department of Health and Human Services',
  'Office of the National Coordinator for Health IT (ONC)': 'Department of Health and Human Services',
  'Substance Abuse and Mental Health Services Administration (SAMHSA)': 'Department of Health and Human Services',

  // ── Department of Homeland Security ──
  'Countering Weapons of Mass Destruction Office (CWMD)': 'Department of Homeland Security',
  'Cybersecurity and Infrastructure Security Agency': 'Department of Homeland Security',
  'DHS Science and Technology Directorate (S&T)': 'Department of Homeland Security',
  'Federal Emergency Management Agency': 'Department of Homeland Security',
  'Federal Law Enforcement Training Centers (FLETC)': 'Department of Homeland Security',
  'Immigration and Customs Enforcement': 'Department of Homeland Security',
  'Transportation Security Administration': 'Department of Homeland Security',
  'U.S. Citizenship and Immigration Services (USCIS)': 'Department of Homeland Security',
  'U.S. Coast Guard': 'Department of Homeland Security',
  'U.S. Customs and Border Protection': 'Department of Homeland Security',
  'U.S. Secret Service': 'Department of Homeland Security',

  // ── Department of Housing and Urban Development ──
  'Federal Housing Administration (FHA)': 'Department of Housing and Urban Development',
  'Government National Mortgage Association (Ginnie Mae)': 'Department of Housing and Urban Development',
  'Office of Community Planning and Development (CPD)': 'Department of Housing and Urban Development',
  'Office of Public and Indian Housing (PIH)': 'Department of Housing and Urban Development',

  // ── Department of the Interior ──
  'Bureau of Indian Affairs': 'Department of the Interior',
  'Bureau of Land Management': 'Department of the Interior',
  'Bureau of Ocean Energy Management (BOEM)': 'Department of the Interior',
  'Bureau of Reclamation': 'Department of the Interior',
  'Bureau of Safety and Environmental Enforcement (BSEE)': 'Department of the Interior',
  'National Park Service': 'Department of the Interior',
  'Office of Surface Mining Reclamation and Enforcement (OSMRE)': 'Department of the Interior',
  'U.S. Fish and Wildlife Service': 'Department of the Interior',
  'U.S. Geological Survey': 'Department of the Interior',

  // ── Department of Justice ──
  'Bureau of Alcohol, Tobacco, Firearms and Explosives': 'Department of Justice',
  'Bureau of Prisons': 'Department of Justice',
  'Community Oriented Policing Services (COPS Office)': 'Department of Justice',
  'Drug Enforcement Administration': 'Department of Justice',
  'Executive Office for Immigration Review (EOIR)': 'Department of Justice',
  'Federal Bureau of Investigation': 'Department of Justice',
  'Federal Prison Industries (UNICOR)': 'Department of Justice',
  'National Institute of Corrections (NIC)': 'Department of Justice',
  'Office of Justice Programs (OJP)': 'Department of Justice',
  'Office on Violence Against Women (OVW)': 'Department of Justice',
  'U.S. Marshals Service': 'Department of Justice',

  // ── Department of Labor ──
  'Bureau of Labor Statistics (BLS)': 'Department of Labor',
  'Employment and Training Administration (ETA)': 'Department of Labor',
  'Mine Safety and Health Administration (MSHA)': 'Department of Labor',
  'Occupational Safety and Health Administration (OSHA)': 'Department of Labor',
  'Wage and Hour Division (WHD)': 'Department of Labor',

  // ── Department of State ──
  'Bureau of Consular Affairs': 'Department of State',
  'Bureau of Diplomatic Security (DS)': 'Department of State',

  // ── Department of Transportation ──
  'FAA': 'Department of Transportation',
  'Federal Aviation Administration': 'Department of Transportation',
  'Federal Highway Administration': 'Department of Transportation',
  'FHWA': 'Department of Transportation',
  'Federal Motor Carrier Safety Administration (FMCSA)': 'Department of Transportation',
  'Federal Railroad Administration (FRA)': 'Department of Transportation',
  'FRA': 'Department of Transportation',
  'Federal Transit Administration': 'Department of Transportation',
  'FTA': 'Department of Transportation',
  'Maritime Administration (MARAD)': 'Department of Transportation',
  'National Highway Traffic Safety Administration': 'Department of Transportation',
  'Pipeline and Hazardous Materials Safety Administration (PHMSA)': 'Department of Transportation',
  'Surface Transportation Board': 'Department of Transportation',

  // ── Department of the Treasury ──
  'Alcohol and Tobacco Tax and Trade Bureau (TTB)': 'Department of the Treasury',
  'Bureau of Engraving and Printing (BEP)': 'Department of the Treasury',
  'Bureau of the Fiscal Service': 'Department of the Treasury',
  'CDFI Fund': 'Department of the Treasury',
  'Financial Crimes Enforcement Network (FinCEN)': 'Department of the Treasury',
  'Internal Revenue Service': 'Department of the Treasury',
  'Office of the Comptroller of the Currency (OCC)': 'Department of the Treasury',
  'United States Mint': 'Department of the Treasury',

  // ── Department of Veterans Affairs ──
  'National Cemetery Administration (NCA)': 'Department of Veterans Affairs',
  'Veterans Benefits Administration (VBA)': 'Department of Veterans Affairs',
  'Veterans Health Administration (VHA)': 'Department of Veterans Affairs',

  // ── Environmental Protection Agency (sub-offices) ──
  'EPA Office of Air and Radiation': 'Environmental Protection Agency',
  'EPA Office of Land and Emergency Management': 'Environmental Protection Agency',
  'EPA Office of Water': 'Environmental Protection Agency',

  // ── General Services Administration (sub-offices) ──
  'Federal Acquisition Service': 'General Services Administration',
  'GSA Public Buildings Service (PBS)': 'General Services Administration',
  'GSA Technology Transformation Services (TTS)': 'General Services Administration',

  // ── NASA (abbreviation) ──
  'NASA': 'National Aeronautics and Space Administration',

  // ── Small Business Administration (sub-offices) ──
  'SBA Office of Capital Access': 'Small Business Administration',
  'SBA Office of Disaster Assistance': 'Small Business Administration',
  'SBA Office of Government Contracting': 'Small Business Administration',

  // ── Intelligence Community → DoD budget ──
  'Office of the Director of National Intelligence (ODNI)': 'Department of Defense',
};

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

  // Sub-agency → parent mapping fallback
  const parentName = SUB_AGENCY_PARENT_MAP[agencyName];
  if (parentName) {
    return getBudgetForAgency(parentName);
  }

  // Fuzzy sub-agency mapping (handles slight name variations)
  const normalizedForMap = normalizeAgencyName(agencyName);
  for (const [subAgency, parent] of Object.entries(SUB_AGENCY_PARENT_MAP)) {
    if (normalizeAgencyName(subAgency) === normalizedForMap) {
      return getBudgetForAgency(parent);
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
