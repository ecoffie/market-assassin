import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';

/**
 * Briefing Watchdog - Automated Failsafe System
 *
 * Runs after each send window to:
 * 1. Check system health (templates exist, deliveries succeeded)
 * 2. Queue failed briefings for retry
 * 3. Process retry queue (exponential backoff)
 * 4. Self-heal (re-trigger precompute if templates missing)
 * 5. Alert on critical failures
 *
 * Schedule: 9 AM, 9:30 AM daily (after send windows)
 *           Plus Friday checks after weekly and Saturday checks after pursuit
 */

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

const ALERT_EMAIL = 'eric@govcongiants.com';
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://tools.govcongiants.org';

// Thresholds
const FAILURE_RATE_WARNING = 0.05;  // 5%
const FAILURE_RATE_CRITICAL = 0.15; // 15%
const MIN_TEMPLATE_COVERAGE = 0.8;  // 80%
const MAX_RETRIES_PER_RUN = 50;

interface HealthMetrics {
  briefingType: string;
  templatesAvailable: number;
  templatesExpected: number;
  usersEligible: number;
  usersSent: number;
  usersFailed: number;
  usersSkipped: number;
  usersNoTemplate: number;
  healthScore: number;
  isHealthy: boolean;
  alertLevel: 'info' | 'warning' | 'critical' | null;
}

interface RetryCandidate {
  id: string;
  user_email: string;
  briefing_type: string;
  briefing_date: string;
  naics_codes: string[];
  retry_count: number;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const results = {
    healthChecks: [] as HealthMetrics[],
    retriesProcessed: 0,
    retriesSucceeded: 0,
    retriesFailed: 0,
    selfHealingActions: [] as string[],
    alertsSent: 0,
    errors: [] as string[],
  };

  try {
    const today = new Date().toISOString().split('T')[0];
    const dayOfWeek = new Date().getUTCDay(); // 0=Sun, 1=Mon, etc.

    // Determine which briefing types to check based on day
    const briefingTypes: string[] = ['daily'];
    if (dayOfWeek === 5) briefingTypes.push('weekly');  // Friday
    if (dayOfWeek === 6) briefingTypes.push('pursuit'); // Saturday

    // 1. Health Check for each briefing type
    for (const briefingType of briefingTypes) {
      const metrics = await checkBriefingHealth(briefingType, today);
      results.healthChecks.push(metrics);

      // Log health to database
      await logHealthMetrics(metrics, today);

      // Send alerts if needed
      if (metrics.alertLevel) {
        await sendHealthAlert(metrics, today);
        results.alertsSent++;
      }

      // Self-heal: Re-trigger precompute if templates missing
      if (metrics.templatesAvailable < metrics.templatesExpected * MIN_TEMPLATE_COVERAGE) {
        const healed = await selfHealPrecompute(briefingType);
        if (healed) {
          results.selfHealingActions.push(`Triggered precompute for ${briefingType}`);
        }
      }
    }

    // 2. Process retry queue
    const retries = await getRetryQueue();
    for (const retry of retries.slice(0, MAX_RETRIES_PER_RUN)) {
      results.retriesProcessed++;
      const success = await processRetry(retry);
      if (success) {
        results.retriesSucceeded++;
      } else {
        results.retriesFailed++;
      }
    }

    // 3. Check for exhausted retries (permanent failures)
    const exhausted = await checkExhaustedRetries();
    if (exhausted > 0) {
      results.errors.push(`${exhausted} briefings exhausted all retries`);
      await sendExhaustedAlert(exhausted);
      results.alertsSent++;
    }

    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      ...results,
      elapsed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Watchdog] Error:', error);
    results.errors.push(error instanceof Error ? error.message : 'Unknown error');

    // Always try to send alert on watchdog failure
    try {
      await sendWatchdogFailureAlert(error);
    } catch {
      // Ignore alert failure
    }

    return NextResponse.json({
      success: false,
      ...results,
      error: error instanceof Error ? error.message : 'Unknown error',
      elapsed: Date.now() - startTime,
    }, { status: 500 });
  }
}

