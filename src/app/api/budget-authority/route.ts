import { NextRequest, NextResponse } from 'next/server';
import {
  getBudgetForAgency,
  getAllBudgetData,
  getWinnersAndLosers,
} from '@/lib/utils/budget-authority';

/**
 * GET /api/budget-authority
 *
 * Returns cached FY2025 vs FY2026 budget authority data.
 *
 * Query params:
 * - agency: Single agency lookup (e.g., ?agency=Department of Defense)
 * - type: 'winners' or 'losers' for sorted lists
 * - limit: Max results (default: 10)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agencyName = searchParams.get('agency');
  const type = searchParams.get('type');
  const limit = parseInt(searchParams.get('limit') || '10') || 10;

  try {
    // Single agency lookup
    if (agencyName) {
      const data = getBudgetForAgency(agencyName);
      if (!data) {
        return NextResponse.json({
          success: false,
          error: `No budget data found for "${agencyName}"`,
        }, { status: 404 });
      }
      return NextResponse.json({ success: true, data });
    }

    // Winners or losers
    if (type === 'winners' || type === 'losers') {
      const { winners, losers } = getWinnersAndLosers(limit);
      const results = type === 'winners' ? winners : losers;
      return NextResponse.json({
        success: true,
        type,
        count: results.length,
        data: results,
      });
    }

    // All agencies
    const allData = getAllBudgetData();
    return NextResponse.json({
      success: true,
      count: allData.length,
      data: allData.slice(0, limit),
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to load budget data',
    }, { status: 500 });
  }
}
