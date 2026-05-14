/**
 * SAM Sync Watchdog
 *
 * GET /api/cron/sam-sync-watchdog
 *
 * Monitors SAM cache health and triggers recovery if needed.
 * Runs daily at 3 PM UTC (11 AM ET).
 *
 * Health checks:
 * 1. Cache age (hours since last sync)
 * 2. Consecutive sync failures
 * 3. Active opportunity count
 *
 * Auto-recovery actions:
 * - If cache >24h old: trigger delta sync
 * - If cache >48h old: trigger full sync
 * - If >3 consecutive failures: send alert email
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// Get lazy Supabase client
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface CacheHealth {
  recordCount: number;
  activeCount: number;
  newestSyncedAt: string | null;
  cacheAgeHours: number;
  lastSuccessfulSync: string | null;
  lastSyncStatus: string | null;
  consecutiveFailures: number;
  healthScore: number;
  healthStatus: 'healthy' | 'warning' | 'critical';
}

async function getCacheHealth(): Promise<CacheHealth> {
  const supabase = getSupabase();

  // Get cache stats
  const { count: recordCount } = await supabase
    .from('sam_opportunities')
    .select('*', { count: 'exact', head: true });

  const { count: activeCount } = await supabase
    .from('sam_opportunities')
    .select('*', { count: 'exact', head: true })
    .eq('active', true);

  // Get newest synced record
  const { data: newestRecord } = await supabase
    .from('sam_opportunities')
    .select('synced_at')
    .order('synced_at', { ascending: false })
    .limit(1)
    .single();

  const newestSyncedAt = newestRecord?.synced_at;
  const cacheAgeHours = newestSyncedAt
    ? (Date.now() - new Date(newestSyncedAt).getTime()) / (1000 * 60 * 60)
    : 999;

  // Get last successful sync
  const { data: lastSuccess } = await supabase
    .from('sam_sync_runs')
    .select('completed_at, status')
    .in('status', ['completed', 'completed_with_errors'])
    .order('completed_at', { ascending: false })
    .limit(1)
    .single();

  // Count consecutive failures
  const { data: recentRuns } = await supabase
    .from('sam_sync_runs')
    .select('status')
    .order('started_at', { ascending: false })
    .limit(10);

  let consecutiveFailures = 0;
  for (const run of recentRuns || []) {
    if (run.status === 'failed') {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  // Calculate health score (0-100)
  let healthScore = 100;

  // Deduct for cache age
  if (cacheAgeHours > 48) {
    healthScore -= 50;
  } else if (cacheAgeHours > 24) {
    healthScore -= 25;
  } else if (cacheAgeHours > 12) {
    healthScore -= 10;
  }

  // Deduct for consecutive failures
  healthScore -= consecutiveFailures * 10;

  // Deduct for low active count
  if ((activeCount || 0) < 10000) {
    healthScore -= 20;
  }

  // Clamp to 0-100
  healthScore = Math.max(0, Math.min(100, healthScore));

  // Determine status
  let healthStatus: 'healthy' | 'warning' | 'critical';
  if (healthScore >= 80) {
    healthStatus = 'healthy';
  } else if (healthScore >= 50) {
    healthStatus = 'warning';
  } else {
    healthStatus = 'critical';
  }

  return {
    recordCount: recordCount || 0,
    activeCount: activeCount || 0,
    newestSyncedAt,
    cacheAgeHours: Math.round(cacheAgeHours * 100) / 100,
    lastSuccessfulSync: lastSuccess?.completed_at,
    lastSyncStatus: lastSuccess?.status,
    consecutiveFailures,
    healthScore,
    healthStatus,
  };
}

async function triggerSync(type: 'delta' | 'full' | 'recovery'): Promise<{ success: boolean; error?: string }> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://tools.govcongiants.org';

  try {
    const response = await fetch(
      `${baseUrl}/api/cron/sync-sam-opportunities?type=${type}&triggered_by=watchdog`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.CRON_SECRET || ''}`,
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text.substring(0, 200)}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function sendAlertEmail(health: CacheHealth, action: string): Promise<void> {
  const subject = `[SAM Sync ${health.healthStatus.toUpperCase()}] Cache health alert`;

  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2 style="color: ${health.healthStatus === 'critical' ? '#dc2626' : '#f59e0b'};">
        SAM.gov Cache Health Alert
      </h2>

      <table style="border-collapse: collapse; width: 100%; max-width: 500px;">
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Health Score</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${health.healthScore}/100</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Status</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${health.healthStatus}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Cache Age</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${health.cacheAgeHours.toFixed(1)} hours</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Active Records</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${health.activeCount.toLocaleString()}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Consecutive Failures</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${health.consecutiveFailures}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;"><strong>Action Taken</strong></td>
          <td style="padding: 8px; border: 1px solid #ddd;">${action}</td>
        </tr>
      </table>

      <p style="margin-top: 20px; color: #666;">
        Check the sync status at:
        <a href="https://tools.govcongiants.org/api/admin/sam-sync-status?password=${ADMIN_PASSWORD}">
          Admin Dashboard
        </a>
      </p>
    </div>
  `;

  await sendEmail({
    to: 'eric@govcongiants.com',
    subject,
    html,
  });
}

async function logHealthCheck(health: CacheHealth, action: string, recoveryRunId?: string): Promise<void> {
  const supabase = getSupabase();

  try {
    await supabase.from('sam_sync_health').insert({
      cache_record_count: health.recordCount,
      cache_active_count: health.activeCount,
      cache_newest_synced_at: health.newestSyncedAt,
      cache_age_hours: health.cacheAgeHours,
      last_successful_sync_at: health.lastSuccessfulSync,
      last_sync_status: health.lastSyncStatus,
      consecutive_failures: health.consecutiveFailures,
      health_score: health.healthScore,
      health_status: health.healthStatus,
      action_taken: action,
      recovery_run_id: recoveryRunId,
    });
  } catch (error) {
    // Table may not exist yet - fail silently
    console.log('[SAM Watchdog] Health log skipped (table may not exist):', error);
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const forceAction = searchParams.get('force'); // 'delta' | 'full' | 'recovery'
  const skipEmail = searchParams.get('skipEmail') === 'true';

  // Allow cron or password auth
  const authHeader = request.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isAdmin = password === ADMIN_PASSWORD;

  if (!isCron && !isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get current health status
    const health = await getCacheHealth();

    let action = 'none';
    let syncResult: { success: boolean; error?: string } | null = null;

    // Determine action based on health (or force)
    if (forceAction) {
      action = `forced_${forceAction}`;
      syncResult = await triggerSync(forceAction as 'delta' | 'full' | 'recovery');
    } else if (health.healthStatus === 'critical') {
      // Critical: trigger full recovery sync
      action = 'recovery_triggered';
      syncResult = await triggerSync('recovery');
    } else if (health.cacheAgeHours > 24) {
      // Cache over 24h old: trigger delta sync
      action = 'delta_triggered';
      syncResult = await triggerSync('delta');
    } else if (health.consecutiveFailures >= 3) {
      // 3+ failures: trigger recovery and alert
      action = 'recovery_triggered';
      syncResult = await triggerSync('recovery');
    }

    // Send alert email for warning/critical
    if (!skipEmail && (health.healthStatus === 'critical' || health.consecutiveFailures >= 3)) {
      await sendAlertEmail(health, action);
      action = action === 'none' ? 'alert_sent' : `${action}_alert_sent`;
    }

    // Log health check
    await logHealthCheck(health, action);

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      health,
      action,
      syncResult,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[SAM Watchdog] Error:', error);

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