async function checkBriefingHealth(briefingType: string, date: string): Promise<HealthMetrics> {
  const templateDate = getTemplateDateForBriefingType(briefingType, date);

  // Get template count
  const { count: templatesAvailable } = await getSupabase()
    .from('briefing_templates')
    .select('*', { count: 'exact', head: true })
    .eq('briefing_type', briefingType)
    .eq('template_date', templateDate);

  // Get unique NAICS profiles (expected templates)
  const { data: profiles } = await getSupabase()
    .from('user_notification_settings')
    .select('naics_profile_hash')
    .eq('briefings_enabled', true)
    .eq('is_active', true)
    .not('naics_profile_hash', 'is', null);

  const uniqueProfiles = new Set(profiles?.map((p: { naics_profile_hash: string }) => p.naics_profile_hash) || []);
  const templatesExpected = uniqueProfiles.size;

  // Get eligible users
  const { count: usersEligible } = await getSupabase()
    .from('user_notification_settings')
    .select('*', { count: 'exact', head: true })
    .eq('briefings_enabled', true)
    .eq('is_active', true);

  // Get delivery stats from briefing_log
  const { data: logs } = await getSupabase()
    .from('briefing_log')
    .select('delivery_status, user_email')
    .eq('briefing_date', date)
    .eq('briefing_type', briefingType)
    .gte('created_at', `${date}T00:00:00Z`);

  type LogRow = { delivery_status: string; user_email: string };
  const usersSent = logs?.filter((l: LogRow) => l.delivery_status === 'sent').length || 0;
  const usersFailed = logs?.filter((l: LogRow) => l.delivery_status === 'failed').length || 0;
  const usersSkipped = logs?.filter((l: LogRow) => l.delivery_status === 'skipped').length || 0;

  // Get no-template count from dead letter queue
  const { count: usersNoTemplate } = await getSupabase()
    .from('briefing_dead_letter')
    .select('*', { count: 'exact', head: true })
    .eq('briefing_type', briefingType)
    .eq('briefing_date', date)
    .ilike('failure_reason', '%no template%');

  // Calculate health score
  const totalProcessed = usersSent + usersFailed + usersSkipped;
  const healthScore = totalProcessed > 0
    ? Math.round((usersSent / totalProcessed) * 100)
    : 100;

  // Determine alert level
  const failureRate = totalProcessed > 0 ? usersFailed / totalProcessed : 0;
  const templateCoverage = templatesExpected > 0
    ? (templatesAvailable || 0) / templatesExpected
    : 1;

  let alertLevel: 'info' | 'warning' | 'critical' | null = null;
  if (failureRate >= FAILURE_RATE_CRITICAL || templateCoverage < 0.5) {
    alertLevel = 'critical';
  } else if (failureRate >= FAILURE_RATE_WARNING || templateCoverage < MIN_TEMPLATE_COVERAGE) {
    alertLevel = 'warning';
  }

  const isHealthy = alertLevel === null;

  return {
    briefingType,
    templatesAvailable: templatesAvailable || 0,
    templatesExpected,
    usersEligible: usersEligible || 0,
    usersSent,
    usersFailed,
    usersSkipped,
    usersNoTemplate: usersNoTemplate || 0,
    healthScore,
    isHealthy,
    alertLevel,
  };
}

function getTemplateDateForBriefingType(briefingType: string, date: string): string {
  if (briefingType === 'daily') return date;

  const base = new Date(`${date}T00:00:00Z`);
  const dayOfWeek = base.getUTCDay();

  if (briefingType === 'pursuit') {
    const saturday = new Date(base);
    const daysToSaturday = dayOfWeek === 6 ? 0 : (6 - dayOfWeek + 7) % 7;
    saturday.setUTCDate(saturday.getUTCDate() + daysToSaturday);
    return saturday.toISOString().split('T')[0];
  }

  const monday = new Date(base);
  const daysToMonday = dayOfWeek === 1 ? 0 : dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  monday.setUTCDate(monday.getUTCDate() + daysToMonday);
  return monday.toISOString().split('T')[0];
}

async function logHealthMetrics(metrics: HealthMetrics, date: string): Promise<void> {
  await getSupabase().from('briefing_system_health').upsert({
    check_date: date,
    briefing_type: metrics.briefingType,
    templates_available: metrics.templatesAvailable,
    templates_expected: metrics.templatesExpected,
    users_eligible: metrics.usersEligible,
    users_sent: metrics.usersSent,
    users_failed: metrics.usersFailed,
    users_skipped: metrics.usersSkipped,
    users_no_template: metrics.usersNoTemplate,
    alert_level: metrics.alertLevel,
    alert_sent: metrics.alertLevel !== null,
  }, {
    onConflict: 'check_date,briefing_type,check_time',
  });
}

async function getRetryQueue(): Promise<RetryCandidate[]> {
  const { data } = await getSupabase().rpc('get_briefing_retries', { p_limit: MAX_RETRIES_PER_RUN });
  return data || [];
}

