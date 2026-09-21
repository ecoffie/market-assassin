/**
 * Admin: Onboarding Funnel Analytics API
 *
 * Tracks user progression through the onboarding flow:
 * 1. Signed Up (in user_notification_settings)
 * 2. Profile Complete (has NAICS codes set)
 * 3. First Email Sent (has entries in briefing_log)
 * 4. First Email Opened (has email_open in user_engagement)
 * 5. Active User (multiple engagements in last 30 days)
 *
 * GET ?password=... - Get funnel metrics
 * GET ?password=...&days=30 - Get funnel for specific time period
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadClient, getCountClient } from '@/lib/supabase/server-clients';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const days = parseInt(searchParams.get('days') || '30');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Pure read-only analytics (GET, no writes) → read replica to keep off the primary.
  const supabase = getReadClient();
  // Head-counts → PRIMARY: the replica 400s every HEAD request (see getCountClient).
  const counts = getCountClient();

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString();

  try {
    // Get all counts in parallel
    // PAGINATED. MEASURED 2026-08-22 — every stage below the first read 1,000 rows of a far
    // larger set, so every funnel stage after signup was understated:
    //     briefing_log sent        56,499
    //     email_open events        43,079
    //     engagement last 30d      73,928
    // Each feeds a DISTINCT-USER Set, so truncation does not just shrink a total — it
    // silently drops users from the middle of the funnel and makes drop-off look worse than
    // it is. Head-counts (stages 1-2) were always exact; only the list reads were wrong.
    const PAGE = 1000;
    async function readAllRows<T>(
      build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
    ): Promise<{ data: T[]; error: unknown }> {
      const out: T[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await build(from, from + PAGE - 1);
        if (error) return { data: out, error };
        if (!data?.length) break;
        out.push(...data);
        if (data.length < PAGE) break;
      }
      return { data: out, error: null };
    }

    const [
      totalUsersResult,
      profileCompleteResult,
      emailsSentResult,
      emailsOpenedResult,
      activeUsersResult,
      recentSignupsResult,
      dropoffAnalysisResult,
    ] = await Promise.all([
      // 1. Total users signed up (all time)
      counts
        .from('user_notification_settings')
        .select('*', { count: 'exact', head: true }),

      // 2. Users with profile complete (have NAICS codes)
      counts
        .from('user_notification_settings')
        .select('*', { count: 'exact', head: true })
        .not('naics_codes', 'is', null)
        .neq('naics_codes', '{}'),

      // 3. Users who received at least one email
      readAllRows<{ user_email: string }>((from, to) => supabase
        .from('briefing_log')
        .select('user_email')
        .eq('delivery_status', 'sent')
        .range(from, to)),

      // 4. Users who opened at least one email
      readAllRows<{ user_email: string }>((from, to) => supabase
        .from('user_engagement')
        .select('user_email')
        .eq('event_type', 'email_open')
        .range(from, to)),

      // 5. Active users (3+ engagements in period)
      readAllRows<{ user_email: string }>((from, to) => supabase
        .from('user_engagement')
        .select('user_email')
        .gte('created_at', startDateStr)
        .range(from, to)),

      // Recent signups (last N days) — DISPLAY ONLY, .slice(0, 20) below.
      // truncation-ok: rendered as a 20-row list, never counted; no population metric derives from it
      supabase
        .from('user_notification_settings')
        .select('user_email, created_at, naics_codes')
        .gte('created_at', startDateStr)
        .order('created_at', { ascending: false }),

      // Dropoff analysis — DISPLAY ONLY, .slice(0, 50) below. The COUNT of this
      // population is stage 2 (profileComplete), which is an exact head-count.
      // truncation-ok: rendered as a 50-row list, never counted
      supabase
        .from('user_notification_settings')
        .select('user_email, created_at')
        .or('naics_codes.is.null,naics_codes.eq.{}')
        .gte('created_at', startDateStr),
    ]);

    // Calculate unique counts.
    // ⚠️ These two ARE the funnel's denominator — every downstream percentage divides by
    // totalUsers. A null count means UNKNOWN, not zero (a missing table returns
    // count=null, error=null, HTTP 204 — no error at all), and coalescing it to 0 would
    // render the whole funnel as 0% while looking like a real measurement.
    // Bug Prevention Rule #11 + the measurement-integrity HONEST check.
    if (totalUsersResult.error || profileCompleteResult.error) {
      const stageErr = totalUsersResult.error || profileCompleteResult.error;
      return NextResponse.json(
        { success: false, error: `Funnel stage counts unavailable: ${stageErr?.message}` },
        { status: 500 },
      );
    }
    if (totalUsersResult.count === null || profileCompleteResult.count === null) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Funnel stage counts returned null (table missing or unreadable) — refusing to ' +
            'report 0, which would read as a real measurement.',
        },
        { status: 500 },
      );
    }
    const totalUsers = totalUsersResult.count;
    const profileComplete = profileCompleteResult.count;

    // Unique users who received emails
    const emailsSentUsers = new Set(
      (emailsSentResult.data || []).map((r: { user_email: string }) => r.user_email?.toLowerCase())
    );
    const usersWithEmailsSent = emailsSentUsers.size;

    // Unique users who opened emails
    const emailsOpenedUsers = new Set(
      (emailsOpenedResult.data || []).map((r: { user_email: string }) => r.user_email?.toLowerCase())
    );
    const usersWhoOpened = emailsOpenedUsers.size;

    // Active users (3+ engagements)
    const engagementCounts: Record<string, number> = {};
    for (const row of activeUsersResult.data || []) {
      const email = row.user_email?.toLowerCase();
      if (email) {
        engagementCounts[email] = (engagementCounts[email] || 0) + 1;
      }
    }
    const activeUsers = Object.values(engagementCounts).filter(c => c >= 3).length;

    // Calculate conversion rates
    const signupToProfile = totalUsers > 0 ? ((profileComplete / totalUsers) * 100).toFixed(1) : '0';
    const profileToEmail = profileComplete > 0 ? ((usersWithEmailsSent / profileComplete) * 100).toFixed(1) : '0';
    const emailToOpen = usersWithEmailsSent > 0 ? ((usersWhoOpened / usersWithEmailsSent) * 100).toFixed(1) : '0';
    const openToActive = usersWhoOpened > 0 ? ((activeUsers / usersWhoOpened) * 100).toFixed(1) : '0';
    const overallConversion = totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : '0';

    // Recent signups with profile status
    const recentSignups = (recentSignupsResult.data || []).slice(0, 20).map((u: {
      user_email: string;
      created_at: string;
      naics_codes: string[] | null;
    }) => ({
      email: u.user_email,
      signedUp: u.created_at,
      hasProfile: u.naics_codes && u.naics_codes.length > 0,
      naicsCount: u.naics_codes?.length || 0,
    }));

    // Dropoff users (signed up but no profile)
    const dropoffUsers = (dropoffAnalysisResult.data || []).slice(0, 50).map((u: {
      user_email: string;
      created_at: string;
    }) => ({
      email: u.user_email,
      signedUp: u.created_at,
      daysSinceSignup: Math.floor((Date.now() - new Date(u.created_at).getTime()) / (1000 * 60 * 60 * 24)),
    }));

    return NextResponse.json({
      period: {
        days,
        startDate: startDateStr,
        endDate: new Date().toISOString(),
      },
      funnel: [
        {
          stage: 'Signed Up',
          count: totalUsers,
          percent: '100%',
          description: 'Users who created an account',
        },
        {
          stage: 'Profile Complete',
          count: profileComplete,
          percent: `${signupToProfile}%`,
          dropoff: totalUsers - profileComplete,
          description: 'Users who set up NAICS codes',
        },
        {
          stage: 'First Email Sent',
          count: usersWithEmailsSent,
          percent: `${profileToEmail}%`,
          dropoff: profileComplete - usersWithEmailsSent,
          description: 'Users who received at least one briefing',
        },
        {
          stage: 'First Email Opened',
          count: usersWhoOpened,
          percent: `${emailToOpen}%`,
          dropoff: usersWithEmailsSent - usersWhoOpened,
          description: 'Users who opened an email',
        },
        {
          stage: 'Active User',
          count: activeUsers,
          percent: `${openToActive}%`,
          dropoff: usersWhoOpened - activeUsers,
          description: 'Users with 3+ engagements in period',
        },
      ],
      summary: {
        totalUsers,
        activeUsers,
        overallConversion: `${overallConversion}%`,
        biggestDropoff: getBiggestDropoff(
          totalUsers,
          profileComplete,
          usersWithEmailsSent,
          usersWhoOpened,
          activeUsers
        ),
      },
      recentSignups,
      dropoffUsers,
    });

  } catch (error) {
    console.error('[OnboardingFunnel] Error:', error);
    return NextResponse.json({
      error: String(error),
    }, { status: 500 });
  }
}

/**
 * Find the stage with the biggest dropoff
 */
function getBiggestDropoff(
  total: number,
  profile: number,
  email: number,
  opened: number,
  active: number
): { stage: string; lost: number; suggestion: string } {
  const dropoffs = [
    {
      stage: 'Signup → Profile',
      lost: total - profile,
      suggestion: 'Send reminder emails to complete profile setup',
    },
    {
      stage: 'Profile → Email',
      lost: profile - email,
      suggestion: 'Check if briefing crons are running properly',
    },
    {
      stage: 'Email → Open',
      lost: email - opened,
      suggestion: 'Improve email subject lines and preview text',
    },
    {
      stage: 'Open → Active',
      lost: opened - active,
      suggestion: 'Add more compelling CTAs and valuable content',
    },
  ];

  return dropoffs.reduce((max, curr) => curr.lost > max.lost ? curr : max, dropoffs[0]);
}
