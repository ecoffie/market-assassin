/**
 * Admin: Test SAM.gov Cache
 *
 * GET /api/admin/test-sam-cache?password=...&naics=541512
 *
 * Tests querying opportunities from the local Supabase cache
 * instead of hitting the SAM.gov API.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchSamOpportunitiesFromCache } from '@/lib/briefings/pipelines/sam-gov';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const naics = searchParams.get('naics') || '541512';
  const naicsCodes = naics.split(',').map(n => n.trim());
  const limit = parseInt(searchParams.get('limit') || '50');

  try {
    console.log(`[test-sam-cache] Testing cache for NAICS: ${naicsCodes.join(', ')}`);

    const startTime = Date.now();
    const result = await fetchSamOpportunitiesFromCache({
      naicsCodes,
      limit,
    });
    const duration = Date.now() - startTime;

    // Get sample opportunities
    const samples = result.opportunities.slice(0, 5).map(opp => ({
      noticeId: opp.noticeId,
      title: opp.title.substring(0, 80),
      naicsCode: opp.naicsCode,
      setAside: opp.setAside,
      responseDeadline: opp.responseDeadline,
      department: opp.department,
    }));

    return NextResponse.json({
      success: true,
      source: 'supabase_cache',
      queryTimeMs: duration,
      params: {
        naicsCodes,
        limit,
      },
      stats: {
        totalRecords: result.totalRecords,
        returned: result.opportunities.length,
        fetchedAt: result.fetchedAt,
      },
      samples,
      message: `Found ${result.totalRecords} opportunities in ${duration}ms (vs ~5-30s for API calls)`,
    });
  } catch (error) {
    console.error('[test-sam-cache] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