async function processRetry(retry: RetryCandidate): Promise<boolean> {
  console.log(`[Watchdog] Retrying ${retry.briefing_type} for ${retry.user_email} (attempt ${retry.retry_count + 1})`);

  // Mark as retrying
  await getSupabase()
    .from('briefing_dead_letter')
    .update({ status: 'retrying' })
    .eq('id', retry.id);

  try {
    // Call the appropriate send endpoint with single user
    const endpoint = retry.briefing_type === 'weekly'
      ? 'send-weekly-fast'
      : retry.briefing_type === 'pursuit'
        ? 'send-pursuit-fast'
        : 'send-briefings-fast';

    const response = await fetch(
      `${BASE_URL}/api/cron/${endpoint}?test=true&email=${encodeURIComponent(retry.user_email)}&force=true`,
      { method: 'GET' }
    );

    const result = await response.json();

    if (result.success && result.briefingsSent > 0) {
      // Mark success
      await getSupabase().rpc('complete_briefing_retry', {
        p_id: retry.id,
        p_success: true,
      });
      console.log(`[Watchdog] Retry succeeded for ${retry.user_email}`);
      return true;
    } else {
      // Mark failure
      await getSupabase().rpc('complete_briefing_retry', {
        p_id: retry.id,
        p_success: false,
        p_error: result.error || 'No briefing sent',
      });
      console.log(`[Watchdog] Retry failed for ${retry.user_email}: ${result.error || 'No briefing sent'}`);
      return false;
    }
  } catch (error) {
    await getSupabase().rpc('complete_briefing_retry', {
      p_id: retry.id,
      p_success: false,
      p_error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

async function checkExhaustedRetries(): Promise<number> {
  const { count } = await getSupabase()
    .from('briefing_dead_letter')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'exhausted')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  return count || 0;
}

async function selfHealPrecompute(briefingType: string): Promise<boolean> {
  console.log(`[Watchdog] Self-healing: Triggering precompute for ${briefingType}`);

  try {
    const endpoint = briefingType === 'weekly'
      ? 'precompute-weekly-briefings'
      : briefingType === 'pursuit'
        ? 'precompute-pursuit-briefs'
        : 'precompute-briefings';

    const response = await fetch(`${BASE_URL}/api/cron/${endpoint}?test=true`, {
      method: 'GET',
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function sendHealthAlert(metrics: HealthMetrics, date: string): Promise<void> {
  const level = metrics.alertLevel === 'critical' ? '🚨 CRITICAL' : '⚠️ WARNING';
  const subject = `${level}: Briefing System Alert - ${metrics.briefingType}`;

  const html = `
    <h2>${level}: ${metrics.briefingType.toUpperCase()} Briefing System Alert</h2>
    <p><strong>Date:</strong> ${date}</p>

    <h3>Health Metrics</h3>
    <table border="1" cellpadding="8" style="border-collapse: collapse;">
      <tr><td>Health Score</td><td><strong>${metrics.healthScore}%</strong></td></tr>
      <tr><td>Templates Available</td><td>${metrics.templatesAvailable} / ${metrics.templatesExpected}</td></tr>
      <tr><td>Users Eligible</td><td>${metrics.usersEligible}</td></tr>
      <tr><td>Users Sent</td><td style="color: green;">${metrics.usersSent}</td></tr>
      <tr><td>Users Failed</td><td style="color: red;">${metrics.usersFailed}</td></tr>
      <tr><td>Users No Template</td><td style="color: orange;">${metrics.usersNoTemplate}</td></tr>
    </table>

    <h3>Actions Taken</h3>
    <ul>
      <li>Failed briefings queued for automatic retry (up to 3 attempts)</li>
      ${metrics.templatesAvailable < metrics.templatesExpected * MIN_TEMPLATE_COVERAGE
        ? '<li>Precompute triggered to generate missing templates</li>'
        : ''}
    </ul>

    <p><a href="${BASE_URL}/api/admin/briefing-status?password=${process.env.ADMIN_PASSWORD || 'galata-assassin-2026'}">View Full Status</a></p>
  `;

  await sendEmail({
    to: ALERT_EMAIL,
    subject,
    html,
    from: 'GovCon Giants System <hello@govconedu.com>',
  });
}

async function sendExhaustedAlert(count: number): Promise<void> {
  const subject = `🚨 ${count} Briefings Exhausted All Retries`;

  const html = `
    <h2>Briefing Retry Exhaustion Alert</h2>
    <p><strong>${count}</strong> briefings have failed all 3 retry attempts in the last 24 hours.</p>
    <p>These users will not receive their briefing automatically.</p>

    <h3>Action Required</h3>
    <ol>
      <li>Check dead letter queue for failure reasons</li>
      <li>Fix underlying issues</li>
      <li>Manually trigger briefings if needed</li>
    </ol>

    <p><a href="${BASE_URL}/api/admin/briefing-dead-letter?password=${process.env.ADMIN_PASSWORD || 'galata-assassin-2026'}">View Dead Letter Queue</a></p>
  `;

  await sendEmail({
    to: ALERT_EMAIL,
    subject,
    html,
    from: 'GovCon Giants System <hello@govconedu.com>',
  });
}

async function sendWatchdogFailureAlert(error: unknown): Promise<void> {
  const subject = `🚨 CRITICAL: Briefing Watchdog Failed`;

  const html = `
    <h2>Briefing Watchdog System Failure</h2>
    <p>The watchdog system itself has failed. Manual intervention required.</p>

    <h3>Error</h3>
    <pre>${error instanceof Error ? error.message : String(error)}</pre>

    <h3>Immediate Actions</h3>
    <ol>
      <li>Check Vercel logs for watchdog cron</li>
      <li>Verify database connectivity</li>
      <li>Manually run health check</li>
    </ol>
  `;

  await sendEmail({
    to: ALERT_EMAIL,
    subject,
    html,
    from: 'GovCon Giants System <hello@govconedu.com>',
  });
}
