/**
 * Market Intelligence Pipeline Test & Evaluation
 *
 * Tests the complete Market Intel flow:
 * 1. Daily Alerts - SAM.gov opportunities
 * 2. Daily Briefs - Recompete/Market intel
 * 3. Weekly Pursuit Brief - Capture strategy
 * 4. Weekly Deep Dive - Comprehensive analysis
 *
 * Usage:
 * GET ?password=xxx - Full pipeline status report
 * GET ?password=xxx&email=xxx - Test specific user's eligibility
 * POST ?password=xxx&email=xxx&component=alerts - Send test alert to user
 * POST ?password=xxx&email=xxx&component=briefs - Send test brief to user
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function isIgnorableMissingTableError(message: string): boolean {
  return message.includes('Could not find the table') || message.includes('schema cache');
}

interface PipelineStatus {
  component: string;
  status: 'healthy' | 'degraded' | 'failed';
  lastRun?: string;
  usersEligible: number;
  usersWithNaics: number;
  usersWithFallback: number;
  recentDeliveries: number;
  audienceLabel?: string;
  usersWithProfileData?: number;
  betaMode?: boolean;
  errors?: string[];
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const testEmail = request.nextUrl.searchParams.get('email');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({
      error: 'Unauthorized',
      usage: {
        status: 'GET ?password=xxx - Full pipeline report',
        testUser: 'GET ?password=xxx&email=xxx - Test specific user',
        sendTest: 'POST ?password=xxx&email=xxx&component=alerts|briefs|pursuit|deepdive',
      }
    }, { status: 401 });
  }

  const supabase = getSupabase();

  // If testing specific user
  if (testEmail) {
    return await testUserEligibility(supabase, testEmail);
  }

  // Full pipeline status report
  const pipeline: PipelineStatus[] = [];

  // 1. Daily Alerts Status
  const alertsStatus = await checkAlertsStatus(supabase);
  pipeline.push(alertsStatus);

  // 2. Daily Briefs Status
  const briefsStatus = await checkBriefsStatus(supabase);
  pipeline.push(briefsStatus);

  // 3. Pursuit Brief Status
  const pursuitStatus = await checkPursuitStatus(supabase);
  pipeline.push(pursuitStatus);

  // 4. Weekly Deep Dive Status
  const deepDiveStatus = await checkDeepDiveStatus(supabase);
  pipeline.push(deepDiveStatus);

  // Summary
  const healthyCount = pipeline.filter(p => p.status === 'healthy').length;
  const overallStatus = healthyCount === pipeline.length ? 'healthy' :
    healthyCount >= 2 ? 'degraded' : 'failed';

  return NextResponse.json({
    success: true,
    overallStatus,
    timestamp: new Date().toISOString(),
    pipeline,
    recommendations: generateRecommendations(pipeline),
  });
}

async function checkAlertsStatus(supabase: ReturnType<typeof getSupabase>): Promise<PipelineStatus> {
  // Count users in the unified notification settings table to mirror the live daily-alerts cron
  const { data: alertUsers, count: alertCount } = await supabase
    .from('user_notification_settings')
    .select('user_email, naics_codes, alert_frequency', { count: 'exact' })
    .eq('is_active', true)
    .eq('alerts_enabled', true)
    .eq('alert_frequency', 'daily');

  const usersWithNaics = (alertUsers || []).filter(u =>
    Array.isArray(u.naics_codes) && u.naics_codes.length > 0
  ).length;

  // Check recent deliveries
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const { count: recentCount } = await supabase
    .from('alert_log')
    .select('*', { count: 'exact', head: true })
    .eq('delivery_status', 'sent')
    .gte('alert_date', yesterday.toISOString().split('T')[0]);

  return {
    component: 'Daily Alerts',
    status: (recentCount || 0) > 0 ? 'healthy' : 'degraded',
    usersEligible: alertCount || 0,
    usersWithNaics,
    usersWithFallback: (alertCount || 0) - usersWithNaics,
    recentDeliveries: recentCount || 0,
  };
}

async function checkBriefsStatus(supabase: ReturnType<typeof getSupabase>): Promise<PipelineStatus> {
  // Mirror the real beta send-briefings audience:
  // 1. all active user_notification_settings
  // 2. smart_user_profiles not already present by email
  const { data: notificationSettings } = await supabase
    .from('user_notification_settings')
    .select('user_email, naics_codes, agencies, aggregated_profile')
    .eq('is_active', true);

  const { data: smartProfiles, error: smartProfilesError } = await supabase
    .from('smart_user_profiles')
    .select('email, naics_codes, agencies')
;

  if (smartProfilesError && !isIgnorableMissingTableError(smartProfilesError.message)) {
    throw smartProfilesError;
  }
  const seenEmails = new Set<string>();
  let totalAudience = 0;
  let usersWithProfileData = 0;
  let usersUsingFallback = 0;

  for (const profile of notificationSettings || []) {
    const email = profile.user_email?.toLowerCase();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    totalAudience++;

    const aggregated = profile.aggregated_profile as Record<string, unknown> | null;
    const aggregatedNaics = aggregated && Array.isArray(aggregated.naics_codes)
      ? aggregated.naics_codes
      : [];
    const aggregatedAgencies = aggregated && Array.isArray(aggregated.agencies)
      ? aggregated.agencies
      : [];
    const naics = Array.isArray(profile.naics_codes) ? profile.naics_codes : [];
    const agencies = Array.isArray(profile.agencies) ? profile.agencies : [];
    const hasProfileData =
      aggregatedNaics.length > 0 ||
      aggregatedAgencies.length > 0 ||
      naics.length > 0 ||
      agencies.length > 0;

    if (hasProfileData) {
      usersWithProfileData++;
    } else {
      usersUsingFallback++;
    }
  }

  for (const profile of smartProfiles || []) {
    const email = profile.email?.toLowerCase();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    totalAudience++;

    const naics = Array.isArray(profile.naics_codes) ? profile.naics_codes : [];
    const agencies = Array.isArray(profile.agencies) ? profile.agencies : [];
    const hasProfileData = naics.length > 0 || agencies.length > 0;

    if (hasProfileData) {
      usersWithProfileData++;
    } else {
      usersUsingFallback++;
    }
  }

  // Check recent deliveries
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const { count: recentCount } = await supabase
    .from('briefing_log')
    .select('*', { count: 'exact', head: true })
    .eq('delivery_status', 'sent')
    .gte('briefing_date', yesterday.toISOString().split('T')[0]);

  return {
    component: 'Daily Briefs (Beta Audience)',
    status: (recentCount || 0) > 0 ? 'healthy' : 'degraded',
    usersEligible: totalAudience,
    usersWithNaics: usersWithProfileData,
    usersWithFallback: usersUsingFallback,
    usersWithProfileData,
    audienceLabel: 'beta_briefing_pool',
    betaMode: true,
    recentDeliveries: recentCount || 0,
  };
}

async function checkPursuitStatus(supabase: ReturnType<typeof getSupabase>): Promise<PipelineStatus> {
  const { count: eligibleCount } = await supabase
    .from('user_notification_settings')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('briefings_enabled', true);

  // Check recent pursuit briefs (weekly - last 7 days)
  // Pursuit briefs are now stored in briefing_log with briefing_type='pursuit'
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const { count: recentCount } = await supabase
    .from('briefing_log')
    .select('*', { count: 'exact', head: true })
    .eq('briefing_type', 'pursuit')
    .gte('created_at', weekAgo.toISOString());

  return {
    component: 'Weekly Pursuit Brief',
    status: 'healthy', // Weekly, so harder to check
    usersEligible: eligibleCount || 0,
    usersWithNaics: 0, // Not tracked separately
    usersWithFallback: 0,
    recentDeliveries: recentCount || 0,
  };
}

async function checkDeepDiveStatus(supabase: ReturnType<typeof getSupabase>): Promise<PipelineStatus> {
  const { count: eligibleCount } = await supabase
    .from('user_notification_settings')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('briefings_enabled', true);

  return {
    component: 'Weekly Deep Dive',
    status: 'healthy', // Weekly
    usersEligible: eligibleCount || 0,
    usersWithNaics: 0,
    usersWithFallback: 0,
    recentDeliveries: 0, // Not tracked in separate table
  };
}

async function testUserEligibility(supabase: ReturnType<typeof getSupabase>, email: string) {
  const normalizedEmail = email.toLowerCase();

  // Check user_notification_settings
  const { data: notifSettings } = await supabase
    .from('user_notification_settings')
    .select('*')
    .eq('user_email', normalizedEmail)
    .single();

  // Check recent alert deliveries
  const { data: recentAlerts } = await supabase
    .from('alert_log')
    .select('alert_date, delivery_status, opportunities_count')
    .eq('user_email', normalizedEmail)
    .order('alert_date', { ascending: false })
    .limit(5);

  // Check recent briefing deliveries
  const { data: recentBriefs } = await supabase
    .from('briefing_log')
    .select('briefing_date, delivery_status, items_count')
    .eq('user_email', normalizedEmail)
    .order('briefing_date', { ascending: false })
    .limit(5);

  const eligibility = {
    dailyAlerts: {
      eligible: notifSettings?.is_active && notifSettings?.alerts_enabled && notifSettings?.alert_frequency === 'daily',
      hasNaics: Array.isArray(notifSettings?.naics_codes) && notifSettings.naics_codes.length > 0,
      naicsCodes: notifSettings?.naics_codes || [],
      willUseFallback: !notifSettings?.naics_codes || notifSettings.naics_codes.length === 0,
    },
    dailyBriefs: {
      eligible: notifSettings?.is_active && notifSettings?.briefings_enabled,
      hasNaics: Array.isArray(notifSettings?.naics_codes) && notifSettings.naics_codes.length > 0,
      willUseFallback: !(notifSettings?.naics_codes?.length > 0),
    },
    pursuitBrief: {
      eligible: notifSettings?.is_active && notifSettings?.briefings_enabled,
    },
    weeklyDeepDive: {
      eligible: notifSettings?.is_active && notifSettings?.briefings_enabled,
    },
  };

  return NextResponse.json({
    success: true,
    email: normalizedEmail,
    eligibility,
    notificationSettings: notifSettings || null,
    recentDeliveries: {
      alerts: recentAlerts || [],
      briefs: recentBriefs || [],
    },
    recommendations: [
      !notifSettings && 'User not in notification_settings - run backfill or have them sign up',
      eligibility.dailyAlerts.willUseFallback && 'User will receive generic alerts - encourage NAICS setup',
      eligibility.dailyBriefs.willUseFallback && 'User will receive generic briefs - encourage NAICS setup',
    ].filter(Boolean),
  });
}

function generateRecommendations(pipeline: PipelineStatus[]): string[] {
  const recs: string[] = [];

  const alerts = pipeline.find(p => p.component === 'Daily Alerts');
  const briefs = pipeline.find(p => p.component.includes('Daily Briefs'));

  if (alerts && alerts.usersWithFallback > alerts.usersWithNaics) {
    recs.push(`${alerts.usersWithFallback} users receiving generic alerts - send NAICS reminder email`);
  }

  if (briefs && briefs.recentDeliveries === 0) {
    recs.push('No briefs sent recently - check cron schedule and logs');
  }

  if (briefs && briefs.betaMode && briefs.usersWithFallback > 0) {
    recs.push(`${briefs.usersWithFallback} beta users are receiving fallback briefings - encourage NAICS/agency setup`);
  }

  if (alerts && alerts.status === 'degraded') {
    recs.push('Daily alerts may have issues - check alert_log for errors');
  }

  return recs;
}

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const email = request.nextUrl.searchParams.get('email');
  const component = request.nextUrl.searchParams.get('component');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'email parameter required' }, { status: 400 });
  }

  if (!component || !['alerts', 'briefs', 'pursuit', 'deepdive'].includes(component)) {
    return NextResponse.json({
      error: 'component must be one of: alerts, briefs, pursuit, deepdive'
    }, { status: 400 });
  }

  // Trigger the appropriate test
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://tools.govcongiants.org';
  let testUrl = '';

  switch (component) {
    case 'alerts':
      testUrl = `${baseUrl}/api/admin/trigger-alerts?password=${ADMIN_PASSWORD}&email=${email}&test=true`;
      break;
    case 'briefs':
      testUrl = `${baseUrl}/api/cron/send-briefings?email=${email}&test=true`;
      break;
    case 'pursuit':
      testUrl = `${baseUrl}/api/admin/test-pursuit-brief?password=${ADMIN_PASSWORD}&email=${email}`;
      break;
    case 'deepdive':
      testUrl = `${baseUrl}/api/cron/weekly-deep-dive?email=${email}&test=true`;
      break;
  }

  try {
    const response = await fetch(testUrl);
    const result = await response.json();

    return NextResponse.json({
      success: response.ok,
      component,
      email,
      testUrl,
      result,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      component,
      email,
      error: String(error),
    }, { status: 500 });
  }
}
