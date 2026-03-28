/**
 * Agency Hierarchy API
 *
 * GET /api/agency-hierarchy?agency=VA
 * GET /api/agency-hierarchy?agency=VA&naics=541512
 * GET /api/agency-hierarchy/offices?name=contracting&state=FL
 * GET /api/agency-hierarchy/departments
 *
 * Returns federal organizational structure for targeted outreach
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAgencyStructure,
  getOfficesForNaics,
  searchOffices,
  getDepartments,
  getBuyingOfficesSummary
} from '@/lib/sam/federal-hierarchy';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const agency = searchParams.get('agency');
  const naics = searchParams.get('naics');
  const officeName = searchParams.get('office');
  const state = searchParams.get('state');
  const mode = searchParams.get('mode') || 'auto'; // auto, structure, offices, buying, departments
  const limit = parseInt(searchParams.get('limit') || '25');

  try {
    // Mode: departments - list all top-level departments
    if (mode === 'departments') {
      const departments = await getDepartments();

      return NextResponse.json({
        success: true,
        mode: 'departments',
        totalDepartments: departments.length,
        departments: departments.map(d => ({
          orgKey: d.orgKey,
          name: d.name,
          code: d.code,
          fpdsDepartmentCode: d.fpdsDepartmentCode
        }))
      });
    }

    // Mode: buying - get offices that buy a specific NAICS
    if (mode === 'buying' || (naics && !agency)) {
      if (!naics) {
        return NextResponse.json({
          success: false,
          error: 'naics parameter required for buying mode'
        }, { status: 400 });
      }

      const summary = await getBuyingOfficesSummary(naics, agency || undefined, limit);

      return NextResponse.json({
        success: true,
        mode: 'buying',
        naics,
        agency,
        totalFound: summary.totalFound,
        offices: summary.offices
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

    // Mode: structure - get full agency hierarchy
    if (agency) {
      const hierarchy = await getAgencyStructure(agency);

      if (!hierarchy) {
        return NextResponse.json({
          success: false,
          error: `No hierarchy found for agency: ${agency}`
        }, { status: 404 });
      }

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
        })),
        // Include full structure for first agency only (for size)
        sampleAgency: hierarchy.agencies[0] ? {
          name: hierarchy.agencies[0].name,
          code: hierarchy.agencies[0].code,
          subAgencies: hierarchy.agencies[0].subAgencies.slice(0, 5).map(s => ({
            name: s.name,
            code: s.code,
            offices: s.offices.slice(0, 5)
          }))
        } : null,
        buyingOffices
      });
    }

    // No valid mode determined
    return NextResponse.json({
      success: false,
      error: 'At least one parameter required: agency, naics, office, or mode=departments'
    }, { status: 400 });

  } catch (error) {
    console.error('[Agency Hierarchy Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch agency hierarchy'
    }, { status: 500 });
  }
}
