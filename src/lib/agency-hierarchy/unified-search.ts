/**
 * Unified Agency Search Service
 *
 * Aggregates data from:
 * - SAM.gov Federal Hierarchy API
 * - Pain Points database (250 agencies)
 * - Contractor/SBLO database
 * - Agency aliases and abbreviations
 * - CGAC/FPDS codes
 *
 * Inspired by Tango by MakeGov but enhanced with GovCon-specific intel.
 */

import {
  getAgencyStructure,
  getDepartments,
  searchOffices,
  FederalOrganization
} from '@/lib/sam/federal-hierarchy';

import {
  getPainPointsForAgency,
  searchPainPoints,
  resolveAlias,
  resolveCgacCode,
  getParentAgency,
  getCgacCode,
  getAgencyInfo,
  getPainPointsStats
} from './pain-points-linker';

import contractorsData from '@/data/contractors.json';
import agencyAliasesData from '@/data/agency-aliases.json';

// Types
export interface UnifiedAgencyResult {
  // Core identification
  name: string;
  shortName: string | null;
  cgacCode: string | null;
  fpdsCodes: string[];

  // Hierarchy
  parent: string | null;
  parentPath: string;
  level: 'department' | 'agency' | 'sub-agency' | 'office' | 'unknown';
  children: string[];

  // GovCon Intel
  painPoints: string[];
  priorities: string[];

  // Contacts (SBLOs at contractors who work with this agency)
  relatedContractors: Array<{
    company: string;
    sbloName: string | null;
    email: string | null;
    phone: string | null;
    totalContractValue: number;
  }>;

  // Metadata
  matchType: 'exact' | 'alias' | 'cgac' | 'partial' | 'hierarchy';
  matchScore: number;
  sources: string[];
}

export interface UnifiedSearchOptions {
  includeHierarchy?: boolean;
  includePainPoints?: boolean;
  includeContractors?: boolean;
  includeChildren?: boolean;
  limit?: number;
}

const defaultOptions: UnifiedSearchOptions = {
  includeHierarchy: true,
  includePainPoints: true,
  includeContractors: true,
  includeChildren: false,
  limit: 10
};

/**
 * Main unified search function
 */
export async function searchAgencies(
  query: string,
  options: UnifiedSearchOptions = {}
): Promise<UnifiedAgencyResult[]> {
  const opts = { ...defaultOptions, ...options };
  const normalized = query.toLowerCase().trim();
  const results: UnifiedAgencyResult[] = [];
  const seenAgencies = new Set<string>();

  // 1. Check for CGAC code lookup (e.g., "069" -> FEMA)
  if (/^\d{3}$/.test(normalized)) {
    const cgacAgency = resolveCgacCode(normalized);
    if (cgacAgency) {
      const result = await buildAgencyResult(cgacAgency, 'cgac', 100, opts);
      if (result) {
        results.push(result);
        seenAgencies.add(cgacAgency.toLowerCase());
      }
    }
  }

  // 2. Check for alias (e.g., "VA" -> "Department of Veterans Affairs")
  const aliasedName = resolveAlias(query);
  if (aliasedName && !seenAgencies.has(aliasedName.toLowerCase())) {
    const result = await buildAgencyResult(aliasedName, 'alias', 95, opts);
    if (result) {
      results.push(result);
      seenAgencies.add(aliasedName.toLowerCase());
    }
  }

  // 3. Check for exact match in pain points
  const exactPainPoints = getPainPointsForAgency(query);
  if (exactPainPoints && !seenAgencies.has(exactPainPoints.agencyName.toLowerCase())) {
    const result = await buildAgencyResult(exactPainPoints.agencyName, 'exact', 90, opts);
    if (result) {
      results.push(result);
      seenAgencies.add(exactPainPoints.agencyName.toLowerCase());
    }
  }

  // 4. Search pain points for partial matches
  if (opts.includePainPoints) {
    const painPointResults = searchPainPoints(query, 5);
    for (const pp of painPointResults) {
      if (!seenAgencies.has(pp.agency.toLowerCase())) {
        const result = await buildAgencyResult(pp.agency, 'partial', pp.relevanceScore, opts);
        if (result) {
          results.push(result);
          seenAgencies.add(pp.agency.toLowerCase());
        }
      }
    }
  }

  // 5. Search SAM.gov hierarchy
  if (opts.includeHierarchy && results.length < opts.limit!) {
    try {
      const hierarchyResults = await searchOffices({
        name: query,
        limit: 5
      });

      for (const office of hierarchyResults.offices) {
        if (!seenAgencies.has(office.name.toLowerCase())) {
          const result = buildAgencyResultFromHierarchy(office, opts);
          results.push(result);
          seenAgencies.add(office.name.toLowerCase());
        }
      }
    } catch (error) {
      console.error('[Unified Search] Hierarchy search error:', error);
    }
  }

  // Sort by match score
  results.sort((a, b) => b.matchScore - a.matchScore);

  return results.slice(0, opts.limit);
}

