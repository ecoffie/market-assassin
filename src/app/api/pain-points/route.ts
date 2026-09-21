import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import {
  getPainPointsForAgency,
  getPrioritiesForAgency,
  getPainPointsForCommand,
  getAllAgenciesWithPainPoints,
  findAgenciesByPainPoint,
  getSimilarAgencies,
  getNDAAPainPoints,
  categorizePainPoints
} from '@/lib/utils/pain-points';
import {
  getAgencySourcedIntelligence,
  formatPainPointForDisplay,
  toCitation,
} from '@/lib/strategic-intel/sourced-pain-points';

function requirePainPointsAccess(request: NextRequest) {
  const authSession = requireMIAuthSession(request);
  if (!authSession.ok) return authSession.response;
  return null;
}

export async function GET(request: NextRequest) {
  const authError = requirePainPointsAccess(request);
  if (authError) return authError;

  const searchParams = request.nextUrl.searchParams;
  const agency = searchParams.get('agency');
  const command = searchParams.get('command');
  const subAgency = searchParams.get('subAgency');
  const parentAgency = searchParams.get('parentAgency');
  const keyword = searchParams.get('keyword');
  const action = searchParams.get('action');

  try {
    // Get pain points for specific agency (with optional command-level override)
    if (agency && !action) {
      // Living sourced GAO first via shared reader; command-level still uses legacy
      // utils for office-specific overlays (USACE etc.) then merges distinguishably.
      const bundle = await getAgencySourcedIntelligence(command || subAgency || agency);
      let painPoints = bundle.painPoints.map(formatPainPointForDisplay);
      let painPointSource: string = bundle.meta.sourcedCount > 0
        ? 'institute_gao+legacy'
        : 'legacy_manual';
      let priorities = bundle.priorities.map(formatPainPointForDisplay);

      if (command || subAgency) {
        const result = getPainPointsForCommand(
          agency,
          subAgency || '',
          parentAgency || '',
          command
        );
        // Command overlay is legacy — label and append only novel claims.
        const overlay = result.painPoints
          .filter((p) => !painPoints.some((x) => x.includes(p.slice(0, 40))))
          .map((p) => `${p} [LEGACY_MANUAL — provenance unavailable]`);
        painPoints = [...painPoints, ...overlay];
        painPointSource = `${painPointSource}|command:${result.source}`;
      } else if (painPoints.length === 0) {
        painPoints = getPainPointsForAgency(agency)
          .map((p) => `${p} [LEGACY_MANUAL — provenance unavailable]`);
        priorities = getPrioritiesForAgency(agency)
          .map((p) => `${p} [LEGACY_MANUAL — provenance unavailable]`);
        painPointSource = 'legacy_manual';
      }

      const categorized = categorizePainPoints(painPoints);
      const ndaaPainPoints = painPoints.filter(pp => pp.includes('FY2026 NDAA'));

      return NextResponse.json({
        success: true,
        agency,
        command: command || null,
        painPointSource,
        painPoints,
        priorities,
        categorized,
        ndaaPainPoints,
        citations: bundle.painPoints.map(toCitation),
        hasSourcedIntelligence: bundle.meta.sourcedCount > 0,
        sourcedCount: bundle.meta.sourcedCount,
        legacyCount: bundle.meta.legacyCount,
        count: painPoints.length,
        priorityCount: priorities.length
      });
    }

    // Get similar agencies
    if (agency && action === 'similar') {
      const similar = getSimilarAgencies(agency, 10);
      return NextResponse.json({
        success: true,
        agency,
        similarAgencies: similar
      });
    }

    // Search by keyword
    if (keyword) {
      const results = findAgenciesByPainPoint(keyword);
      return NextResponse.json({
        success: true,
        keyword,
        results,
        count: results.length
      });
    }

    // Get all agencies
    if (action === 'all') {
      const all = getAllAgenciesWithPainPoints();
      return NextResponse.json({
        success: true,
        agencies: all,
        count: all.length
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Missing required parameters. Use ?agency=NAME or ?keyword=TERM or ?action=all'
    }, { status: 400 });

  } catch (error) {
    console.error('Error accessing pain points:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to access pain points database'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = requirePainPointsAccess(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { agencies } = body;

    if (!agencies || !Array.isArray(agencies)) {
      return NextResponse.json({
        success: false,
        error: 'agencies array is required'
      }, { status: 400 });
    }

    // Get pain points and priorities for multiple agencies
    const results = agencies.map(agencyName => {
      const painPoints = getPainPointsForAgency(agencyName);
      const priorities = getPrioritiesForAgency(agencyName);
      return {
        agency: agencyName,
        painPoints,
        priorities,
        categorized: categorizePainPoints(painPoints),
        ndaaPainPoints: getNDAAPainPoints(agencyName)
      };
    });

    return NextResponse.json({
      success: true,
      results,
      totalAgencies: results.length,
      totalPainPoints: results.reduce((sum, r) => sum + r.painPoints.length, 0),
      totalPriorities: results.reduce((sum, r) => sum + r.priorities.length, 0)
    });

  } catch (error) {
    console.error('Error processing pain points request:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process request'
    }, { status: 500 });
  }
}
