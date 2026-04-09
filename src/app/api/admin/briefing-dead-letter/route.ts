import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Admin endpoint to view and manage the briefing dead letter queue.
 *
 * GET /api/admin/briefing-dead-letter?password=xxx
 *   Returns dead letter queue entries with filtering options
 *
 * POST /api/admin/briefing-dead-letter
 *   { action: "retry", id: "xxx" } - Force retry a specific entry
 *   { action: "clear", status: "exhausted" } - Clear entries by status
 *   { action: "stats" } - Get summary statistics
 */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const status = request.nextUrl.searchParams.get('status');
  const briefingType = request.nextUrl.searchParams.get('type');
  const email = request.nextUrl.searchParams.get('email');
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100');

  try {
    let query = supabase
      .from('briefing_dead_letter')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }
    if (briefingType) {
      query = query.eq('briefing_type', briefingType);
    }
    if (email) {
      query = query.eq('user_email', email);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    // Get summary stats
    const { data: stats } = await supabase
      .from('briefing_dead_letter')
      .select('status, briefing_type')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const summary = {
      pending: stats?.filter(s => s.status === 'pending').length || 0,
      retrying: stats?.filter(s => s.status === 'retrying').length || 0,
      succeeded: stats?.filter(s => s.status === 'succeeded').length || 0,
      exhausted: stats?.filter(s => s.status === 'exhausted').length || 0,
      byType: {
        daily: stats?.filter(s => s.briefing_type === 'daily').length || 0,
        weekly: stats?.filter(s => s.briefing_type === 'weekly').length || 0,
        pursuit: stats?.filter(s => s.briefing_type === 'pursuit').length || 0,
      },
    };

    return NextResponse.json({
      success: true,
      summary,
      entries: data,
      count: data?.length || 0,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password, action, id, status: clearStatus } = body;

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    switch (action) {
      case 'retry': {
        if (!id) {
          return NextResponse.json({ error: 'id required' }, { status: 400 });
        }

        // Reset the entry for retry
        const { error } = await supabase
          .from('briefing_dead_letter')
          .update({
            status: 'pending',
            retry_count: 0,
            next_retry_at: new Date().toISOString(),
          })
          .eq('id', id);

        if (error) throw error;

        return NextResponse.json({
          success: true,
          message: `Entry ${id} queued for retry`,
        });
      }

      case 'clear': {
        if (!clearStatus) {
          return NextResponse.json({ error: 'status required' }, { status: 400 });
        }

        const { data: deleted, error } = await supabase
          .from('briefing_dead_letter')
          .delete()
          .eq('status', clearStatus)
          .select();

        if (error) throw error;

        return NextResponse.json({
          success: true,
          message: `Cleared ${deleted?.length || 0} entries with status ${clearStatus}`,
        });
      }

      case 'stats': {
        // Get detailed stats
        const { data: allEntries } = await supabase
          .from('briefing_dead_letter')
          .select('status, briefing_type, failure_reason, created_at')
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

        // Group by failure reason
        const failureReasons: Record<string, number> = {};
        allEntries?.forEach(e => {
          const reason = e.failure_reason?.slice(0, 50) || 'Unknown';
          failureReasons[reason] = (failureReasons[reason] || 0) + 1;
        });

        return NextResponse.json({
          success: true,
          stats: {
            total: allEntries?.length || 0,
            byStatus: {
              pending: allEntries?.filter(e => e.status === 'pending').length || 0,
              retrying: allEntries?.filter(e => e.status === 'retrying').length || 0,
              succeeded: allEntries?.filter(e => e.status === 'succeeded').length || 0,
              exhausted: allEntries?.filter(e => e.status === 'exhausted').length || 0,
            },
            byType: {
              daily: allEntries?.filter(e => e.briefing_type === 'daily').length || 0,
              weekly: allEntries?.filter(e => e.briefing_type === 'weekly').length || 0,
              pursuit: allEntries?.filter(e => e.briefing_type === 'pursuit').length || 0,
            },
            topFailureReasons: Object.entries(failureReasons)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([reason, count]) => ({ reason, count })),
          },
        });
      }

      default:
        return NextResponse.json({
          error: 'Invalid action. Use: retry, clear, stats',
        }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
