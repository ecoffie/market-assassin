/**
 * Contractor Database Pipeline
 *
 * Monitors contractor database for changes relevant to user's watchlist.
 * Returns SBLO changes, certification changes, subcontracting plans, new entrants.
 */

import { createClient } from '@supabase/supabase-js';

interface ContractorRecord {
  id: string;
  companyName: string;
  uei: string | null;
  cage: string | null;

  // SBLO contact
  sbloName: string | null;
  sbloTitle: string | null;
  sbloEmail: string | null;
  sbloPhone: string | null;

  // Certifications
  certifications: string[];
  is8a: boolean;
  isWosb: boolean;
  isSdvosb: boolean;
  isHubzone: boolean;
  isSmallBusiness: boolean;

  // Business info
  naicsCodes: string[];
  primaryNaics: string;
  employeeCount: number | null;
  annualRevenue: number | null;

  // Subcontracting
  hasSubcontractingPlan: boolean;
  subcontractingGoals: Record<string, number> | null;

  // Contact
  website: string | null;
  vendorPortalUrl: string | null;

  // Tracking
  lastUpdated: string;
  createdAt: string;
}

interface ContractorChangeEvent {
  contractorId: string;
  companyName: string;
  changeType:
    | 'sblo_contact_changed'
    | 'certification_gained'
    | 'certification_lost'
    | 'subk_plan_posted'
    | 'new_entrant'
    | 'naics_added'
    | 'info_updated';
  changeDetails: string;
  previousValue: string | null;
  newValue: string | null;
  timestamp: string;
}

interface ContractorSearchParams {
  naicsCodes?: string[];
  companyNames?: string[];
  certifications?: string[];
  limit?: number;
}

interface ContractorSearchResult {
  contractors: ContractorRecord[];
  totalCount: number;
  fetchedAt: string;
}

/**
 * Fetch contractors matching criteria from local database
 */
export async function fetchContractors(
  params: ContractorSearchParams,
  supabaseUrl: string,
  supabaseKey: string
): Promise<ContractorSearchResult> {
  const {
    naicsCodes = [],
    companyNames = [],
    certifications = [],
    limit = 200,
  } = params;

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`[Contractor DB] Fetching contractors for NAICS: ${naicsCodes.join(', ') || 'all'}`);

  let query = supabase
    .from('contractors')
    .select('*')
    .limit(limit);

  // Add NAICS filter using array contains
  if (naicsCodes.length > 0) {
    // Check if any of the contractor's NAICS codes match
    query = query.or(
      naicsCodes.map(n => `naics_codes.cs.{${n}}`).join(',')
    );
  }

  // Add company name filter
  if (companyNames.length > 0) {
    const nameFilters = companyNames.map(n => `company_name.ilike.%${n}%`).join(',');
    query = query.or(nameFilters);
  }

  try {
    const { data, error, count } = await query;

    if (error) {
      console.error('[Contractor DB] Query error:', error);
      throw error;
    }

    // Map database records to ContractorRecord
    const contractors: ContractorRecord[] = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id as string || '',
      companyName: row.company_name as string || row.name as string || '',
      uei: row.uei as string || null,
      cage: row.cage as string || row.cage_code as string || null,

      sbloName: row.sblo_name as string || row.contact_name as string || null,
      sbloTitle: row.sblo_title as string || null,
      sbloEmail: row.sblo_email as string || row.contact_email as string || null,
      sbloPhone: row.sblo_phone as string || row.contact_phone as string || null,

      certifications: row.certifications as string[] || [],
      is8a: (row.certifications as string[] || []).some((c: string) => c.toLowerCase().includes('8(a)')),
      isWosb: (row.certifications as string[] || []).some((c: string) => c.toLowerCase().includes('wosb')),
      isSdvosb: (row.certifications as string[] || []).some((c: string) => c.toLowerCase().includes('sdvosb')),
      isHubzone: (row.certifications as string[] || []).some((c: string) => c.toLowerCase().includes('hubzone')),
      isSmallBusiness: (row.is_small_business as boolean) || (row.certifications as string[] || []).length > 0,

      naicsCodes: row.naics_codes as string[] || [],
      primaryNaics: (row.naics_codes as string[] || [])[0] || '',
      employeeCount: row.employee_count as number || null,
      annualRevenue: row.annual_revenue as number || null,

      hasSubcontractingPlan: (row.has_subk_plan as boolean) || false,
      subcontractingGoals: row.subk_goals as Record<string, number> || null,

      website: row.website as string || null,
      vendorPortalUrl: row.vendor_portal as string || row.vendor_portal_url as string || null,

      lastUpdated: row.updated_at as string || row.last_updated as string || '',
      createdAt: row.created_at as string || '',
    }));

    console.log(`[Contractor DB] Retrieved ${contractors.length} contractors`);

    return {
      contractors,
      totalCount: count || contractors.length,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Contractor DB] Error fetching contractors:', error);
    throw error;
  }
}

