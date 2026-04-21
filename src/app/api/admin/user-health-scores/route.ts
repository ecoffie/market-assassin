/**
 * Admin: User Health Scores API
 *
 * Computes and stores health scores for all users based on:
 * - Profile completeness (NAICS, keywords, agencies, etc.)
 * - Engagement metrics (email opens, clicks, page views)
 * - Activity recency (days since last activity)
 *
 * GET ?password=... - Get health scores summary
 * GET ?password=...&email=xxx - Get specific user's health score
 * POST ?password=... - Recompute all health scores
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

interface UserHealthScore {
  user_email: string;
  engagement_score: number;
  profile_score: number;
  recency_score: number;
  overall_score: number;
  churn_risk: 'low' | 'medium' | 'high' | 'critical';
  factors: {
    hasNaics: boolean;
    hasKeywords: boolean;
    hasAgencies: boolean;
    emailsOpened30d: number;
    linksClicked30d: number;
    daysSinceActivity: number | null;
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // If specific user requested
    if (email) {
      const score = await computeUserHealthScore(supabase, email.toLowerCase());
      return NextResponse.json({ score });
    }

    // Get all stored scores
    const { data: scores, error } = await supabase
      .from('user_engagement_scores')
      .select('*')
      .order('engagement_score', { ascending: false })
      .limit(100);

    if (error) {
      // Table might not exist - compute live for top users
      const liveScores = await computeTopUserScores(supabase, 50);
      return NextResponse.json({
        scores: liveScores,
        computed: 'live',
        message: 'Scores computed on-the-fly (table may not exist)',
      });
    }

    // Get summary stats
    const churnCounts = {
      low: scores.filter(s => s.churn_risk === 'low').length,
      medium: scores.filter(s => s.churn_risk === 'medium').length,
      high: scores.filter(s => s.churn_risk === 'high').length,
      critical: scores.filter(s => s.churn_risk === 'critical').length,
    };

    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((sum, s) => sum + s.engagement_score, 0) / scores.length)
      : 0;

    return NextResponse.json({
      summary: {
        totalScored: scores.length,
        averageScore: avgScore,
        churnDistribution: churnCounts,
        lastComputed: scores[0]?.computed_at || null,
      },
      topScores: scores.slice(0, 20),
      atRisk: scores.filter(s => s.churn_risk === 'high' || s.churn_risk === 'critical').slice(0, 30),
    });

  } catch (error) {
    console.error('[UserHealthScores] Error:', error);
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({
      error: errorMessage,
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const limit = parseInt(searchParams.get('limit') || '500');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    // Get all users
    const { data: users, error: usersError } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, agencies, created_at')
      .limit(limit);

    if (usersError) {
      return NextResponse.json({ error: usersError.message || JSON.stringify(usersError) }, { status: 500 });
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get engagement data for all users
    const { data: engagements } = await supabase
      .from('user_engagement')
      .select('user_email, event_type, created_at')
      .gte('created_at', thirtyDaysAgo.toISOString());

    // Build engagement map
    const engagementMap: Record<string, { opens: number; clicks: number; lastActivity: Date | null }> = {};
    for (const e of engagements || []) {
      const email = e.user_email?.toLowerCase();
      if (!email) continue;

      if (!engagementMap[email]) {
        engagementMap[email] = { opens: 0, clicks: 0, lastActivity: null };
      }

      const eventDate = new Date(e.created_at);
      if (!engagementMap[email].lastActivity || eventDate > engagementMap[email].lastActivity) {
        engagementMap[email].lastActivity = eventDate;
      }

      if (e.event_type === 'email_open') {
        engagementMap[email].opens++;
      } else if (e.event_type === 'link_click') {
        engagementMap[email].clicks++;
      }
    }

    // Compute scores for each user
    const scores: UserHealthScore[] = [];

    for (const user of users || []) {
      const email = user.user_email?.toLowerCase();
      if (!email) continue;

      const engagement = engagementMap[email] || { opens: 0, clicks: 0, lastActivity: null };

      // Profile completeness score (0-100)
      const hasNaics = user.naics_codes && user.naics_codes.length > 0;
      const hasKeywords = user.keywords && user.keywords.length > 0;
      const hasAgencies = user.agencies && user.agencies.length > 0;

      let profileScore = 40; // Base score for having account
      if (hasNaics) profileScore += 30;
      if (hasKeywords) profileScore += 15;
      if (hasAgencies) profileScore += 15;

      // Engagement score (0-100)
      let engagementScore = 0;
      engagementScore += Math.min(engagement.opens * 5, 40); // Max 40 points for opens
      engagementScore += Math.min(engagement.clicks * 10, 40); // Max 40 points for clicks
      if (engagement.opens > 0) engagementScore += 10; // Bonus for any opens
      if (engagement.clicks > 0) engagementScore += 10; // Bonus for any clicks

      // Recency score (0-100)
      let recencyScore = 100;
      let daysSinceActivity: number | null = null;

      if (engagement.lastActivity) {
        daysSinceActivity = Math.floor((Date.now() - engagement.lastActivity.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceActivity <= 1) recencyScore = 100;
        else if (daysSinceActivity <= 3) recencyScore = 90;
        else if (daysSinceActivity <= 7) recencyScore = 70;
        else if (daysSinceActivity <= 14) recencyScore = 50;
        else if (daysSinceActivity <= 30) recencyScore = 30;
        else recencyScore = 10;
      } else {
        // No activity = low recency score
        recencyScore = 20;
      }

      // Overall score (weighted average)
      const overallScore = Math.round(
        profileScore * 0.3 +
        engagementScore * 0.5 +
        recencyScore * 0.2
      );

      // Churn risk based on overall score
      let churnRisk: 'low' | 'medium' | 'high' | 'critical' = 'low';
      if (overallScore >= 60) churnRisk = 'low';
      else if (overallScore >= 40) churnRisk = 'medium';
      else if (overallScore >= 20) churnRisk = 'high';
      else churnRisk = 'critical';

      scores.push({
        user_email: email,
        engagement_score: engagementScore,
        profile_score: profileScore,
        recency_score: recencyScore,
        overall_score: overallScore,
        churn_risk: churnRisk,
        factors: {
          hasNaics,
          hasKeywords,
          hasAgencies,
          emailsOpened30d: engagement.opens,
          linksClicked30d: engagement.clicks,
          daysSinceActivity,
        },
      });
    }

    // Upsert to database
    const upsertData = scores.map(s => ({
      user_email: s.user_email,
      engagement_score: s.engagement_score,
      profile_completeness: s.profile_score,
      emails_opened_30d: s.factors.emailsOpened30d,
      links_clicked_30d: s.factors.linksClicked30d,
      days_since_last_activity: s.factors.daysSinceActivity,
      churn_risk: s.churn_risk,
      computed_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await supabase
      .from('user_engagement_scores')
      .upsert(upsertData, { onConflict: 'user_email' });

    if (upsertError) {
      console.log('[UserHealthScores] Upsert error (table may not exist):', upsertError.message);
    }

    // Return summary
    const churnCounts = {
      low: scores.filter(s => s.churn_risk === 'low').length,
      medium: scores.filter(s => s.churn_risk === 'medium').length,
      high: scores.filter(s => s.churn_risk === 'high').length,
      critical: scores.filter(s => s.churn_risk === 'critical').length,
    };

    return NextResponse.json({
      success: true,
      computed: scores.length,
      summary: {
        averageScore: Math.round(scores.reduce((sum, s) => sum + s.overall_score, 0) / scores.length),
        churnDistribution: churnCounts,
      },
      topScores: scores.sort((a, b) => b.overall_score - a.overall_score).slice(0, 10),
      atRisk: scores.filter(s => s.churn_risk === 'high' || s.churn_risk === 'critical').slice(0, 20),
      upsertError: upsertError?.message || null,
    });

  } catch (error) {
    console.error('[UserHealthScores] Error:', error);
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({
      error: errorMessage,
    }, { status: 500 });
  }
}

/**
 * Compute health score for a single user
 */
