/**
 * SAM.gov Federal Hierarchy API
 *
 * Provides agency organizational structure for targeted outreach:
 * - Department → Agency → Sub-Agency → Office hierarchy
 * - Office-level buying patterns by NAICS
 * - Agency contact information
 */

import {
  SAM_API_CONFIGS,
  makeSAMRequest
} from './utils';

// Types
export interface FederalOrganization {
  orgKey: string;
  name: string;
  code: string;
  type: 'department' | 'agency' | 'sub-agency' | 'office';
  parentOrgKey?: string;
  level: number;
  fpdsDepartmentCode?: string;
  fpdsAgencyCode?: string;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
  children?: FederalOrganization[];
}

export interface AgencyHierarchy {
  department: {
    orgKey: string;
    name: string;
    code: string;
  };
  agencies: Array<{
    orgKey: string;
    name: string;
    code: string;
    subAgencies: Array<{
      orgKey: string;
      name: string;
      code: string;
      offices: Array<{
        orgKey: string;
        name: string;
        code: string;
      }>;
    }>;
  }>;
  totalOffices: number;
}

export interface OfficeSearchResult {
  offices: FederalOrganization[];
  totalCount: number;
  hasMore: boolean;
  fromCache: boolean;
}

/**
 * Transform raw API response to our FederalOrganization type
 */
function transformOrganization(raw: Record<string, unknown>): FederalOrganization {
  const type = determineOrgType(raw);

  return {
    orgKey: String(raw.org_key || raw.orgKey || ''),
    name: String(raw.name || raw.org_name || ''),
    code: String(raw.code || raw.org_code || ''),
    type,
    parentOrgKey: raw.parent_org_key ? String(raw.parent_org_key) : undefined,
    level: Number(raw.level) || determineLevel(type),
    fpdsDepartmentCode: raw.fpds_department_code ? String(raw.fpds_department_code) : undefined,
    fpdsAgencyCode: raw.fpds_agency_code ? String(raw.fpds_agency_code) : undefined,
    startDate: raw.start_date ? String(raw.start_date) : undefined,
    endDate: raw.end_date ? String(raw.end_date) : undefined,
    isActive: raw.status === 'active' || raw.is_active === true || !raw.end_date
  };
}

function determineOrgType(raw: Record<string, unknown>): 'department' | 'agency' | 'sub-agency' | 'office' {
  const level = Number(raw.level);
  const type = String(raw.type || raw.org_type || '').toLowerCase();

  if (type.includes('department') || level === 1) return 'department';
  if (type.includes('sub') || type.includes('sub-agency') || level === 3) return 'sub-agency';
  if (type.includes('office') || level >= 4) return 'office';
  return 'agency';
}

function determineLevel(type: 'department' | 'agency' | 'sub-agency' | 'office'): number {
  switch (type) {
    case 'department': return 1;
    case 'agency': return 2;
    case 'sub-agency': return 3;
    case 'office': return 4;
  }
}

/**
 * Get full organizational structure for an agency
 */
export async function getAgencyStructure(
  agencyCode: string
): Promise<AgencyHierarchy | null> {
  const config = SAM_API_CONFIGS.hierarchy;

  const result = await makeSAMRequest<{
    results: Record<string, unknown>[];
    total_count?: number;
  }>(config, '/hierarchy', {
    agency_code: agencyCode,
    status: 'active',
    include_children: true,
    size: 500
  });

  if (result.error || !result.data?.results?.length) {
    console.error('[Federal Hierarchy Error]', result.error);
    return null;
  }

  const orgs = result.data.results.map(transformOrganization);

  // Find the department (top level)
  const department = orgs.find(o => o.type === 'department' || o.level === 1);
  if (!department) {
    return null;
  }

  // Build hierarchy
  const hierarchy: AgencyHierarchy = {
    department: {
      orgKey: department.orgKey,
      name: department.name,
      code: department.code
    },
    agencies: [],
    totalOffices: 0
  };

  // Group by parent
  const orgMap = new Map<string, FederalOrganization>();
  orgs.forEach(o => orgMap.set(o.orgKey, o));

  const childrenMap = new Map<string, FederalOrganization[]>();
  orgs.forEach(o => {
    if (o.parentOrgKey) {
      const children = childrenMap.get(o.parentOrgKey) || [];
      children.push(o);
      childrenMap.set(o.parentOrgKey, children);
    }
  });

  // Build agencies
  const agencies = orgs.filter(o => o.type === 'agency' && o.parentOrgKey === department.orgKey);

  for (const agency of agencies) {
    const agencyEntry = {
      orgKey: agency.orgKey,
      name: agency.name,
      code: agency.code,
      subAgencies: [] as {
        orgKey: string;
        name: string;
        code: string;
        offices: { orgKey: string; name: string; code: string }[];
      }[]
    };

    // Get sub-agencies for this agency
    const subAgencies = childrenMap.get(agency.orgKey)?.filter(o => o.type === 'sub-agency') || [];

    for (const subAgency of subAgencies) {
      const subEntry = {
        orgKey: subAgency.orgKey,
        name: subAgency.name,
        code: subAgency.code,
        offices: [] as { orgKey: string; name: string; code: string }[]
      };

      // Get offices for this sub-agency
      const offices = childrenMap.get(subAgency.orgKey)?.filter(o => o.type === 'office') || [];
      subEntry.offices = offices.map(o => ({
        orgKey: o.orgKey,
        name: o.name,
        code: o.code
      }));

      hierarchy.totalOffices += subEntry.offices.length;
      agencyEntry.subAgencies.push(subEntry);
    }

    // Also get direct offices under the agency (no sub-agency)
    const directOffices = childrenMap.get(agency.orgKey)?.filter(o => o.type === 'office') || [];
    if (directOffices.length > 0) {
      agencyEntry.subAgencies.push({
        orgKey: `${agency.orgKey}-direct`,
        name: 'Direct Offices',
        code: 'DIRECT',
        offices: directOffices.map(o => ({
          orgKey: o.orgKey,
          name: o.name,
          code: o.code
        }))
      });
      hierarchy.totalOffices += directOffices.length;
    }

    hierarchy.agencies.push(agencyEntry);
  }

  return hierarchy;
}