/**
 * Fetch contractors for a specific user's watchlist
 */
export async function fetchContractorsForUser(
  userProfile: {
    naics_codes: string[];
    watched_companies: string[];
  },
  supabaseUrl: string,
  supabaseKey: string
): Promise<ContractorSearchResult> {
  return fetchContractors({
    naicsCodes: userProfile.naics_codes?.slice(0, 10) || [],
    companyNames: userProfile.watched_companies?.slice(0, 20) || [],
    limit: 200,
  }, supabaseUrl, supabaseKey);
}

/**
 * Compare two snapshots and identify changes
 */
export function diffContractors(
  today: ContractorRecord[],
  yesterday: ContractorRecord[]
): {
  newEntrants: ContractorRecord[];
  sbloChanges: ContractorChangeEvent[];
  certificationChanges: ContractorChangeEvent[];
  subkPlanChanges: ContractorChangeEvent[];
  infoUpdates: ContractorChangeEvent[];
} {
  const yesterdayMap = new Map(yesterday.map(c => [c.id || c.companyName, c]));
  const todayMap = new Map(today.map(c => [c.id || c.companyName, c]));

  const newEntrants: ContractorRecord[] = [];
  const sbloChanges: ContractorChangeEvent[] = [];
  const certificationChanges: ContractorChangeEvent[] = [];
  const subkPlanChanges: ContractorChangeEvent[] = [];
  const infoUpdates: ContractorChangeEvent[] = [];

  const timestamp = new Date().toISOString();

  for (const contractor of today) {
    const key = contractor.id || contractor.companyName;
    const prev = yesterdayMap.get(key);

    // NEW ENTRANT
    if (!prev) {
      newEntrants.push(contractor);
      continue;
    }

    // SBLO CHANGES
    if (contractor.sbloName !== prev.sbloName ||
        contractor.sbloEmail !== prev.sbloEmail ||
        contractor.sbloPhone !== prev.sbloPhone) {
      sbloChanges.push({
        contractorId: contractor.id,
        companyName: contractor.companyName,
        changeType: 'sblo_contact_changed',
        changeDetails: buildSbloChangeDetails(prev, contractor),
        previousValue: formatSbloContact(prev),
        newValue: formatSbloContact(contractor),
        timestamp,
      });
    }

    // CERTIFICATION CHANGES
    const prevCerts = new Set(prev.certifications);
    const todayCerts = new Set(contractor.certifications);

    // Gained certifications
    for (const cert of contractor.certifications) {
      if (!prevCerts.has(cert)) {
        certificationChanges.push({
          contractorId: contractor.id,
          companyName: contractor.companyName,
          changeType: 'certification_gained',
          changeDetails: `Gained ${cert} certification`,
          previousValue: null,
          newValue: cert,
          timestamp,
        });
      }
    }

    // Lost certifications
    for (const cert of prev.certifications) {
      if (!todayCerts.has(cert)) {
        certificationChanges.push({
          contractorId: contractor.id,
          companyName: contractor.companyName,
          changeType: 'certification_lost',
          changeDetails: `Lost ${cert} certification`,
          previousValue: cert,
          newValue: null,
          timestamp,
        });
      }
    }

    // SUBK PLAN CHANGES
    if (contractor.hasSubcontractingPlan && !prev.hasSubcontractingPlan) {
      subkPlanChanges.push({
        contractorId: contractor.id,
        companyName: contractor.companyName,
        changeType: 'subk_plan_posted',
        changeDetails: 'New subcontracting plan posted',
        previousValue: 'No plan',
        newValue: 'Plan posted',
        timestamp,
      });
    }

    // NAICS ADDED
    const prevNaics = new Set(prev.naicsCodes);
    for (const naics of contractor.naicsCodes) {
      if (!prevNaics.has(naics)) {
        infoUpdates.push({
          contractorId: contractor.id,
          companyName: contractor.companyName,
          changeType: 'naics_added',
          changeDetails: `Added NAICS ${naics}`,
          previousValue: null,
          newValue: naics,
          timestamp,
        });
      }
    }
  }

  return {
    newEntrants,
    sbloChanges,
    certificationChanges,
    subkPlanChanges,
    infoUpdates,
  };
}

