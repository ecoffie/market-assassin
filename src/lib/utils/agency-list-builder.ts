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
// EXPANDED April 2026: 200+ agencies for comprehensive coverage
export const KNOWN_SUB_AGENCIES: Array<{ name: string; parentAgency: string; abbreviation: string }> = [
  // ============================================
  // DoD Components - Services & Major Commands
  // ============================================
  { name: 'Department of the Navy', parentAgency: 'Department of Defense', abbreviation: 'DON' },
  { name: 'Department of the Army', parentAgency: 'Department of Defense', abbreviation: 'USA' },
  { name: 'Department of the Air Force', parentAgency: 'Department of Defense', abbreviation: 'USAF' },
  { name: 'United States Space Force', parentAgency: 'Department of the Air Force', abbreviation: 'USSF' },
  { name: 'United States Marine Corps', parentAgency: 'Department of the Navy', abbreviation: 'USMC' },

  // DoD Defense Agencies
  { name: 'Defense Logistics Agency', parentAgency: 'Department of Defense', abbreviation: 'DLA' },
  { name: 'Defense Information Systems Agency', parentAgency: 'Department of Defense', abbreviation: 'DISA' },
  { name: 'Defense Health Agency', parentAgency: 'Department of Defense', abbreviation: 'DHA' },
  { name: 'Defense Contract Management Agency', parentAgency: 'Department of Defense', abbreviation: 'DCMA' },
  { name: 'Defense Contract Audit Agency', parentAgency: 'Department of Defense', abbreviation: 'DCAA' },
  { name: 'Missile Defense Agency', parentAgency: 'Department of Defense', abbreviation: 'MDA' },
  { name: 'National Guard Bureau', parentAgency: 'Department of Defense', abbreviation: 'NGB' },
  { name: 'Defense Advanced Research Projects Agency', parentAgency: 'Department of Defense', abbreviation: 'DARPA' },
  { name: 'Defense Threat Reduction Agency', parentAgency: 'Department of Defense', abbreviation: 'DTRA' },
  { name: 'Defense Intelligence Agency', parentAgency: 'Department of Defense', abbreviation: 'DIA' },
  { name: 'National Security Agency', parentAgency: 'Department of Defense', abbreviation: 'NSA' },
  { name: 'National Geospatial-Intelligence Agency', parentAgency: 'Department of Defense', abbreviation: 'NGA' },
  { name: 'National Reconnaissance Office', parentAgency: 'Department of Defense', abbreviation: 'NRO' },
  { name: 'Defense Finance and Accounting Service', parentAgency: 'Department of Defense', abbreviation: 'DFAS' },
  { name: 'Defense Commissary Agency', parentAgency: 'Department of Defense', abbreviation: 'DeCA' },
  { name: 'Defense Counterintelligence and Security Agency', parentAgency: 'Department of Defense', abbreviation: 'DCSA' },
  { name: 'Washington Headquarters Services', parentAgency: 'Department of Defense', abbreviation: 'WHS' },
  { name: 'Pentagon Force Protection Agency', parentAgency: 'Department of Defense', abbreviation: 'PFPA' },
  { name: 'DoD Education Activity', parentAgency: 'Department of Defense', abbreviation: 'DoDEA' },
  { name: 'Defense POW/MIA Accounting Agency', parentAgency: 'Department of Defense', abbreviation: 'DPAA' },
  { name: 'Defense Technical Information Center', parentAgency: 'Department of Defense', abbreviation: 'DTIC' },
  { name: 'Defense Human Resources Activity', parentAgency: 'Department of Defense', abbreviation: 'DHRA' },
  { name: 'Defense Microelectronics Activity', parentAgency: 'Department of Defense', abbreviation: 'DMEA' },
  { name: 'Office of the Under Secretary for Acquisition', parentAgency: 'Department of Defense', abbreviation: 'OUSD(A&S)' },
  { name: 'Joint Artificial Intelligence Center', parentAgency: 'Department of Defense', abbreviation: 'JAIC' },

  // DoD Combatant Commands
  { name: 'U.S. Special Operations Command', parentAgency: 'Department of Defense', abbreviation: 'SOCOM' },
  { name: 'U.S. Indo-Pacific Command', parentAgency: 'Department of Defense', abbreviation: 'INDOPACOM' },
  { name: 'U.S. European Command', parentAgency: 'Department of Defense', abbreviation: 'EUCOM' },
  { name: 'U.S. Central Command', parentAgency: 'Department of Defense', abbreviation: 'CENTCOM' },
  { name: 'U.S. Africa Command', parentAgency: 'Department of Defense', abbreviation: 'AFRICOM' },
  { name: 'U.S. Northern Command', parentAgency: 'Department of Defense', abbreviation: 'NORTHCOM' },
  { name: 'U.S. Southern Command', parentAgency: 'Department of Defense', abbreviation: 'SOUTHCOM' },
  { name: 'U.S. Transportation Command', parentAgency: 'Department of Defense', abbreviation: 'TRANSCOM' },
  { name: 'U.S. Strategic Command', parentAgency: 'Department of Defense', abbreviation: 'STRATCOM' },
  { name: 'U.S. Cyber Command', parentAgency: 'Department of Defense', abbreviation: 'CYBERCOM' },
  { name: 'U.S. Space Command', parentAgency: 'Department of Defense', abbreviation: 'SPACECOM' },

  // Navy Commands
  { name: 'Naval Facilities Engineering Systems Command', parentAgency: 'Department of the Navy', abbreviation: 'NAVFAC' },
  { name: 'Naval Sea Systems Command', parentAgency: 'Department of the Navy', abbreviation: 'NAVSEA' },
  { name: 'Naval Air Systems Command', parentAgency: 'Department of the Navy', abbreviation: 'NAVAIR' },
  { name: 'Naval Information Warfare Systems Command', parentAgency: 'Department of the Navy', abbreviation: 'NAVWAR' },
  { name: 'Naval Supply Systems Command', parentAgency: 'Department of the Navy', abbreviation: 'NAVSUP' },
  { name: 'Military Sealift Command', parentAgency: 'Department of the Navy', abbreviation: 'MSC' },
  { name: 'Office of Naval Research', parentAgency: 'Department of the Navy', abbreviation: 'ONR' },
  { name: 'Bureau of Medicine and Surgery', parentAgency: 'Department of the Navy', abbreviation: 'BUMED' },
  { name: 'Marine Corps Systems Command', parentAgency: 'Department of the Navy', abbreviation: 'MARCORSYSCOM' },
  { name: 'Fleet Cyber Command', parentAgency: 'Department of the Navy', abbreviation: 'FCC' },

  // Army Commands
  { name: 'U.S. Army Corps of Engineers', parentAgency: 'Department of the Army', abbreviation: 'USACE' },
  { name: 'Army Contracting Command', parentAgency: 'Department of the Army', abbreviation: 'ACC' },
  { name: 'Army Materiel Command', parentAgency: 'Department of the Army', abbreviation: 'AMC' },
  { name: 'Army Futures Command', parentAgency: 'Department of the Army', abbreviation: 'AFC' },
  { name: 'Army Medical Command', parentAgency: 'Department of the Army', abbreviation: 'MEDCOM' },
  { name: 'Army Communications-Electronics Command', parentAgency: 'Department of the Army', abbreviation: 'CECOM' },
  { name: 'Army Tank-automotive and Armaments Command', parentAgency: 'Department of the Army', abbreviation: 'TACOM' },
  { name: 'Army Aviation and Missile Command', parentAgency: 'Department of the Army', abbreviation: 'AMCOM' },
  { name: 'Army Installation Management Command', parentAgency: 'Department of the Army', abbreviation: 'IMCOM' },
  { name: 'Army Cyber Command', parentAgency: 'Department of the Army', abbreviation: 'ARCYBER' },

  // Air Force Commands
  { name: 'Air Force Materiel Command', parentAgency: 'Department of the Air Force', abbreviation: 'AFMC' },
  { name: 'Air Force Life Cycle Management Center', parentAgency: 'Department of the Air Force', abbreviation: 'AFLCMC' },
  { name: 'Air Force Sustainment Center', parentAgency: 'Department of the Air Force', abbreviation: 'AFSC' },
  { name: 'Air Force Research Laboratory', parentAgency: 'Department of the Air Force', abbreviation: 'AFRL' },
  { name: 'Air Force Nuclear Weapons Center', parentAgency: 'Department of the Air Force', abbreviation: 'AFNWC' },
  { name: 'Air Force Installation and Mission Support Center', parentAgency: 'Department of the Air Force', abbreviation: 'AFIMSC' },
  { name: 'Air Education and Training Command', parentAgency: 'Department of the Air Force', abbreviation: 'AETC' },
  { name: 'Space Systems Command', parentAgency: 'Department of the Air Force', abbreviation: 'SSC' },
  { name: 'Space Operations Command', parentAgency: 'Department of the Air Force', abbreviation: 'SpOC' },

  // ============================================
  // DHS Components
  // ============================================
  { name: 'U.S. Customs and Border Protection', parentAgency: 'Department of Homeland Security', abbreviation: 'CBP' },
  { name: 'U.S. Immigration and Customs Enforcement', parentAgency: 'Department of Homeland Security', abbreviation: 'ICE' },
  { name: 'Transportation Security Administration', parentAgency: 'Department of Homeland Security', abbreviation: 'TSA' },
  { name: 'Federal Emergency Management Agency', parentAgency: 'Department of Homeland Security', abbreviation: 'FEMA' },
  { name: 'U.S. Coast Guard', parentAgency: 'Department of Homeland Security', abbreviation: 'USCG' },
  { name: 'Cybersecurity and Infrastructure Security Agency', parentAgency: 'Department of Homeland Security', abbreviation: 'CISA' },
  { name: 'U.S. Secret Service', parentAgency: 'Department of Homeland Security', abbreviation: 'USSS' },
  { name: 'U.S. Citizenship and Immigration Services', parentAgency: 'Department of Homeland Security', abbreviation: 'USCIS' },
  { name: 'Federal Law Enforcement Training Centers', parentAgency: 'Department of Homeland Security', abbreviation: 'FLETC' },
  { name: 'DHS Science and Technology Directorate', parentAgency: 'Department of Homeland Security', abbreviation: 'S&T' },
  { name: 'Countering Weapons of Mass Destruction Office', parentAgency: 'Department of Homeland Security', abbreviation: 'CWMD' },
  { name: 'Office of Intelligence and Analysis', parentAgency: 'Department of Homeland Security', abbreviation: 'I&A' },

  // ============================================
  // HHS Components
  // ============================================
  { name: 'Centers for Disease Control and Prevention', parentAgency: 'Department of Health and Human Services', abbreviation: 'CDC' },
  { name: 'National Institutes of Health', parentAgency: 'Department of Health and Human Services', abbreviation: 'NIH' },
  { name: 'Food and Drug Administration', parentAgency: 'Department of Health and Human Services', abbreviation: 'FDA' },
  { name: 'Centers for Medicare & Medicaid Services', parentAgency: 'Department of Health and Human Services', abbreviation: 'CMS' },
  { name: 'Indian Health Service', parentAgency: 'Department of Health and Human Services', abbreviation: 'IHS' },
  { name: 'Health Resources and Services Administration', parentAgency: 'Department of Health and Human Services', abbreviation: 'HRSA' },
  { name: 'Substance Abuse and Mental Health Services Administration', parentAgency: 'Department of Health and Human Services', abbreviation: 'SAMHSA' },
  { name: 'Administration for Children and Families', parentAgency: 'Department of Health and Human Services', abbreviation: 'ACF' },
  { name: 'Administration for Community Living', parentAgency: 'Department of Health and Human Services', abbreviation: 'ACL' },
  { name: 'Agency for Healthcare Research and Quality', parentAgency: 'Department of Health and Human Services', abbreviation: 'AHRQ' },
  { name: 'Administration for Strategic Preparedness and Response', parentAgency: 'Department of Health and Human Services', abbreviation: 'ASPR' },
  { name: 'Office of the National Coordinator for Health IT', parentAgency: 'Department of Health and Human Services', abbreviation: 'ONC' },

  // NIH Institutes (for detailed coverage)
  { name: 'National Cancer Institute', parentAgency: 'National Institutes of Health', abbreviation: 'NCI' },
  { name: 'National Heart, Lung, and Blood Institute', parentAgency: 'National Institutes of Health', abbreviation: 'NHLBI' },
  { name: 'National Institute of Allergy and Infectious Diseases', parentAgency: 'National Institutes of Health', abbreviation: 'NIAID' },
  { name: 'National Institute of Mental Health', parentAgency: 'National Institutes of Health', abbreviation: 'NIMH' },
  { name: 'National Institute of Diabetes and Digestive and Kidney Diseases', parentAgency: 'National Institutes of Health', abbreviation: 'NIDDK' },
  { name: 'National Institute of Neurological Disorders and Stroke', parentAgency: 'National Institutes of Health', abbreviation: 'NINDS' },
  { name: 'National Institute on Aging', parentAgency: 'National Institutes of Health', abbreviation: 'NIA' },
  { name: 'National Eye Institute', parentAgency: 'National Institutes of Health', abbreviation: 'NEI' },
  { name: 'National Institute on Drug Abuse', parentAgency: 'National Institutes of Health', abbreviation: 'NIDA' },
  { name: 'National Institute of General Medical Sciences', parentAgency: 'National Institutes of Health', abbreviation: 'NIGMS' },
  { name: 'National Human Genome Research Institute', parentAgency: 'National Institutes of Health', abbreviation: 'NHGRI' },
  { name: 'National Institute of Biomedical Imaging and Bioengineering', parentAgency: 'National Institutes of Health', abbreviation: 'NIBIB' },
  { name: 'National Center for Advancing Translational Sciences', parentAgency: 'National Institutes of Health', abbreviation: 'NCATS' },
  { name: 'National Library of Medicine', parentAgency: 'National Institutes of Health', abbreviation: 'NLM' },
  { name: 'Fogarty International Center', parentAgency: 'National Institutes of Health', abbreviation: 'FIC' },

  // ============================================
  // DOJ Components
  // ============================================
  { name: 'Federal Bureau of Investigation', parentAgency: 'Department of Justice', abbreviation: 'FBI' },
  { name: 'Drug Enforcement Administration', parentAgency: 'Department of Justice', abbreviation: 'DEA' },
  { name: 'Bureau of Prisons', parentAgency: 'Department of Justice', abbreviation: 'BOP' },
  { name: 'U.S. Marshals Service', parentAgency: 'Department of Justice', abbreviation: 'USMS' },
  { name: 'Bureau of Alcohol, Tobacco, Firearms and Explosives', parentAgency: 'Department of Justice', abbreviation: 'ATF' },
  { name: 'Office of Justice Programs', parentAgency: 'Department of Justice', abbreviation: 'OJP' },
  { name: 'Executive Office for Immigration Review', parentAgency: 'Department of Justice', abbreviation: 'EOIR' },
  { name: 'Community Oriented Policing Services', parentAgency: 'Department of Justice', abbreviation: 'COPS' },
  { name: 'Office of Legal Counsel', parentAgency: 'Department of Justice', abbreviation: 'OLC' },
  { name: 'National Institute of Justice', parentAgency: 'Department of Justice', abbreviation: 'NIJ' },

  // ============================================
  // Treasury Components
  // ============================================
  { name: 'Internal Revenue Service', parentAgency: 'Department of the Treasury', abbreviation: 'IRS' },
  { name: 'Bureau of the Fiscal Service', parentAgency: 'Department of the Treasury', abbreviation: 'BFS' },
  { name: 'Office of the Comptroller of the Currency', parentAgency: 'Department of the Treasury', abbreviation: 'OCC' },
  { name: 'Financial Crimes Enforcement Network', parentAgency: 'Department of the Treasury', abbreviation: 'FinCEN' },
  { name: 'Alcohol and Tobacco Tax and Trade Bureau', parentAgency: 'Department of the Treasury', abbreviation: 'TTB' },
  { name: 'Bureau of Engraving and Printing', parentAgency: 'Department of the Treasury', abbreviation: 'BEP' },
  { name: 'United States Mint', parentAgency: 'Department of the Treasury', abbreviation: 'USM' },
  { name: 'Office of Foreign Assets Control', parentAgency: 'Department of the Treasury', abbreviation: 'OFAC' },

  // ============================================
  // Interior Components
  // ============================================
  { name: 'Bureau of Land Management', parentAgency: 'Department of the Interior', abbreviation: 'BLM' },
  { name: 'National Park Service', parentAgency: 'Department of the Interior', abbreviation: 'NPS' },
  { name: 'U.S. Fish and Wildlife Service', parentAgency: 'Department of the Interior', abbreviation: 'FWS' },
  { name: 'Bureau of Reclamation', parentAgency: 'Department of the Interior', abbreviation: 'USBR' },
  { name: 'Bureau of Indian Affairs', parentAgency: 'Department of the Interior', abbreviation: 'BIA' },
  { name: 'U.S. Geological Survey', parentAgency: 'Department of the Interior', abbreviation: 'USGS' },
  { name: 'Bureau of Ocean Energy Management', parentAgency: 'Department of the Interior', abbreviation: 'BOEM' },
  { name: 'Bureau of Safety and Environmental Enforcement', parentAgency: 'Department of the Interior', abbreviation: 'BSEE' },
  { name: 'Office of Surface Mining Reclamation and Enforcement', parentAgency: 'Department of the Interior', abbreviation: 'OSMRE' },

  // ============================================
  // Commerce Components
  // ============================================
  { name: 'National Oceanic and Atmospheric Administration', parentAgency: 'Department of Commerce', abbreviation: 'NOAA' },
  { name: 'Census Bureau', parentAgency: 'Department of Commerce', abbreviation: 'USCB' },
  { name: 'National Institute of Standards and Technology', parentAgency: 'Department of Commerce', abbreviation: 'NIST' },
  { name: 'U.S. Patent and Trademark Office', parentAgency: 'Department of Commerce', abbreviation: 'USPTO' },
  { name: 'International Trade Administration', parentAgency: 'Department of Commerce', abbreviation: 'ITA' },
  { name: 'Bureau of Industry and Security', parentAgency: 'Department of Commerce', abbreviation: 'BIS' },
  { name: 'Economic Development Administration', parentAgency: 'Department of Commerce', abbreviation: 'EDA' },
  { name: 'Bureau of Economic Analysis', parentAgency: 'Department of Commerce', abbreviation: 'BEA' },
  { name: 'National Technical Information Service', parentAgency: 'Department of Commerce', abbreviation: 'NTIS' },

  // ============================================
  // Transportation Components
  // ============================================
  { name: 'Federal Aviation Administration', parentAgency: 'Department of Transportation', abbreviation: 'FAA' },
  { name: 'Federal Highway Administration', parentAgency: 'Department of Transportation', abbreviation: 'FHWA' },
  { name: 'Federal Transit Administration', parentAgency: 'Department of Transportation', abbreviation: 'FTA' },
  { name: 'National Highway Traffic Safety Administration', parentAgency: 'Department of Transportation', abbreviation: 'NHTSA' },
  { name: 'Federal Railroad Administration', parentAgency: 'Department of Transportation', abbreviation: 'FRA' },
  { name: 'Maritime Administration', parentAgency: 'Department of Transportation', abbreviation: 'MARAD' },
  { name: 'Pipeline and Hazardous Materials Safety Administration', parentAgency: 'Department of Transportation', abbreviation: 'PHMSA' },
  { name: 'Federal Motor Carrier Safety Administration', parentAgency: 'Department of Transportation', abbreviation: 'FMCSA' },
  { name: 'Office of the Secretary of Transportation', parentAgency: 'Department of Transportation', abbreviation: 'OST' },

  // ============================================
  // Agriculture Components
  // ============================================
  { name: 'U.S. Forest Service', parentAgency: 'Department of Agriculture', abbreviation: 'USFS' },
  { name: 'Agricultural Research Service', parentAgency: 'Department of Agriculture', abbreviation: 'ARS' },
  { name: 'Natural Resources Conservation Service', parentAgency: 'Department of Agriculture', abbreviation: 'NRCS' },
  { name: 'Food Safety and Inspection Service', parentAgency: 'Department of Agriculture', abbreviation: 'FSIS' },
  { name: 'Animal and Plant Health Inspection Service', parentAgency: 'Department of Agriculture', abbreviation: 'APHIS' },
  { name: 'Farm Service Agency', parentAgency: 'Department of Agriculture', abbreviation: 'FSA' },
  { name: 'Rural Development', parentAgency: 'Department of Agriculture', abbreviation: 'RD' },
  { name: 'Food and Nutrition Service', parentAgency: 'Department of Agriculture', abbreviation: 'FNS' },
  { name: 'Agricultural Marketing Service', parentAgency: 'Department of Agriculture', abbreviation: 'AMS' },
  { name: 'Risk Management Agency', parentAgency: 'Department of Agriculture', abbreviation: 'RMA' },

  // ============================================
  // DOE Components & National Labs
  // ============================================
  { name: 'National Nuclear Security Administration', parentAgency: 'Department of Energy', abbreviation: 'NNSA' },
  { name: 'Office of Energy Efficiency and Renewable Energy', parentAgency: 'Department of Energy', abbreviation: 'EERE' },
  { name: 'Office of Science', parentAgency: 'Department of Energy', abbreviation: 'DOE SC' },
  { name: 'Office of Fossil Energy and Carbon Management', parentAgency: 'Department of Energy', abbreviation: 'FECM' },
  { name: 'Office of Nuclear Energy', parentAgency: 'Department of Energy', abbreviation: 'NE' },
  { name: 'Office of Environmental Management', parentAgency: 'Department of Energy', abbreviation: 'EM' },
  { name: 'Office of Electricity', parentAgency: 'Department of Energy', abbreviation: 'OE' },
  { name: 'Bonneville Power Administration', parentAgency: 'Department of Energy', abbreviation: 'BPA' },
  { name: 'Western Area Power Administration', parentAgency: 'Department of Energy', abbreviation: 'WAPA' },
  // National Labs
  { name: 'Los Alamos National Laboratory', parentAgency: 'Department of Energy', abbreviation: 'LANL' },
  { name: 'Sandia National Laboratories', parentAgency: 'Department of Energy', abbreviation: 'SNL' },
  { name: 'Lawrence Livermore National Laboratory', parentAgency: 'Department of Energy', abbreviation: 'LLNL' },
  { name: 'Oak Ridge National Laboratory', parentAgency: 'Department of Energy', abbreviation: 'ORNL' },
  { name: 'Argonne National Laboratory', parentAgency: 'Department of Energy', abbreviation: 'ANL' },
  { name: 'Pacific Northwest National Laboratory', parentAgency: 'Department of Energy', abbreviation: 'PNNL' },
  { name: 'Idaho National Laboratory', parentAgency: 'Department of Energy', abbreviation: 'INL' },
  { name: 'Brookhaven National Laboratory', parentAgency: 'Department of Energy', abbreviation: 'BNL' },
  { name: 'Lawrence Berkeley National Laboratory', parentAgency: 'Department of Energy', abbreviation: 'LBNL' },
  { name: 'Fermi National Accelerator Laboratory', parentAgency: 'Department of Energy', abbreviation: 'Fermilab' },
  { name: 'National Renewable Energy Laboratory', parentAgency: 'Department of Energy', abbreviation: 'NREL' },
  { name: 'SLAC National Accelerator Laboratory', parentAgency: 'Department of Energy', abbreviation: 'SLAC' },
  { name: 'Savannah River National Laboratory', parentAgency: 'Department of Energy', abbreviation: 'SRNL' },

  // ============================================
  // VA Components
  // ============================================
  { name: 'Veterans Health Administration', parentAgency: 'Department of Veterans Affairs', abbreviation: 'VHA' },
  { name: 'Veterans Benefits Administration', parentAgency: 'Department of Veterans Affairs', abbreviation: 'VBA' },
  { name: 'National Cemetery Administration', parentAgency: 'Department of Veterans Affairs', abbreviation: 'NCA' },
  { name: 'Office of Information and Technology', parentAgency: 'Department of Veterans Affairs', abbreviation: 'OIT' },

  // ============================================
  // State Department Components
  // ============================================
  { name: 'Bureau of Diplomatic Security', parentAgency: 'Department of State', abbreviation: 'DS' },
  { name: 'Bureau of Consular Affairs', parentAgency: 'Department of State', abbreviation: 'CA' },
  { name: 'Bureau of Administration', parentAgency: 'Department of State', abbreviation: 'A' },
  { name: 'Bureau of Overseas Buildings Operations', parentAgency: 'Department of State', abbreviation: 'OBO' },
  { name: 'Bureau of International Narcotics and Law Enforcement Affairs', parentAgency: 'Department of State', abbreviation: 'INL' },
  { name: 'Bureau of Information Resource Management', parentAgency: 'Department of State', abbreviation: 'IRM' },

  // ============================================
  // Labor Components
  // ============================================
  { name: 'Occupational Safety and Health Administration', parentAgency: 'Department of Labor', abbreviation: 'OSHA' },
  { name: 'Bureau of Labor Statistics', parentAgency: 'Department of Labor', abbreviation: 'BLS' },
  { name: 'Mine Safety and Health Administration', parentAgency: 'Department of Labor', abbreviation: 'MSHA' },
  { name: 'Employment and Training Administration', parentAgency: 'Department of Labor', abbreviation: 'ETA' },
  { name: 'Office of Federal Contract Compliance Programs', parentAgency: 'Department of Labor', abbreviation: 'OFCCP' },

  // ============================================
  // Independent Agencies
  // ============================================
  { name: 'National Science Foundation', parentAgency: '', abbreviation: 'NSF' },
  { name: 'Agency for International Development', parentAgency: '', abbreviation: 'USAID' },
  { name: 'Environmental Protection Agency', parentAgency: '', abbreviation: 'EPA' },
  { name: 'General Services Administration', parentAgency: '', abbreviation: 'GSA' },
  { name: 'Small Business Administration', parentAgency: '', abbreviation: 'SBA' },
  { name: 'National Aeronautics and Space Administration', parentAgency: '', abbreviation: 'NASA' },
  { name: 'Social Security Administration', parentAgency: '', abbreviation: 'SSA' },
  { name: 'Office of Personnel Management', parentAgency: '', abbreviation: 'OPM' },
  { name: 'Nuclear Regulatory Commission', parentAgency: '', abbreviation: 'NRC' },
  { name: 'Securities and Exchange Commission', parentAgency: '', abbreviation: 'SEC' },
  { name: 'Federal Communications Commission', parentAgency: '', abbreviation: 'FCC' },
  { name: 'Federal Trade Commission', parentAgency: '', abbreviation: 'FTC' },
  { name: 'Consumer Financial Protection Bureau', parentAgency: '', abbreviation: 'CFPB' },
  { name: 'Equal Employment Opportunity Commission', parentAgency: '', abbreviation: 'EEOC' },
  { name: 'National Labor Relations Board', parentAgency: '', abbreviation: 'NLRB' },
  { name: 'Federal Deposit Insurance Corporation', parentAgency: '', abbreviation: 'FDIC' },
  { name: 'National Credit Union Administration', parentAgency: '', abbreviation: 'NCUA' },
  { name: 'Pension Benefit Guaranty Corporation', parentAgency: '', abbreviation: 'PBGC' },
  { name: 'Export-Import Bank of the United States', parentAgency: '', abbreviation: 'EXIM' },
  { name: 'Corps of Engineers - Civil Works', parentAgency: 'Department of the Army', abbreviation: 'USACE-CW' },

  // NASA Centers
  { name: 'Jet Propulsion Laboratory', parentAgency: 'National Aeronautics and Space Administration', abbreviation: 'JPL' },
  { name: 'Goddard Space Flight Center', parentAgency: 'National Aeronautics and Space Administration', abbreviation: 'GSFC' },
  { name: 'Johnson Space Center', parentAgency: 'National Aeronautics and Space Administration', abbreviation: 'JSC' },
  { name: 'Kennedy Space Center', parentAgency: 'National Aeronautics and Space Administration', abbreviation: 'KSC' },
  { name: 'Marshall Space Flight Center', parentAgency: 'National Aeronautics and Space Administration', abbreviation: 'MSFC' },
  { name: 'Langley Research Center', parentAgency: 'National Aeronautics and Space Administration', abbreviation: 'LaRC' },
  { name: 'Ames Research Center', parentAgency: 'National Aeronautics and Space Administration', abbreviation: 'ARC' },
  { name: 'Glenn Research Center', parentAgency: 'National Aeronautics and Space Administration', abbreviation: 'GRC' },

  // GSA Components
  { name: 'Public Buildings Service', parentAgency: 'General Services Administration', abbreviation: 'PBS' },
  { name: 'Federal Acquisition Service', parentAgency: 'General Services Administration', abbreviation: 'FAS' },
  { name: 'Technology Transformation Services', parentAgency: 'General Services Administration', abbreviation: 'TTS' },
];
