// Agency List Builder
// Fetches toptier agencies and sub-agencies from USASpending API
// to build a comprehensive list of 250-400 agencies for pain point generation

export interface USASpendingAgency {
  agency_name: string;
  toptier_code: string;
  abbreviation: string;
  current_total_budget_authority_amount: number;
  congressional_justification_url: string | null;
  active_fy: string;
  active_fq: string;
}

export interface AgencyListEntry {
  name: string;
  toptierCode: string;
  abbreviation: string;
  budget: number;
  isSubAgency: boolean;
  parentAgency?: string;
}

const USASPENDING_BASE = 'https://api.usaspending.gov/api/v2';

/**
 * Fetch all toptier agencies from USASpending
 * Returns ~90-140 agencies with names, codes, budgets
 */
export async function fetchAllUSASpendingAgencies(): Promise<AgencyListEntry[]> {
  const response = await fetch(`${USASPENDING_BASE}/references/toptier_agencies/`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`USASpending toptier_agencies returned ${response.status}`);
  }

  const data = await response.json();
  const agencies: AgencyListEntry[] = [];

  if (data.results && Array.isArray(data.results)) {
    for (const agency of data.results) {
      // Skip agencies with no budget (inactive)
      const budget = agency.current_total_budget_authority_amount || 0;
      if (budget <= 0) continue;

      agencies.push({
        name: agency.agency_name,
        toptierCode: agency.toptier_code,
        abbreviation: agency.abbreviation || '',
        budget,
        isSubAgency: false,
      });
    }
  }

  // Sort by budget descending
  agencies.sort((a, b) => b.budget - a.budget);

  return agencies;
}

/**
 * Fetch sub-agencies for a given toptier agency
 * Uses the spending_by_category endpoint to discover sub-agencies
 */