/**
 * Look up a single agency by name or code
 */
export async function getAgency(
  identifier: string,
  options: UnifiedSearchOptions = {}
): Promise<UnifiedAgencyResult | null> {
  const opts = { ...defaultOptions, ...options };

  // Try CGAC code
  if (/^\d{3}$/.test(identifier)) {
    const cgacAgency = resolveCgacCode(identifier);
    if (cgacAgency) {
      return buildAgencyResult(cgacAgency, 'cgac', 100, opts);
    }
  }

  // Try alias
  const aliasedName = resolveAlias(identifier);
  if (aliasedName) {
    return buildAgencyResult(aliasedName, 'alias', 100, opts);
  }

  // Try exact pain points match
  const painPoints = getPainPointsForAgency(identifier);
  if (painPoints) {
    return buildAgencyResult(painPoints.agencyName, 'exact', 100, opts);
  }

  // Try hierarchy
  try {
    const hierarchyResults = await searchOffices({ name: identifier, limit: 1 });
    if (hierarchyResults.offices.length > 0) {
      return buildAgencyResultFromHierarchy(hierarchyResults.offices[0], opts);
    }
  } catch (error) {
    console.error('[getAgency] Hierarchy lookup error:', error);
  }

  return null;
}

/**
 * Build a unified result from agency name
 */
async function buildAgencyResult(
  agencyName: string,
  matchType: UnifiedAgencyResult['matchType'],
  matchScore: number,
  options: UnifiedSearchOptions
): Promise<UnifiedAgencyResult | null> {
  const sources: string[] = [];

  // Get pain points info
  const agencyInfo = getAgencyInfo(agencyName);
  if (agencyInfo) {
    sources.push('pain_points');
  }

  // Get related contractors
  let relatedContractors: UnifiedAgencyResult['relatedContractors'] = [];
  if (options.includeContractors) {
    relatedContractors = findRelatedContractors(agencyName);
    if (relatedContractors.length > 0) {
      sources.push('contractors');
    }
  }

  // Get children (sub-agencies)
  const children: string[] = [];
  if (options.includeChildren) {
    const childAgencies = findChildAgencies(agencyName);
    children.push(...childAgencies);
  }

  // Build hierarchy path
  const parent = agencyInfo?.parent || getParentAgency(agencyName);
  let parentPath = agencyName;
  if (parent) {
    const grandparent = getParentAgency(parent);
    if (grandparent) {
      parentPath = `${grandparent} > ${parent} > ${agencyName}`;
    } else {
      parentPath = `${parent} > ${agencyName}`;
    }
  }

  // Determine level
  const level = determineAgencyLevel(agencyName, parent);

  // Extract short name
  const shortName = extractShortName(agencyName);

  return {
    name: agencyName,
    shortName,
    cgacCode: agencyInfo?.cgacCode || getCgacCode(agencyName),
    fpdsCodes: [], // Would need additional mapping

    parent,
    parentPath,
    level,
    children,

    painPoints: agencyInfo?.painPoints || [],
    priorities: agencyInfo?.priorities || [],

    relatedContractors,

    matchType,
    matchScore,
    sources
  };
}

/**
 * Build result from Federal Hierarchy data
 */
function buildAgencyResultFromHierarchy(
  org: FederalOrganization,
  options: UnifiedSearchOptions
): UnifiedAgencyResult {
  // Try to find pain points for this org
  const painPoints = getPainPointsForAgency(org.name);

  // Get related contractors
  let relatedContractors: UnifiedAgencyResult['relatedContractors'] = [];
  if (options.includeContractors) {
    relatedContractors = findRelatedContractors(org.name);
  }

  return {
    name: org.name,
    shortName: org.code || null,
    cgacCode: org.fpdsDepartmentCode || null,
    fpdsCodes: org.fpdsAgencyCode ? [org.fpdsAgencyCode] : [],

    parent: null, // Would need to fetch
    parentPath: org.name,
    level: org.type,
    children: [],

    painPoints: painPoints?.painPoints || [],
    priorities: painPoints?.priorities || [],

    relatedContractors,

    matchType: 'hierarchy',
    matchScore: 50,
    sources: ['hierarchy']
  };
}

/**
 * Find contractors who work with an agency
 */
