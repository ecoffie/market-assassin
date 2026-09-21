/**
 * Agency Hierarchy API v2
 *
 * Unified federal agency intelligence combining:
 * - SAM.gov Federal Hierarchy
 * - Pain Points database (250 agencies, 2,765 pain points)
 * - Contractor/SBLO contacts (2,768 contractors)
 * - Agency aliases and abbreviations (450+ mappings)
 * - CGAC/FPDS code lookups
 *
 * Inspired by Tango by MakeGov, enhanced with GovCon-specific intel.
 *
 * ENDPOINTS:
 *
 * Search agencies:
 *   GET /api/agency-hierarchy?search=FEMA
 *   GET /api/agency-hierarchy?search=VA
 *   GET /api/agency-hierarchy?search=cybersecurity
 *
 * Lookup by CGAC code:
 *   GET /api/agency-hierarchy?cgac=069
 *
 * Get specific agency:
 *   GET /api/agency-hierarchy?agency=VA
 *   GET /api/agency-hierarchy?agency=Department of Veterans Affairs
 *
 * Get all departments:
 *   GET /api/agency-hierarchy?mode=departments
 *
 * Get hierarchy tree:
 *   GET /api/agency-hierarchy?agency=VA&mode=tree
 *
 * Get buying offices:
 *   GET /api/agency-hierarchy?naics=541512&mode=buying
 *
 * Search offices:
 *   GET /api/agency-hierarchy?office=contracting&state=FL
 *
 * Get service stats:
 *   GET /api/agency-hierarchy?mode=stats
 *
 * QUERY PARAMETERS:
 *   search    - Search term (name, abbreviation, or topic)
 *   agency    - Agency name or abbreviation for direct lookup
 *   cgac      - CGAC code lookup (e.g., "069")
 *   naics     - NAICS code (for buying offices mode)
 *   office    - Office name search
 *   state     - State code filter (e.g., "FL")
 *   mode      - Response mode: auto, departments, tree, buying, offices, stats
 *   include   - Comma-separated: painPoints,contractors,children,hierarchy
 *   limit     - Max results (default: 10)
 */

import { NextRequest, NextResponse } from 'next/server';

import {
  searchAgencies,
  getAgency,
  getAllDepartments,
  getAgencyHierarchyTree,
  getServiceStats,
  getPainPointsByNaics,
  getAgencySpending,
  getSpendingSummary,
  formatSpending
} from '@/lib/agency-hierarchy';

