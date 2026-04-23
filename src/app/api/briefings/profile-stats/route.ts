/**
 * Briefings Profile Stats API
 *
 * Returns stats about how many opportunities matched the user's profile:
 * - Opportunities matching NAICS codes today
 * - Total opportunities this week
 * - Comparison to previous period (trending)
 * - Breakdown by type (solicitations, forecasts, grants)
 *
 * GET ?email=user@example.com - Get profile match stats
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// State code to full name mapping for forecasts filtering
// Forecasts use full state names, user profiles use codes
const STATE_CODE_TO_NAME: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
  'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
  'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
  'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
  'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
  'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
  'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
  'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island',
  'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
  'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
  'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
  'PR': 'Puerto Rico', 'VI': 'Virgin Islands', 'GU': 'Guam',
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email')?.toLowerCase().trim();

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Get user's profile settings (case-insensitive email match)
    const { data: profile, error: profileError } = await supabase
      .from('user_notification_settings')
      .select('naics_codes, keywords, agencies, location_states')
      .ilike('user_email', email)
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json({
        success: true,
        hasProfile: false,
        message: 'No profile found - set up your NAICS codes to see match stats',
        stats: null,
      });
    }

    const naicsCodes = profile.naics_codes || [];
    const keywords = profile.keywords || [];
    const locationStates = profile.location_states || [];

    // Convert state codes to full names for forecasts filtering
    const stateNames = locationStates
      .map((code: string) => STATE_CODE_TO_NAME[code.toUpperCase()])
      .filter(Boolean);

    if (naicsCodes.length === 0) {
      return NextResponse.json({
        success: true,
        hasProfile: false,
        message: 'Add NAICS codes to your profile to see opportunity matches',
        stats: null,
      });
    }

    // Date ranges
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];

    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0];

    // Separate short codes (3-4 digit prefixes) from full codes (5-6 digit)
    // Short codes need LIKE prefix matching, full codes use exact matching
    const allCodes = Array.from(new Set((naicsCodes as string[]).map(code => String(code).trim())));
    const prefixCodes = allCodes.filter(code => code.length <= 4);
    const fullCodes = allCodes.filter(code => code.length >= 5);

    // Build OR filter for NAICS matching
    // Combines: exact matches for full codes + prefix matches for short codes
    const buildNaicsFilter = () => {
      const conditions: string[] = [];

      // Full codes use exact match
      if (fullCodes.length > 0) {
        conditions.push(`naics_code.in.(${fullCodes.join(',')})`);
      }

      // Prefix codes use LIKE pattern matching
      for (const prefix of prefixCodes) {
        conditions.push(`naics_code.like.${prefix}%`);
      }

      return conditions.join(',');
    };

    const naicsFilter = buildNaicsFilter();
    const hasNaicsFilter = naicsFilter.length > 0;

    // Query SAM opportunities matching user's NAICS codes AND states (this week)
    // Logic: (NAICS match) AND (state match if specified)
    let samThisWeekCount = 0;
    if (hasNaicsFilter) {
      let query = supabase
        .from('sam_opportunities')
        .select('id', { count: 'exact', head: true })
        .or(naicsFilter)
        .gte('posted_date', weekAgoStr)
        .eq('active', true);
      // State filter uses .in() for AND logic (not .or() which would be NAICS OR state)
      if (locationStates.length > 0) {
        query = query.in('pop_state', locationStates);
      }
      const { count } = await query;
      samThisWeekCount = count || 0;
    }

    // Last week (for comparison)
    let samLastWeekCount = 0;
    if (hasNaicsFilter) {
      let query = supabase
        .from('sam_opportunities')
        .select('id', { count: 'exact', head: true })
        .or(naicsFilter)
        .gte('posted_date', twoWeeksAgoStr)
        .lt('posted_date', weekAgoStr)
        .eq('active', true);
      if (locationStates.length > 0) {
        query = query.in('pop_state', locationStates);
      }
      const { count } = await query;
      samLastWeekCount = count || 0;
    }

    // Today
    let samTodayCount = 0;
    if (hasNaicsFilter) {
      let query = supabase
        .from('sam_opportunities')
        .select('id', { count: 'exact', head: true })
        .or(naicsFilter)
        .gte('posted_date', todayStr)
        .eq('active', true);
      if (locationStates.length > 0) {
        query = query.in('pop_state', locationStates);
      }
      const { count } = await query;
      samTodayCount = count || 0;
    }

    // Query forecasts matching user's NAICS codes AND states
    // Forecasts use full state names (NEW YORK, MASSACHUSETTS) in all caps
    // Logic: (NAICS match) AND (state match if specified)
    let forecastCount = 0;
    if (hasNaicsFilter) {
      // Build the query with NAICS filter first
      let query = supabase
        .from('agency_forecasts')
        .select('id', { count: 'exact', head: true })
        .or(naicsFilter);

      // Add state filter as IN clause (AND logic) if states specified
      // Convert state names to uppercase since forecasts store as "NEW YORK" not "New York"
      if (stateNames.length > 0) {
        const upperStateNames = stateNames.map((s: string) => s.toUpperCase());
        query = query.in('pop_state', upperStateNames);
      }

      const { count } = await query;
      forecastCount = count || 0;
    }

    // Calculate trend
    const thisWeek = samThisWeekCount;
    const lastWeek = samLastWeekCount;
    const weeklyChange = lastWeek > 0
      ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
      : (thisWeek > 0 ? 100 : 0);

    const trend: 'up' | 'down' | 'neutral' = weeklyChange > 5 ? 'up' : weeklyChange < -5 ? 'down' : 'neutral';

    // Get total active opportunities matching profile (with future deadlines)
    // Logic: (NAICS match) AND (state match if specified)
    let totalActiveMatching = 0;
    if (hasNaicsFilter) {
      let query = supabase
        .from('sam_opportunities')
        .select('id', { count: 'exact', head: true })
        .or(naicsFilter)
        .eq('active', true)
        .gt('response_deadline', today.toISOString());
      // State filter uses .in() for AND logic
      if (locationStates.length > 0) {
        query = query.in('pop_state', locationStates);
      }
      const { count } = await query;
      totalActiveMatching = count || 0;
    }

    // Get recent briefings count
    const { count: briefingsThisWeek } = await supabase
      .from('briefing_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_email', email)
      .gte('briefing_date', weekAgoStr);

    return NextResponse.json({
      success: true,
      hasProfile: true,
      profileSummary: {
        naicsCount: naicsCodes.length,
        keywordsCount: keywords.length,
        // Tell UI how matching works (for display purposes)
        matchingMode: prefixCodes.length > 0 ? 'prefix' : 'exact',
      },
      stats: {
        // Main headline stat
        totalActiveMatching,
        // Today's matches
        matchesToday: samTodayCount,
        // This week
        matchesThisWeek: thisWeek,
        // Trend comparison
        weeklyChange,
        trend,
        // Forecasts (future opportunities)
        forecastsMatching: forecastCount,
        // Briefings received
        briefingsThisWeek: briefingsThisWeek || 0,
      },
      message: samTodayCount > 0
        ? `${samTodayCount} new opportunities matched your profile today`
        : totalActiveMatching > 0
          ? `${totalActiveMatching} active opportunities match your profile`
          : 'No new matches today - check back soon',
    });

  } catch (error) {
    console.error('[ProfileStats] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