function findRelatedContractors(agencyName: string): UnifiedAgencyResult['relatedContractors'] {
  const contractors = contractorsData as Array<{
    company: string;
    sblo_name: string;
    email: string;
    phone: string;
    agencies: string;
    total_contract_value: string;
    contract_value_num: number;
  }>;

  const normalizedAgency = agencyName.toLowerCase();
  const related: UnifiedAgencyResult['relatedContractors'] = [];

  for (const contractor of contractors) {
    if (!contractor.agencies) continue;

    const contractorAgencies = contractor.agencies.toLowerCase();

    // Check if agency name appears in contractor's agency list
    if (contractorAgencies.includes(normalizedAgency) ||
      // Also check common abbreviations
      (normalizedAgency.includes('defense') && contractorAgencies.includes('defense')) ||
      (normalizedAgency.includes('veterans') && contractorAgencies.includes('veterans')) ||
      (normalizedAgency.includes('health') && contractorAgencies.includes('health'))
    ) {
      related.push({
        company: contractor.company,
        sbloName: contractor.sblo_name || null,
        email: contractor.email || null,
        phone: contractor.phone || null,
        totalContractValue: contractor.contract_value_num || 0
      });
    }
  }

  // Sort by contract value and limit
  related.sort((a, b) => b.totalContractValue - a.totalContractValue);
  return related.slice(0, 5);
}

/**
 * Find child agencies from parent mappings
 */
function findChildAgencies(parentName: string): string[] {
  const parentMappings = (agencyAliasesData as { parentMappings: Record<string, string> }).parentMappings;
  const children: string[] = [];

  for (const [child, parent] of Object.entries(parentMappings)) {
    if (parent.toLowerCase() === parentName.toLowerCase()) {
      // Resolve alias to full name if possible
      const fullName = resolveAlias(child);
      children.push(fullName || child);
    }
  }

  return children;
}

/**
 * Determine agency level in hierarchy
 */
function determineAgencyLevel(
  agencyName: string,
  parent: string | null
): UnifiedAgencyResult['level'] {
  const name = agencyName.toLowerCase();

  // Department level
  if (name.startsWith('department of') || name === 'nasa' || name === 'epa') {
    return 'department';
  }

  // Check if it's a known sub-agency
  if (parent) {
    const parentLower = parent.toLowerCase();
    if (parentLower.startsWith('department of')) {
      return 'agency';
    }
    return 'sub-agency';
  }

  // Office indicators
  if (name.includes('office of') || name.includes('bureau of')) {
    return 'office';
  }

  return 'unknown';
}

/**
 * Extract short name/abbreviation from full name
 */
function extractShortName(agencyName: string): string | null {
  // Check for parenthetical abbreviation
  const parenMatch = agencyName.match(/\(([A-Z]{2,10})\)/);
  if (parenMatch) {
    return parenMatch[1];
  }

  // Check aliases for this agency
  const aliases = (agencyAliasesData as { aliases: Record<string, string> }).aliases;
  for (const [alias, name] of Object.entries(aliases)) {
    if (name === agencyName && alias.length <= 6 && alias === alias.toUpperCase()) {
      return alias;
    }
  }

  return null;
}

/**
 * Get all top-level departments
 */
export async function getAllDepartments(): Promise<UnifiedAgencyResult[]> {
  const results: UnifiedAgencyResult[] = [];

  // Get from SAM.gov
  try {
    const samDepartments = await getDepartments();
    for (const dept of samDepartments) {
      const result = await buildAgencyResult(dept.name, 'hierarchy', 100, {
        includeHierarchy: false,
        includePainPoints: true,
        includeContractors: false,
        includeChildren: true
      });
      if (result) {
        results.push(result);
      }
    }
  } catch (error) {
    console.error('[getAllDepartments] Error:', error);
  }

  return results;
}

/**
 * Get agency hierarchy tree
 */
export async function getAgencyHierarchyTree(agencyCode: string): Promise<{
  department: UnifiedAgencyResult | null;
  agencies: UnifiedAgencyResult[];
  totalOffices: number;
} | null> {
  try {
    const hierarchy = await getAgencyStructure(agencyCode);
    if (!hierarchy) return null;

    const departmentResult = await buildAgencyResult(
      hierarchy.department.name,
      'hierarchy',
      100,
      { includeHierarchy: false, includePainPoints: true, includeContractors: false }
    );

    const agencyResults: UnifiedAgencyResult[] = [];
    for (const agency of hierarchy.agencies) {
      const result = await buildAgencyResult(
        agency.name,
        'hierarchy',
        80,
        { includeHierarchy: false, includePainPoints: true, includeContractors: false }
      );
      if (result) {
        agencyResults.push(result);
      }
    }

    return {
      department: departmentResult,
      agencies: agencyResults,
      totalOffices: hierarchy.totalOffices
    };
  } catch (error) {
    console.error('[getAgencyHierarchyTree] Error:', error);
    return null;
  }
}

/**
 * Get service statistics
 */
export function getServiceStats(): {
  painPoints: ReturnType<typeof getPainPointsStats>;
  contractorsCount: number;
  aliasCount: number;
} {
  const contractors = contractorsData as unknown[];
  const aliases = (agencyAliasesData as { aliases: Record<string, string> }).aliases;

  return {
    painPoints: getPainPointsStats(),
    contractorsCount: contractors.length,
    aliasCount: Object.keys(aliases).length
  };
}
