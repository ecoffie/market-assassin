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
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const days = parseInt(searchParams.get('days') || '30');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString();

  try {
    // Get all counts in parallel
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
      supabase
        .from('user_notification_settings')
        .select('*', { count: 'exact', head: true }),

      // 2. Users with profile complete (have NAICS codes)
      supabase
        .from('user_notification_settings')
        .select('*', { count: 'exact', head: true })
        .not('naics_codes', 'is', null)
        .neq('naics_codes', '{}'),

      // 3. Users who received at least one email
      supabase
        .from('briefing_log')
        .select('user_email', { count: 'exact', head: false })
        .eq('delivery_status', 'sent'),

      // 4. Users who opened at least one email
      supabase
        .from('user_engagement')
        .select('user_email')
        .eq('event_type', 'email_open'),

      // 5. Active users (3+ engagements in period)
      supabase
        .from('user_engagement')
        .select('user_email')
        .gte('created_at', startDateStr),

      // Recent signups (last N days)
      supabase
        .from('user_notification_settings')
        .select('user_email, created_at, naics_codes')
        .gte('created_at', startDateStr)
        .order('created_at', { ascending: false }),

      // Dropoff analysis - users with no NAICS after signup
      supabase
        .from('user_notification_settings')
        .select('user_email, created_at')
        .or('naics_codes.is.null,naics_codes.eq.{}')
        .gte('created_at', startDateStr),
    ]);

    // Calculate unique counts
    const totalUsers = totalUsersResult.count || 0;
    const profileComplete = profileCompleteResult.count || 0;

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