/**
 * Search for offices that buy a specific NAICS
 */
export async function getOfficesForNaics(
  naicsCode: string,
  agencyCode?: string
): Promise<OfficeSearchResult> {
  const config = SAM_API_CONFIGS.hierarchy;

  const params: Record<string, string | number> = {
    naics_code: naicsCode,
    type: 'office',
    status: 'active',
    size: 100
  };

  if (agencyCode) {
    params.agency_code = agencyCode;
  }

  const result = await makeSAMRequest<{
    results: Record<string, unknown>[];
    total_count?: number;
    page_metadata?: { hasNext: boolean };
  }>(config, '/offices', params);

  if (result.error) {
    console.error('[Offices for NAICS Error]', result.error);
    return {
      offices: [],
      totalCount: 0,
      hasMore: false,
      fromCache: false
    };
  }

  const offices = (result.data?.results || []).map(transformOrganization);

  return {
    offices,
    totalCount: result.data?.total_count || offices.length,
    hasMore: result.data?.page_metadata?.hasNext || false,
    fromCache: result.fromCache
  };
}

/**
 * Search offices by name or code
 */
export async function searchOffices(params: {
  agencyCode?: string;
  name?: string;
  state?: string;
  limit?: number;
}): Promise<OfficeSearchResult> {
  const config = SAM_API_CONFIGS.hierarchy;

  const queryParams: Record<string, string | number> = {
    type: 'office',
    status: 'active',
    size: params.limit || 50
  };

  if (params.agencyCode) {
    queryParams.agency_code = params.agencyCode;
  }

  if (params.name) {
    queryParams.q = params.name;
  }

  if (params.state) {
    queryParams.state = params.state;
  }

  const result = await makeSAMRequest<{
    results: Record<string, unknown>[];
    total_count?: number;
    page_metadata?: { hasNext: boolean };
  }>(config, '/offices', queryParams);

  if (result.error) {
    console.error('[Search Offices Error]', result.error);
    return {
      offices: [],
      totalCount: 0,
      hasMore: false,
      fromCache: false
    };
  }

  const offices = (result.data?.results || []).map(transformOrganization);

  return {
    offices,
    totalCount: result.data?.total_count || offices.length,
    hasMore: result.data?.page_metadata?.hasNext || false,
    fromCache: result.fromCache
  };
}

/**
 * Get list of top-level departments
 */
export async function getDepartments(): Promise<FederalOrganization[]> {
  const config = SAM_API_CONFIGS.hierarchy;

  const result = await makeSAMRequest<{
    results: Record<string, unknown>[];
  }>(config, '/hierarchy', {
    level: 1,
    status: 'active',
    size: 100
  });

  if (result.error || !result.data?.results) {
    console.error('[Get Departments Error]', result.error);
    return [];
  }

  return result.data.results.map(transformOrganization);
}

/**
 * Get buying offices summary for Market Assassin reports
 * Returns top offices that purchase in a given NAICS
 */
export async function getBuyingOfficesSummary(
  naicsCode: string,
  agencyCode?: string,
  limit: number = 10
): Promise<{
  naics: string;
  agency?: string;
  offices: Array<{
    name: string;
    code: string;
    agency: string;
    department: string;
  }>;
  totalFound: number;
}> {
  const offices = await getOfficesForNaics(naicsCode, agencyCode);

  // Group by agency for better display
  const officeList = offices.offices.slice(0, limit).map(o => ({
    name: o.name,
    code: o.code,
    agency: o.fpdsAgencyCode || 'Unknown',
    department: o.fpdsDepartmentCode || 'Unknown'
  }));

  return {
    naics: naicsCode,
    agency: agencyCode,
    offices: officeList,
    totalFound: offices.totalCount
  };
}