import {
  getAgencyStructure,
  getOfficesForNaics,
  searchOffices,
  getDepartments,
  getBuyingOfficesSummary
} from '@/lib/sam/federal-hierarchy';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Parse parameters
  const search = searchParams.get('search');
  const agency = searchParams.get('agency');
  const cgac = searchParams.get('cgac');
  const naics = searchParams.get('naics');
  const officeName = searchParams.get('office');
  const state = searchParams.get('state');
  const mode = searchParams.get('mode') || 'auto';
  const includeParam = searchParams.get('include') || 'painPoints,contractors';
  const limit = parseInt(searchParams.get('limit') || '10');

  // Parse include options
  const includes = includeParam.split(',').map(s => s.trim().toLowerCase());
  const options = {
    includeHierarchy: includes.includes('hierarchy'),
    includePainPoints: includes.includes('painpoints'),
    includeContractors: includes.includes('contractors'),
    includeChildren: includes.includes('children'),
    limit
  };

  try {
    // Mode: stats - service statistics
    if (mode === 'stats') {
      const stats = getServiceStats();

      return NextResponse.json({
        success: true,
        mode: 'stats',
        data: {
          agencies: stats.painPoints.totalAgencies,
          painPoints: stats.painPoints.totalPainPoints,
          priorities: stats.painPoints.totalPriorities,
          aliases: stats.aliasCount,
          contractors: stats.contractorsCount,
          sources: ['SAM.gov Federal Hierarchy', 'Pain Points Database', 'Contractor Database', 'Agency Aliases', 'USASpending.gov']
        }
      });
    }

    // Mode: spending - get spending summary or agency spending
    if (mode === 'spending') {
      const fy = searchParams.get('fy') ? parseInt(searchParams.get('fy')!) : undefined;

      if (agency) {
        // Get spending for specific agency
        const spending = await getAgencySpending(agency, fy);

        if (!spending) {
          return NextResponse.json({
            success: false,
            error: `No spending data found for: ${agency}`
          }, { status: 404 });
        }

        return NextResponse.json({
          success: true,
          mode: 'spending',
          agency,
          fiscalYear: spending.fiscalYear,
          data: {
            totalObligations: spending.totalObligations,
            totalObligationsFormatted: formatSpending(spending.totalObligations),
            totalOutlays: spending.totalOutlays,
            totalOutlaysFormatted: formatSpending(spending.totalOutlays),
            contractCount: spending.contractCount,
            topNaics: spending.topNaics
          }
        });
      }

      // Get overall spending summary
      const summary = await getSpendingSummary(fy);

      if (!summary) {
        return NextResponse.json({
          success: false,
          error: 'Failed to fetch spending summary'
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        mode: 'spending',
        fiscalYear: summary.fiscalYear,
        data: {
          totalAgencies: summary.totalAgencies,
          totalObligations: summary.totalObligations,
          totalObligationsFormatted: formatSpending(summary.totalObligations),
          topAgencies: summary.topAgencies.map(a => ({
            name: a.name,
            obligations: a.obligations,
            obligationsFormatted: formatSpending(a.obligations),
            percentOfTotal: a.percentOfTotal
          }))
        }
      });
    }

    // Mode: departments - list all top-level departments
    if (mode === 'departments') {
      const departments = await getDepartments();
      const enrichedDepartments = await getAllDepartments();

      return NextResponse.json({
        success: true,
        mode: 'departments',
        totalDepartments: departments.length,
        departments: enrichedDepartments.map(d => ({
          name: d.name,
          shortName: d.shortName,
          cgacCode: d.cgacCode,
          painPointsCount: d.painPoints.length,
          prioritiesCount: d.priorities.length,
          childAgencies: d.children.length
        }))
      });
    }

    // Mode: tree - get full hierarchy tree for an agency
    if (mode === 'tree' && agency) {
      const tree = await getAgencyHierarchyTree(agency);

      if (!tree) {
        return NextResponse.json({
          success: false,
          error: `No hierarchy tree found for: ${agency}`
        }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        mode: 'tree',
        agency,
        department: tree.department ? {
          name: tree.department.name,
          shortName: tree.department.shortName,
          painPoints: tree.department.painPoints.slice(0, 5),
          priorities: tree.department.priorities.slice(0, 5)
        } : null,
        agencies: tree.agencies.map(a => ({
          name: a.name,
          shortName: a.shortName,
          painPointsCount: a.painPoints.length
        })),
        totalOffices: tree.totalOffices
      });
    }

    // Mode: buying - get offices that buy a specific NAICS
    if (mode === 'buying' || (naics && !agency && !search)) {
      if (!naics) {
        return NextResponse.json({
          success: false,
          error: 'naics parameter required for buying mode'
        }, { status: 400 });
      }

      const summary = await getBuyingOfficesSummary(naics, agency || undefined, limit);

      // Also get pain points related to this NAICS
      const relatedPainPoints = getPainPointsByNaics(naics);

      return NextResponse.json({
        success: true,
        mode: 'buying',
        naics,
        agency,
        totalFound: summary.totalFound,
        offices: summary.offices,
        relatedAgencies: relatedPainPoints.slice(0, 5).map(pp => ({
          agency: pp.agency,
          relevantPainPoints: pp.painPoints.slice(0, 3)
        }))
      });
    }

    // Mode: offices - search offices by name/state
    if (mode === 'offices' || officeName) {
      const result = await searchOffices({
        agencyCode: agency || undefined,
        name: officeName || undefined,
        state: state || undefined,
        limit
      });

      return NextResponse.json({
        success: true,
        mode: 'offices',
        params: { agency, officeName, state, limit },
        totalCount: result.totalCount,
        hasMore: result.hasMore,
        fromCache: result.fromCache,
        offices: result.offices.map(o => ({
          orgKey: o.orgKey,
          name: o.name,
          code: o.code,
          type: o.type,
          parentOrgKey: o.parentOrgKey,
          fpdsDepartmentCode: o.fpdsDepartmentCode,
          fpdsAgencyCode: o.fpdsAgencyCode,
          isActive: o.isActive
        }))
      });
    }

    // CGAC lookup
    if (cgac) {
      const result = await getAgency(cgac, options);

      if (!result) {
        return NextResponse.json({
          success: false,
          error: `No agency found for CGAC code: ${cgac}`
        }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        mode: 'cgac_lookup',
        cgac,
        result: formatAgencyResult(result)
      });
    }

    // Search mode (default)
    if (search) {
      const results = await searchAgencies(search, options);

      if (results.length === 0) {
        return NextResponse.json({
          success: true,
          mode: 'search',
          query: search,
          totalResults: 0,
          results: [],
          suggestion: 'Try a different search term or abbreviation'
        });
      }

      return NextResponse.json({
        success: true,
        mode: 'search',
        query: search,
        totalResults: results.length,
        results: results.map(formatAgencyResult)
      });
    }

    // Direct agency lookup
    if (agency) {
      // First try unified lookup
      const unifiedResult = await getAgency(agency, options);

      if (unifiedResult) {
        // If NAICS provided, also include buying offices
        let buyingOffices = null;
        if (naics) {
          const offices = await getOfficesForNaics(naics, agency);
          buyingOffices = {
            naics,
            totalFound: offices.totalCount,
            offices: offices.offices.slice(0, 10).map(o => ({
              name: o.name,
              code: o.code
            }))
          };
        }

        return NextResponse.json({
          success: true,
          mode: 'agency_lookup',
          agency,
          result: formatAgencyResult(unifiedResult),
          buyingOffices
        });
      }

      // Fallback to SAM.gov hierarchy
      const hierarchy = await getAgencyStructure(agency);

      if (!hierarchy) {
        return NextResponse.json({
          success: false,
          error: `No agency found for: ${agency}`
        }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        mode: 'structure',
        agency,
        department: hierarchy.department,
        totalAgencies: hierarchy.agencies.length,
        totalOffices: hierarchy.totalOffices,
        agencies: hierarchy.agencies.map(a => ({
          name: a.name,
          code: a.code,
          subAgencies: a.subAgencies.length,
          offices: a.subAgencies.reduce((sum, s) => sum + s.offices.length, 0)
        }))
      });
    }

    // No valid parameters
    return NextResponse.json({
      success: false,
      error: 'At least one parameter required: search, agency, cgac, naics, office, or mode',
      usage: {
        search: 'Search by name, abbreviation, or topic',
        agency: 'Direct agency lookup',
        cgac: 'CGAC code lookup (e.g., 069)',
        naics: 'Find buying offices for NAICS',
        office: 'Search offices by name',
        mode: 'departments, tree, buying, offices, stats'
      }
    }, { status: 400 });

  } catch (error) {
    console.error('[Agency Hierarchy Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process request'
    }, { status: 500 });
  }
}

/**
 * Format agency result for API response
 */
function formatAgencyResult(result: Awaited<ReturnType<typeof getAgency>>) {
  if (!result) return null;

  return {
    // Core identification
    name: result.name,
    shortName: result.shortName,
    cgacCode: result.cgacCode,

    // Hierarchy
    parent: result.parent,
    parentPath: result.parentPath,
    level: result.level,
    children: result.children.length > 0 ? result.children : undefined,

    // GovCon Intel
    painPoints: result.painPoints.length > 0 ? result.painPoints : undefined,
    priorities: result.priorities.length > 0 ? result.priorities : undefined,

    // Contractors (SBLOs)
    contractors: result.relatedContractors.length > 0 ? result.relatedContractors.map(c => ({
      company: c.company,
      sblo: c.sbloName,
      email: c.email,
      contractValue: c.totalContractValue > 0 ? formatCurrency(c.totalContractValue) : undefined
    })) : undefined,

    // Metadata
    matchType: result.matchType,
    matchScore: result.matchScore,
    sources: result.sources
  };
}

/**
 * Format currency for display
 */
function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}
