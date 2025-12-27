import { NextRequest, NextResponse } from 'next/server';
import {
  getPainPointsForAgency,
  getPainPointsForCommand,
  getAllAgenciesWithPainPoints,
  findAgenciesByPainPoint,
  getSimilarAgencies,
  getNDAAPainPoints,
  categorizePainPoints
} from '@/lib/utils/pain-points';

export async function GET(request: NextRequest) {
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
      // If command data is provided, use enhanced command-level lookup
      let painPoints: string[];
      let painPointSource: string = agency;

      if (command || subAgency) {
        const result = getPainPointsForCommand(
          agency,
          subAgency || '',
          parentAgency || '',
          command
        );
        painPoints = result.painPoints;
        painPointSource = result.source;
      } else {
        // Fallback to simple agency lookup
        painPoints = getPainPointsForAgency(agency);
      }

      const categorized = categorizePainPoints(painPoints);
      const ndaaPainPoints = painPoints.filter(pp => pp.includes('FY2026 NDAA'));

      return NextResponse.json({
        success: true,
        agency,
        command: command || null,
        painPointSource,
        painPoints,
        categorized,
        ndaaPainPoints,
        count: painPoints.length
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
  try {
    const body = await request.json();
    const { agencies } = body;

    if (!agencies || !Array.isArray(agencies)) {
      return NextResponse.json({
        success: false,
        error: 'agencies array is required'
      }, { status: 400 });
    }

    // Get pain points for multiple agencies
    const results = agencies.map(agencyName => ({
      agency: agencyName,
      painPoints: getPainPointsForAgency(agencyName),
      categorized: categorizePainPoints(getPainPointsForAgency(agencyName)),
      ndaaPainPoints: getNDAAPainPoints(agencyName)
    }));

    return NextResponse.json({
      success: true,
      results,
      totalAgencies: results.length,
      totalPainPoints: results.reduce((sum, r) => sum + r.painPoints.length, 0)
    });

  } catch (error) {
    console.error('Error processing pain points request:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process request'
    }, { status: 500 });
  }
}
