/**
 * Admin endpoint to test SAM.gov Federal Hierarchy API
 *
 * GET /api/admin/test-sam-hierarchy?password=xxx&agency=VA
 * GET /api/admin/test-sam-hierarchy?password=xxx&naics=541512
 * GET /api/admin/test-sam-hierarchy?password=xxx&mode=departments
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAgencyStructure,
  getOfficesForNaics,
  searchOffices,
  getDepartments,
  getBuyingOfficesSummary
} from '@/lib/sam/federal-hierarchy';
import { getRateLimitStatus } from '@/lib/sam/utils';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  // Auth check
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const agency = searchParams.get('agency');
  const naics = searchParams.get('naics');
  const officeName = searchParams.get('office');
  const state = searchParams.get('state');
  const mode = searchParams.get('mode') || 'auto'; // auto, structure, offices, buying, departments

  try {
    const startTime = Date.now();
    let result;
    let actualMode = mode;

    // Auto-detect mode
    if (mode === 'auto') {
      if (agency) {
        actualMode = 'structure';
      } else if (naics) {
        actualMode = 'buying';
      } else if (officeName) {
        actualMode = 'offices';
      } else {
        actualMode = 'departments';
      }
    }

    switch (actualMode) {
      case 'departments': {
        const departments = await getDepartments();
        result = {
          totalDepartments: departments.length,
          departments: departments.slice(0, 15).map(d => ({
            name: d.name,
            code: d.code,
            fpdsDepartmentCode: d.fpdsDepartmentCode,
            isActive: d.isActive
          }))
        };
        break;
      }

      case 'structure': {
        if (!agency) {
          return NextResponse.json({
            success: false,
            error: 'agency parameter required for structure mode'
          }, { status: 400 });
        }

        const hierarchy = await getAgencyStructure(agency);

        if (!hierarchy) {
          return NextResponse.json({
            success: false,
            error: `No hierarchy found for agency: ${agency}`
          }, { status: 404 });
        }

        result = {
          department: hierarchy.department,
          totalAgencies: hierarchy.agencies.length,
          totalOffices: hierarchy.totalOffices,
          agencySummary: hierarchy.agencies.slice(0, 5).map(a => ({
            name: a.name,
            code: a.code,
            subAgencies: a.subAgencies.length,
            offices: a.subAgencies.reduce((sum, s) => sum + s.offices.length, 0)
          })),
          sampleStructure: hierarchy.agencies[0] ? {
            agency: hierarchy.agencies[0].name,
            subAgencies: hierarchy.agencies[0].subAgencies.slice(0, 3).map(s => ({
              name: s.name,
              offices: s.offices.slice(0, 3).map(o => o.name)
            }))
          } : null
        };
        break;
      }

      case 'buying': {
        if (!naics) {
          return NextResponse.json({
            success: false,
            error: 'naics parameter required for buying mode'
          }, { status: 400 });
        }

        const summary = await getBuyingOfficesSummary(naics, agency || undefined, 10);
        result = {
          naics,
          agency,
          totalFound: summary.totalFound,
          offices: summary.offices
        };
        break;
      }

      case 'offices': {
        const officeResult = await searchOffices({
          agencyCode: agency || undefined,
          name: officeName || undefined,
          state: state || undefined,
          limit: 10
        });

        result = {
          params: { agency, officeName, state },
          totalCount: officeResult.totalCount,
          fromCache: officeResult.fromCache,
          offices: officeResult.offices.map(o => ({
            name: o.name,
            code: o.code,
            type: o.type,
            fpdsAgencyCode: o.fpdsAgencyCode,
            isActive: o.isActive
          }))
        };
        break;
      }

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown mode: ${actualMode}`
        }, { status: 400 });
    }

    const elapsed = Date.now() - startTime;
    const rateLimits = getRateLimitStatus();

    return NextResponse.json({
      success: true,
      mode: actualMode,
      params: { agency, naics, officeName, state },
      elapsedMs: elapsed,
      rateLimits,
      result
    });

  } catch (error) {
    console.error('[Test Hierarchy Error]', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      rateLimits: getRateLimitStatus()
    }, { status: 500 });
  }
}
