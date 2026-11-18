import { NextRequest, NextResponse } from 'next/server';
import { getAllBudgetData } from '@/lib/utils/budget-authority';
import {
  listLiveAuthority,
  presentAgencyBudget,
  presentAuthorityBoard,
  type FileAuthority,
} from '@/lib/budget-intel/read';

function fileRows(): FileAuthority[] {
  return getAllBudgetData().map((row) => ({
    agency: row.agency,
    toptierCode: row.toptierCode,
    fy2025: row.fy2025?.budgetAuthority ?? null,
    fy2026: row.fy2026?.budgetAuthority ?? null,
    changeAmount: row.change?.amount ?? null,
    changeRatio: row.change?.percent ?? null,
    trend: row.change?.trend ?? null,
  }));
}

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
      const presented = await presentAgencyBudget(agencyName);
      if (!presented.grounded) {
        return NextResponse.json({
          success: false,
          shown: presented.shown,
          shown_reason: presented.shown_reason,
          error: `No budget data found for "${agencyName}"`,
        }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        shown: presented.shown,
        shown_reason: presented.shown_reason,
        source: presented.source,
        source_url: presented.source_url,
        fetched_at: presented.fetched_at,
        as_of: presented.as_of,
        data: presented,
      });
    }

    // Winners or losers
    const board = presentAuthorityBoard(await listLiveAuthority(), fileRows());
    if (type === 'winners' || type === 'losers') {
      const ranked = board.filter((row) => row.change_percent != null);
      const winners = ranked.filter((row) => (row.change_percent as number) > 1).sort((a, b) => (b.change_percent as number) - (a.change_percent as number)).slice(0, limit);
      const losers = ranked.filter((row) => (row.change_percent as number) < 1).sort((a, b) => (a.change_percent as number) - (b.change_percent as number)).slice(0, limit);
      const results = type === 'winners' ? winners : losers;
      return NextResponse.json({
        success: true,
        type,
        count: results.length,
        data: results,
        note: 'Each year is usaspending_live or static_file. Agencies not yet acquired stay on the fixed file.',
      });
    }

    return NextResponse.json({
      success: true,
      count: board.length,
      data: board.slice(0, limit),
      note: 'Each year is usaspending_live or static_file. Agencies not yet acquired stay on the fixed file.',
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to load budget data',
    }, { status: 500 });
  }
}
