import { NextRequest, NextResponse } from 'next/server';
import {
  getAllBudgetData,
  getWinnersAndLosers,
} from '@/lib/utils/budget-authority';
import { listLiveAuthority, presentAgencyBudget } from '@/lib/budget-intel/read';

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
          error: presented.shown_reason === 'agency_not_in_live_table'
            ? `No live budget row for "${agencyName}". The fixed file is not used once agency_budget_authority has rows.`
            : `No budget data found for "${agencyName}"`,
        }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        shown: presented.shown,
        shown_reason: presented.shown_reason,
        source: presented.source,
        source_url: presented.source_url,
        fetched_at: presented.fetched_at,
        data: presented,
      });
    }

    // Winners or losers
    if (type === 'winners' || type === 'losers') {
      const live = await listLiveAuthority();
      if (live.table === 'ready') {
        const ranked = live.rows.filter((row) => row.change_percent != null);
        const winners = ranked.filter((row) => (row.change_percent ?? 0) > 1).sort((a, b) => (b.change_percent ?? 0) - (a.change_percent ?? 0)).slice(0, limit);
        const losers = ranked.filter((row) => (row.change_percent ?? 0) < 1).sort((a, b) => (a.change_percent ?? 0) - (b.change_percent ?? 0)).slice(0, limit);
        const results = type === 'winners' ? winners : losers;
        return NextResponse.json({
          success: true,
          shown: 'live_table',
          shown_reason: 'live_table',
          type,
          count: results.length,
          data: results,
          note: 'USASpending budgetary resources in agency_budget_authority. change_percent is a ratio.',
        });
      }
      const { winners, losers } = getWinnersAndLosers(limit);
      const results = type === 'winners' ? winners : losers;
      return NextResponse.json({
        success: true,
        shown: 'static_file',
        shown_reason: live.table === 'empty' ? 'live_table_empty' : 'live_table_unmeasured',
        type,
        count: results.length,
        data: results,
        note: live.table === 'empty'
          ? 'Fixed OMB file. agency_budget_authority has no rows.'
          : 'Fixed OMB file. agency_budget_authority could not be read, so this is not a measured empty table.',
      });
    }

    // All agencies
    const live = await listLiveAuthority();
    if (live.table === 'ready') {
      return NextResponse.json({
        success: true,
        shown: 'live_table',
        shown_reason: 'live_table',
        count: live.rows.length,
        data: live.rows.slice(0, limit),
      });
    }
    const allData = getAllBudgetData();
    return NextResponse.json({
      success: true,
      shown: 'static_file',
      shown_reason: live.table === 'empty' ? 'live_table_empty' : 'live_table_unmeasured',
      count: allData.length,
      data: allData.slice(0, limit),
      note: live.table === 'empty'
        ? 'Fixed OMB file. agency_budget_authority has no rows.'
        : 'Fixed OMB file. agency_budget_authority could not be read, so this is not a measured empty table.',
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to load budget data',
    }, { status: 500 });
  }
}