export async function fetchSubAgencies(toptierCode: string, agencyName: string): Promise<AgencyListEntry[]> {
  try {
    const response = await fetch(`${USASPENDING_BASE}/search/spending_by_category/awarding_subagency`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters: {
          agencies: [{
            type: 'awarding',
            tier: 'toptier',
            name: agencyName,
          }],
          time_period: [{
            start_date: '2023-10-01',
            end_date: '2025-09-30',
          }],
        },
        category: 'awarding_subagency',
        limit: 50,
        page: 1,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.warn(`Sub-agency fetch failed for ${agencyName}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const subAgencies: AgencyListEntry[] = [];

    if (data.results && Array.isArray(data.results)) {
      for (const sub of data.results) {
        const name = sub.name || sub.awarding_subagency || '';
        if (!name || name === agencyName) continue; // Skip if same as parent

        subAgencies.push({
          name,
          toptierCode,
          abbreviation: '',
          budget: sub.amount || 0,
          isSubAgency: true,
          parentAgency: agencyName,
        });
      }
    }

    return subAgencies;
  } catch (error) {
    console.warn(`Error fetching sub-agencies for ${agencyName}:`, error);
    return [];
  }
}

/**
 * Build a comprehensive agency list combining toptier + sub-agencies
 *
 * @param includeSubAgencies - If true, fetch sub-agencies for large departments (slower)
 * @param minBudget - Minimum budget threshold to include an agency
 * @returns Combined, deduplicated list of agencies
 */
export async function buildComprehensiveAgencyList(
  includeSubAgencies: boolean = true,
  minBudget: number = 0
): Promise<AgencyListEntry[]> {
  console.log('[AgencyListBuilder] Fetching toptier agencies...');
  const toptierAgencies = await fetchAllUSASpendingAgencies();
  console.log(`[AgencyListBuilder] Found ${toptierAgencies.length} toptier agencies`);

  const allAgencies: AgencyListEntry[] = [...toptierAgencies];

  if (includeSubAgencies) {
    // Only fetch sub-agencies for large departments (budget > $1B)
    // These are the ones most likely to have distinct sub-agency contracting
    const largeDepartments = toptierAgencies.filter(a => a.budget > 1_000_000_000);
    console.log(`[AgencyListBuilder] Fetching sub-agencies for ${largeDepartments.length} large departments...`);

    // Process in batches of 5 to avoid rate limiting
    for (let i = 0; i < largeDepartments.length; i += 5) {
      const batch = largeDepartments.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(dept => fetchSubAgencies(dept.toptierCode, dept.name))
      );

      for (const subs of batchResults) {
        allAgencies.push(...subs);
      }

      // Rate limit between batches
      if (i + 5 < largeDepartments.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  // Deduplicate by normalized name
  const seen = new Map<string, AgencyListEntry>();
  for (const agency of allAgencies) {
    const key = normalizeAgencyName(agency.name);
    const existing = seen.get(key);
    if (!existing || agency.budget > existing.budget) {
      seen.set(key, agency);
    }
  }

  let deduplicated = Array.from(seen.values());

  // Apply minimum budget filter
  if (minBudget > 0) {
    deduplicated = deduplicated.filter(a => a.budget >= minBudget || !a.isSubAgency);
  }

  // Sort by budget descending
  deduplicated.sort((a, b) => b.budget - a.budget);

  console.log(`[AgencyListBuilder] Final agency list: ${deduplicated.length} agencies`);
  return deduplicated;
}

/**
 * Normalize agency name for deduplication
 */
function normalizeAgencyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .trim();
}

// Well-known sub-agencies/components that should get their own pain points
// even if USASpending doesn't return them separately
export const KNOWN_SUB_AGENCIES: Array<{ name: string; parentAgency: string; abbreviation: string }> = [
  // DoD Components
  { name: 'Department of the Navy', parentAgency: 'Department of Defense', abbreviation: 'DON' },
  { name: 'Department of the Army', parentAgency: 'Department of Defense', abbreviation: 'USA' },
  { name: 'Department of the Air Force', parentAgency: 'Department of Defense', abbreviation: 'USAF' },
  { name: 'Defense Logistics Agency', parentAgency: 'Department of Defense', abbreviation: 'DLA' },
  { name: 'Defense Information Systems Agency', parentAgency: 'Department of Defense', abbreviation: 'DISA' },
  { name: 'Defense Health Agency', parentAgency: 'Department of Defense', abbreviation: 'DHA' },
  { name: 'Defense Contract Management Agency', parentAgency: 'Department of Defense', abbreviation: 'DCMA' },
  { name: 'Missile Defense Agency', parentAgency: 'Department of Defense', abbreviation: 'MDA' },
  { name: 'National Guard Bureau', parentAgency: 'Department of Defense', abbreviation: 'NGB' },
  { name: 'DARPA', parentAgency: 'Department of Defense', abbreviation: 'DARPA' },
  // Navy Commands
  { name: 'NAVFAC', parentAgency: 'Department of the Navy', abbreviation: 'NAVFAC' },
  { name: 'NAVSEA', parentAgency: 'Department of the Navy', abbreviation: 'NAVSEA' },
  { name: 'NAVAIR', parentAgency: 'Department of the Navy', abbreviation: 'NAVAIR' },
  { name: 'NAVWAR', parentAgency: 'Department of the Navy', abbreviation: 'NAVWAR' },
  { name: 'Marine Corps Systems Command', parentAgency: 'Department of the Navy', abbreviation: 'MARCORSYSCOM' },
  // Army Commands
  { name: 'USACE', parentAgency: 'Department of the Army', abbreviation: 'USACE' },
  { name: 'Army Contracting Command', parentAgency: 'Department of the Army', abbreviation: 'ACC' },
  { name: 'Army Materiel Command', parentAgency: 'Department of the Army', abbreviation: 'AMC' },
  // Air Force Commands
  { name: 'Air Force Materiel Command', parentAgency: 'Department of the Air Force', abbreviation: 'AFMC' },
  { name: 'Space Systems Command', parentAgency: 'Department of the Air Force', abbreviation: 'SSC' },
  // DHS Components
  { name: 'Customs and Border Protection', parentAgency: 'Department of Homeland Security', abbreviation: 'CBP' },
  { name: 'Immigration and Customs Enforcement', parentAgency: 'Department of Homeland Security', abbreviation: 'ICE' },
  { name: 'Transportation Security Administration', parentAgency: 'Department of Homeland Security', abbreviation: 'TSA' },
  { name: 'Federal Emergency Management Agency', parentAgency: 'Department of Homeland Security', abbreviation: 'FEMA' },
  { name: 'U.S. Coast Guard', parentAgency: 'Department of Homeland Security', abbreviation: 'USCG' },
  { name: 'Cybersecurity and Infrastructure Security Agency', parentAgency: 'Department of Homeland Security', abbreviation: 'CISA' },
  { name: 'U.S. Secret Service', parentAgency: 'Department of Homeland Security', abbreviation: 'USSS' },
  // HHS Components
  { name: 'Centers for Disease Control and Prevention', parentAgency: 'Department of Health and Human Services', abbreviation: 'CDC' },
  { name: 'National Institutes of Health', parentAgency: 'Department of Health and Human Services', abbreviation: 'NIH' },
  { name: 'Food and Drug Administration', parentAgency: 'Department of Health and Human Services', abbreviation: 'FDA' },
  { name: 'Centers for Medicare & Medicaid Services', parentAgency: 'Department of Health and Human Services', abbreviation: 'CMS' },
  { name: 'Indian Health Service', parentAgency: 'Department of Health and Human Services', abbreviation: 'IHS' },
  // DOJ Components
  { name: 'Federal Bureau of Investigation', parentAgency: 'Department of Justice', abbreviation: 'FBI' },
  { name: 'Drug Enforcement Administration', parentAgency: 'Department of Justice', abbreviation: 'DEA' },
  { name: 'Bureau of Prisons', parentAgency: 'Department of Justice', abbreviation: 'BOP' },
  { name: 'U.S. Marshals Service', parentAgency: 'Department of Justice', abbreviation: 'USMS' },
  { name: 'Bureau of Alcohol, Tobacco, Firearms and Explosives', parentAgency: 'Department of Justice', abbreviation: 'ATF' },
  // Treasury Components
  { name: 'Internal Revenue Service', parentAgency: 'Department of the Treasury', abbreviation: 'IRS' },
  // Interior Components
  { name: 'Bureau of Land Management', parentAgency: 'Department of the Interior', abbreviation: 'BLM' },
  { name: 'National Park Service', parentAgency: 'Department of the Interior', abbreviation: 'NPS' },
  { name: 'U.S. Fish and Wildlife Service', parentAgency: 'Department of the Interior', abbreviation: 'FWS' },
  { name: 'Bureau of Reclamation', parentAgency: 'Department of the Interior', abbreviation: 'USBR' },
  { name: 'Bureau of Indian Affairs', parentAgency: 'Department of the Interior', abbreviation: 'BIA' },
  { name: 'U.S. Geological Survey', parentAgency: 'Department of the Interior', abbreviation: 'USGS' },
  // Commerce Components
  { name: 'National Oceanic and Atmospheric Administration', parentAgency: 'Department of Commerce', abbreviation: 'NOAA' },
  { name: 'Census Bureau', parentAgency: 'Department of Commerce', abbreviation: 'USCB' },
  { name: 'National Institute of Standards and Technology', parentAgency: 'Department of Commerce', abbreviation: 'NIST' },
  { name: 'Patent and Trademark Office', parentAgency: 'Department of Commerce', abbreviation: 'USPTO' },
  // Transportation Components
  { name: 'Federal Aviation Administration', parentAgency: 'Department of Transportation', abbreviation: 'FAA' },
  { name: 'Federal Highway Administration', parentAgency: 'Department of Transportation', abbreviation: 'FHWA' },
  { name: 'Federal Transit Administration', parentAgency: 'Department of Transportation', abbreviation: 'FTA' },
  { name: 'National Highway Traffic Safety Administration', parentAgency: 'Department of Transportation', abbreviation: 'NHTSA' },
  // Agriculture Components
  { name: 'U.S. Forest Service', parentAgency: 'Department of Agriculture', abbreviation: 'USFS' },
  { name: 'Agricultural Research Service', parentAgency: 'Department of Agriculture', abbreviation: 'ARS' },
  { name: 'Natural Resources Conservation Service', parentAgency: 'Department of Agriculture', abbreviation: 'NRCS' },
  { name: 'Food Safety and Inspection Service', parentAgency: 'Department of Agriculture', abbreviation: 'FSIS' },
  // DOE Components
  { name: 'National Nuclear Security Administration', parentAgency: 'Department of Energy', abbreviation: 'NNSA' },
  // Independent Agencies
  { name: 'National Science Foundation', parentAgency: '', abbreviation: 'NSF' },
  { name: 'Agency for International Development', parentAgency: '', abbreviation: 'USAID' },
  { name: 'Corps of Engineers - Civil Works', parentAgency: 'Department of the Army', abbreviation: 'USACE-CW' },
];