async function computeUserHealthScore(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  email: string
): Promise<UserHealthScore | null> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [userResult, engagementResult] = await Promise.all([
    supabase
      .from('user_notification_settings')
      .select('naics_codes, keywords, agencies')
      .eq('user_email', email)
      .single(),
    supabase
      .from('user_engagement')
      .select('event_type, created_at')
      .eq('user_email', email)
      .gte('created_at', thirtyDaysAgo.toISOString()),
  ]);

  if (!userResult.data) return null;

  const user = userResult.data;
  const engagements = engagementResult.data || [];

  let opens = 0, clicks = 0;
  let lastActivity: Date | null = null;

  for (const e of engagements) {
    const eventDate = new Date(e.created_at);
    if (!lastActivity || eventDate > lastActivity) lastActivity = eventDate;
    if (e.event_type === 'email_open') opens++;
    else if (e.event_type === 'link_click') clicks++;
  }

  const hasNaics = user.naics_codes && user.naics_codes.length > 0;
  const hasKeywords = user.keywords && user.keywords.length > 0;
  const hasAgencies = user.agencies && user.agencies.length > 0;

  let profileScore = 40;
  if (hasNaics) profileScore += 30;
  if (hasKeywords) profileScore += 15;
  if (hasAgencies) profileScore += 15;

  let engagementScore = 0;
  engagementScore += Math.min(opens * 5, 40);
  engagementScore += Math.min(clicks * 10, 40);
  if (opens > 0) engagementScore += 10;
  if (clicks > 0) engagementScore += 10;

  let recencyScore = 100;
  let daysSinceActivity: number | null = null;

  if (lastActivity) {
    daysSinceActivity = Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceActivity <= 1) recencyScore = 100;
    else if (daysSinceActivity <= 3) recencyScore = 90;
    else if (daysSinceActivity <= 7) recencyScore = 70;
    else if (daysSinceActivity <= 14) recencyScore = 50;
    else if (daysSinceActivity <= 30) recencyScore = 30;
    else recencyScore = 10;
  } else {
    recencyScore = 20;
  }

  const overallScore = Math.round(profileScore * 0.3 + engagementScore * 0.5 + recencyScore * 0.2);

  let churnRisk: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (overallScore >= 60) churnRisk = 'low';
  else if (overallScore >= 40) churnRisk = 'medium';
  else if (overallScore >= 20) churnRisk = 'high';
  else churnRisk = 'critical';

  return {
    user_email: email,
    engagement_score: engagementScore,
    profile_score: profileScore,
    recency_score: recencyScore,
    overall_score: overallScore,
    churn_risk: churnRisk,
    factors: {
      hasNaics,
      hasKeywords,
      hasAgencies,
      emailsOpened30d: opens,
      linksClicked30d: clicks,
      daysSinceActivity,
    },
  };
}

/**
 * Compute scores for top users by engagement (live)
 */
async function computeTopUserScores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  limit: number
): Promise<UserHealthScore[]> {
  const { data: users } = await supabase
    .from('user_notification_settings')
    .select('user_email')
    .limit(limit);

  const scores: UserHealthScore[] = [];

  for (const user of users || []) {
    const score = await computeUserHealthScore(supabase, user.user_email);
    if (score) scores.push(score);
  }

  return scores.sort((a, b) => b.overall_score - a.overall_score);
}