/**
 * Score a contractor for teaming potential
 */
export function scoreContractorForTeaming(
  contractor: ContractorRecord,
  userProfile: {
    naics_codes: string[];
    agencies: string[];
  }
): {
  teamingScore: number;
  reasons: string[];
} {
  let score = 0;
  const reasons: string[] = [];

  // NAICS overlap
  const naicsOverlap = contractor.naicsCodes.filter(n =>
    userProfile.naics_codes.includes(n)
  ).length;
  if (naicsOverlap > 0) {
    score += naicsOverlap * 15;
    reasons.push(`${naicsOverlap} overlapping NAICS codes`);
  }

  // Has SBLO contact
  if (contractor.sbloEmail) {
    score += 20;
    reasons.push('SBLO contact available');
  }

  // Has subcontracting plan
  if (contractor.hasSubcontractingPlan) {
    score += 15;
    reasons.push('Active subcontracting plan');
  }

  // Complementary certifications
  if (contractor.is8a) {
    score += 10;
    reasons.push('8(a) certified');
  }
  if (contractor.isSdvosb) {
    score += 10;
    reasons.push('SDVOSB certified');
  }
  if (contractor.isWosb) {
    score += 10;
    reasons.push('WOSB certified');
  }
  if (contractor.isHubzone) {
    score += 10;
    reasons.push('HUBZone certified');
  }

  // Has vendor portal (easy to apply)
  if (contractor.vendorPortalUrl) {
    score += 10;
    reasons.push('Vendor portal available');
  }

  return {
    teamingScore: Math.min(score, 100),
    reasons,
  };
}

// Helper functions
function formatSbloContact(contractor: ContractorRecord): string {
  const parts = [];
  if (contractor.sbloName) parts.push(contractor.sbloName);
  if (contractor.sbloEmail) parts.push(contractor.sbloEmail);
  if (contractor.sbloPhone) parts.push(contractor.sbloPhone);
  return parts.join(' | ') || 'No contact';
}

function buildSbloChangeDetails(prev: ContractorRecord, current: ContractorRecord): string {
  const changes: string[] = [];

  if (prev.sbloName !== current.sbloName) {
    changes.push(`Name: ${prev.sbloName || 'none'} → ${current.sbloName || 'none'}`);
  }
  if (prev.sbloEmail !== current.sbloEmail) {
    changes.push(`Email: ${prev.sbloEmail || 'none'} → ${current.sbloEmail || 'none'}`);
  }
  if (prev.sbloPhone !== current.sbloPhone) {
    changes.push(`Phone: ${prev.sbloPhone || 'none'} → ${current.sbloPhone || 'none'}`);
  }

  return changes.join('; ');
}

export type { ContractorRecord, ContractorChangeEvent, ContractorSearchParams, ContractorSearchResult };
