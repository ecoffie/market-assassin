/**
 * Admin: Churn Risk Dashboard API
 *
 * Provides focused churn risk analysis:
 * - Users by risk level (critical, high, medium, low)
 * - Actionable recommendations for each user
 * - Trends over time
 * - Re-engagement targets
 *
 * GET ?password=... - Get churn risk overview
 * GET ?password=...&level=critical - Get users at specific risk level
 * GET ?password=...&action=re_engage - Get list ready for re-engagement campaign
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

interface AtRiskUser {
  email: string;
  risk_level: 'critical' | 'high' | 'medium' | 'low';
  overall_score: number;
  issues: string[];
  recommendation: string;
  profile_complete: boolean;
  last_activity: string | null;
  days_inactive: number | null;
  emails_opened_30d: number;
  alerts_enabled: boolean;
  briefings_enabled: boolean;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const level = searchParams.get('level'); // critical, high, medium, low
  const action = searchParams.get('action'); // re_engage
  const limit = parseInt(searchParams.get('limit') || '100');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get all users with their settings and engagement data
    const [usersResult, engagementResult] = await Promise.all([
      supabase
        .from('user_notification_settings')
        .select('user_email, naics_codes, keywords, agencies, alerts_enabled, briefings_enabled, created_at')
        .limit(limit),
      supabase
        .from('user_engagement')
        .select('user_email, event_type, created_at')
        .gte('created_at', thirtyDaysAgo.toISOString()),
    ]);

    if (usersResult.error) {
      return NextResponse.json({ error: usersResult.error.message }, { status: 500 });
    }

    // Build engagement map
    const engagementMap: Record<string, { opens: number; clicks: number; lastActivity: Date | null }> = {};
    for (const e of engagementResult.data || []) {
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

    // Analyze each user
    const atRiskUsers: AtRiskUser[] = [];

    for (const user of usersResult.data || []) {
      const email = user.user_email?.toLowerCase();
      if (!email) continue;

      const engagement = engagementMap[email] || { opens: 0, clicks: 0, lastActivity: null };
      const hasNaics = user.naics_codes && user.naics_codes.length > 0;
      const hasKeywords = user.keywords && user.keywords.length > 0;
      const hasAgencies = user.agencies && user.agencies.length > 0;
      const profileComplete = hasNaics;

      // Calculate scores
      let profileScore = 40;
      if (hasNaics) profileScore += 30;
      if (hasKeywords) profileScore += 15;
      if (hasAgencies) profileScore += 15;

      let engagementScore = 0;
      engagementScore += Math.min(engagement.opens * 5, 40);
      engagementScore += Math.min(engagement.clicks * 10, 40);
      if (engagement.opens > 0) engagementScore += 10;
      if (engagement.clicks > 0) engagementScore += 10;

      let recencyScore = 100;
      let daysInactive: number | null = null;

      if (engagement.lastActivity) {
        daysInactive = Math.floor((Date.now() - engagement.lastActivity.getTime()) / (1000 * 60 * 60 * 24));
        if (daysInactive <= 1) recencyScore = 100;
        else if (daysInactive <= 3) recencyScore = 90;
        else if (daysInactive <= 7) recencyScore = 70;
        else if (daysInactive <= 14) recencyScore = 50;
        else if (daysInactive <= 30) recencyScore = 30;
        else recencyScore = 10;
      } else {
        recencyScore = 20;
      }

      const overallScore = Math.round(profileScore * 0.3 + engagementScore * 0.5 + recencyScore * 0.2);

      // Determine risk level
      let riskLevel: 'critical' | 'high' | 'medium' | 'low' = 'low';
      if (overallScore >= 60) riskLevel = 'low';
      else if (overallScore >= 40) riskLevel = 'medium';
      else if (overallScore >= 20) riskLevel = 'high';
      else riskLevel = 'critical';

      // Build issues list and recommendation
      const issues: string[] = [];
      let recommendation = '';

      if (!hasNaics) {
        issues.push('No NAICS codes set');
      }
      if (!hasKeywords) {
        issues.push('No keywords configured');
      }
      if (!hasAgencies) {
        issues.push('No target agencies selected');
      }
      if (engagement.opens === 0) {
        issues.push('No emails opened in 30 days');
      }
      if (engagement.clicks === 0) {
        issues.push('No links clicked in 30 days');
      }
      if (!user.alerts_enabled && !user.briefings_enabled) {
        issues.push('All notifications disabled');
      }
      if (daysInactive && daysInactive > 14) {
        issues.push(`Inactive for ${daysInactive} days`);
      }

      // Generate recommendation
      if (!hasNaics) {
        recommendation = 'Send profile setup reminder email';
      } else if (engagement.opens === 0 && !user.alerts_enabled && !user.briefings_enabled) {
        recommendation = 'Check if email is valid, re-enable notifications';
      } else if (engagement.opens === 0) {
        recommendation = 'Improve subject lines, test deliverability';
      } else if (engagement.clicks === 0) {
        recommendation = 'Add more compelling CTAs to emails';
      } else if (daysInactive && daysInactive > 14) {
        recommendation = 'Send re-engagement campaign';
      } else {
        recommendation = 'User is engaged, monitor metrics';
      }

      // Filter by level if specified
      if (level && riskLevel !== level) {
        continue;
      }

      // For re-engagement action, only include high/critical with valid profile
      if (action === 're_engage') {
        if (riskLevel !== 'critical' && riskLevel !== 'high') continue;
        if (!hasNaics) continue; // Only re-engage users with complete profiles
      }

      atRiskUsers.push({
        email,
        risk_level: riskLevel,
        overall_score: overallScore,
        issues,
        recommendation,
        profile_complete: profileComplete,
        last_activity: engagement.lastActivity?.toISOString() || null,
        days_inactive: daysInactive,
        emails_opened_30d: engagement.opens,
        alerts_enabled: user.alerts_enabled || false,
        briefings_enabled: user.briefings_enabled || false,
        created_at: user.created_at,
      });
    }

    // Sort by overall score (lowest first = highest risk)
    atRiskUsers.sort((a, b) => a.overall_score - b.overall_score);

    // Calculate summary stats
    const summary = {
      total: atRiskUsers.length,
      critical: atRiskUsers.filter(u => u.risk_level === 'critical').length,
      high: atRiskUsers.filter(u => u.risk_level === 'high').length,
      medium: atRiskUsers.filter(u => u.risk_level === 'medium').length,
      low: atRiskUsers.filter(u => u.risk_level === 'low').length,
      incompleteProfiles: atRiskUsers.filter(u => !u.profile_complete).length,
      zeroEngagement: atRiskUsers.filter(u => u.emails_opened_30d === 0).length,
      disabledNotifications: atRiskUsers.filter(u => !u.alerts_enabled && !u.briefings_enabled).length,
    };

    // Group by recommendation type for action planning
    const actionPlan: Record<string, { count: number; emails: string[] }> = {};
    for (const user of atRiskUsers) {
      if (!actionPlan[user.recommendation]) {
        actionPlan[user.recommendation] = { count: 0, emails: [] };
      }
      actionPlan[user.recommendation].count++;
      if (actionPlan[user.recommendation].emails.length < 10) {
        actionPlan[user.recommendation].emails.push(user.email);
      }
    }

    return NextResponse.json({
      summary,
      actionPlan,
      users: atRiskUsers.slice(0, 50), // Return top 50 most at-risk
      filters: {
        level: level || 'all',
        action: action || 'none',
        limit,
      },
    });

  } catch (error) {
    console.error('[ChurnRisk] Error:', error);
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
