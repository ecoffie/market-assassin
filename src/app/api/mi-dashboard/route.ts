/**
 * MI Dashboard API
 *
 * GET /api/mi-dashboard
 *
 * Fetches SAM.gov opportunities from local cache for MI Dashboard
 * with filtering, search, and aggregation capabilities.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Lazy initialization to avoid build-time errors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// Notice type display names and colors (supports both code and text)
const NOTICE_TYPE_INFO: Record<string, { label: string; color: string; bgColor: string }> = {
  // Code-based
  'p': { label: 'Pre-Solicitation', color: '#f97316', bgColor: '#fff7ed' },
  'r': { label: 'Sources Sought', color: '#8b5cf6', bgColor: '#faf5ff' },
  'o': { label: 'Solicitation', color: '#22c55e', bgColor: '#f0fdf4' },
  'k': { label: 'Combined', color: '#0ea5e9', bgColor: '#f0f9ff' },
  's': { label: 'Special Notice', color: '#64748b', bgColor: '#f8fafc' },
  'i': { label: 'Intent to Bundle', color: '#ec4899', bgColor: '#fdf2f8' },
  'a': { label: 'Award Notice', color: '#10b981', bgColor: '#ecfdf5' },
  // Text-based (from SAM.gov)
  'Solicitation': { label: 'Solicitation', color: '#22c55e', bgColor: '#f0fdf4' },
  'Combined Synopsis/Solicitation': { label: 'Combined', color: '#0ea5e9', bgColor: '#f0f9ff' },
  'Presolicitation': { label: 'Pre-Solicitation', color: '#f97316', bgColor: '#fff7ed' },
  'Sources Sought': { label: 'Sources Sought', color: '#8b5cf6', bgColor: '#faf5ff' },
  'Special Notice': { label: 'Special Notice', color: '#64748b', bgColor: '#f8fafc' },
  'Intent to Bundle': { label: 'Intent to Bundle', color: '#ec4899', bgColor: '#fdf2f8' },
  'Award Notice': { label: 'Award Notice', color: '#10b981', bgColor: '#ecfdf5' },
  'Justification': { label: 'Justification', color: '#f59e0b', bgColor: '#fffbeb' },
};

interface RawOpportunity {
  id: string;
  notice_id: string;
  title: string;
  department: string | null;
  office: string | null;
  naics_code: string | null;
  notice_type: string | null;
  notice_type_code: string | null;
  set_aside_code: string | null;
  set_aside_description: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  pop_state: string | null;
  ui_link: string | null;
}

interface DashboardOpportunity {
  id: string;
  notice_id: string;
  title: string;
  department: string;
  office: string | null;
  naics_code: string | null;
  notice_type: string | null;
  notice_type_code: string | null;
  set_aside_code: string | null;
  set_aside_description: string | null;
  posted_date: string | null;
  response_deadline: string | null;
  pop_state: string | null;
  ui_link: string | null;
  days_until_deadline: number | null;
  urgency_level: 'critical' | 'urgent' | 'normal' | 'upcoming';
}

function getUrgencyLevel(deadline: string | null): 'critical' | 'urgent' | 'normal' | 'upcoming' {
  if (!deadline) return 'upcoming';
  const now = new Date();
  const deadlineDate = new Date(deadline);
  const daysUntil = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntil <= 3) return 'critical';
  if (daysUntil <= 7) return 'urgent';
  if (daysUntil <= 14) return 'normal';
  return 'upcoming';
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Filters
  const search = searchParams.get('search') || '';
  const noticeType = searchParams.get('noticeType') || '';
  const agency = searchParams.get('agency') || '';
  const urgency = searchParams.get('urgency') || '';
  const setAside = searchParams.get('setAside') || '';
  const naics = searchParams.get('naics') || '';
  const state = searchParams.get('state') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const mode = searchParams.get('mode') || 'list'; // list | stats | export

  try {
    const supabase = getSupabase();

    // Build base query
    let query = supabase
      .from('sam_opportunities')
      .select('*', { count: 'exact' })
      .eq('active', true)
      .gt('response_deadline', new Date().toISOString());

    // Apply filters
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,department.ilike.%${search}%`);
    }
    if (noticeType) {
      query = query.eq('notice_type', noticeType);
    }
    if (agency) {
      query = query.ilike('department', `%${agency}%`);
    }
    if (setAside) {
      query = query.eq('set_aside_code', setAside);
    }
    if (naics) {
      query = query.or(`naics_code.eq.${naics},naics_code.like.${naics.substring(0, 3)}%`);
    }
    if (state) {
      query = query.eq('pop_state', state.toUpperCase());
    }

    // Stats mode - return aggregations
    if (mode === 'stats') {
      const now = new Date().toISOString();
      const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const [
        { count: totalActiveCount },
        { data: byNoticeType },
        { data: byAgency },
        { data: bySetAside },
        { count: urgentTotalCount }
      ] = await Promise.all([
        // Use count only, don't fetch rows
        supabase
          .from('sam_opportunities')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .gt('response_deadline', now),
        // Fetch all notice types (need high limit for aggregation)
        supabase
          .from('sam_opportunities')
          .select('notice_type')
          .eq('active', true)
          .gt('response_deadline', now)
          .limit(50000),
        // Fetch all departments
        supabase
          .from('sam_opportunities')
          .select('department')
          .eq('active', true)
          .gt('response_deadline', now)
          .limit(50000),
        // Fetch all set-aside codes
        supabase
          .from('sam_opportunities')
          .select('set_aside_code')
          .eq('active', true)
          .gt('response_deadline', now)
          .limit(50000),
        // Count urgent (due in 7 days)
        supabase
          .from('sam_opportunities')
          .select('id', { count: 'exact', head: true })
          .eq('active', true)
          .lt('response_deadline', sevenDaysFromNow)
          .gt('response_deadline', now)
      ]);

      // Aggregate notice types
      const noticeTypeCounts: Record<string, number> = {};
      (byNoticeType || []).forEach((row: { notice_type: string | null }) => {
        const type = row.notice_type || 'unknown';
        noticeTypeCounts[type] = (noticeTypeCounts[type] || 0) + 1;
      });

      // Aggregate agencies (top 10)
      const agencyCounts: Record<string, number> = {};
      (byAgency || []).forEach((row: { department: string | null }) => {
        const dept = row.department || 'Unknown';
        agencyCounts[dept] = (agencyCounts[dept] || 0) + 1;
      });
      const topAgencies = Object.entries(agencyCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      // Aggregate set-asides
      const setAsideCounts: Record<string, number> = {};
      (bySetAside || []).forEach((row: { set_aside_code: string | null }) => {
        const code = row.set_aside_code || 'None';
        setAsideCounts[code] = (setAsideCounts[code] || 0) + 1;
      });

      return NextResponse.json({
        success: true,
        stats: {
          totalActive: totalActiveCount || 0,
          urgentCount: urgentTotalCount || 0,
          byNoticeType: Object.entries(noticeTypeCounts).map(([code, count]) => ({
            code,
            label: NOTICE_TYPE_INFO[code]?.label || code,
            count,
            color: NOTICE_TYPE_INFO[code]?.color || '#64748b',
          })),
          topAgencies: topAgencies.map(([dept, count]) => ({ department: dept, count })),
          bySetAside: Object.entries(setAsideCounts).map(([code, count]) => ({
            code,
            count,
          })),
        },
      });
    }

    // Apply urgency filter if specified
    if (urgency === 'critical') {
      const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      query = query.lt('response_deadline', threeDaysFromNow);
    } else if (urgency === 'urgent') {
      const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query.lt('response_deadline', sevenDaysFromNow);
    }

    // Order by deadline (soonest first)
    query = query.order('response_deadline', { ascending: true });

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data: opportunities, count, error } = await query;

    if (error) {
      throw error;
    }

    // Transform to dashboard format
    const dashboardOpps: DashboardOpportunity[] = ((opportunities || []) as RawOpportunity[]).map((opp: RawOpportunity) => {
      const deadline = opp.response_deadline;
      const daysUntil = deadline
        ? Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        id: opp.id,
        notice_id: opp.notice_id,
        title: opp.title,
        department: opp.department || 'Unknown Agency',
        office: opp.office,
        naics_code: opp.naics_code,
        notice_type: opp.notice_type,
        notice_type_code: opp.notice_type_code,
        set_aside_code: opp.set_aside_code,
        set_aside_description: opp.set_aside_description,
        posted_date: opp.posted_date,
        response_deadline: opp.response_deadline,
        pop_state: opp.pop_state,
        ui_link: opp.ui_link,
        days_until_deadline: daysUntil,
        urgency_level: getUrgencyLevel(deadline),
      };
    });

    return NextResponse.json({
      success: true,
      opportunities: dashboardOpps,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
      noticeTypeInfo: NOTICE_TYPE_INFO,
    });

  } catch (err) {
    console.error('[mi-dashboard] Error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
