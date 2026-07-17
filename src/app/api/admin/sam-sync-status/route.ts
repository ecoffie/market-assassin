/**
 * SAM Sync Status Admin Endpoint
 *
 * GET /api/admin/sam-sync-status?password=xxx
 *
 * Returns comprehensive SAM.gov sync pipeline status including:
 * - Cache health metrics
 * - Recent sync runs with status
 * - Health check history
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Get lazy Supabase client
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const format = searchParams.get('format'); // 'html' for readable dashboard

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  try {
    // Get cache stats
    const { count: totalRecords } = await supabase
      .from('sam_opportunities')
      .select('*', { count: 'exact', head: true });

    const { count: activeRecords } = await supabase
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

    const cacheAgeHours = newestRecord?.synced_at
      ? (Date.now() - new Date(newestRecord.synced_at).getTime()) / (1000 * 60 * 60)
      : null;

    // Get recent sync runs
    const { data: recentRuns } = await supabase
      .from('sam_sync_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(10);

    // PSC vs NAICS coverage on ACTIVE rows — decides whether PSC can be a
    // first-class match anchor (clean S208 = pest control) or must stay a booster.
    const activeNotNull = (col: string) =>
      supabase
        .from('sam_opportunities')
        .select('*', { count: 'exact', head: true })
        .eq('active', true)
        .not(col, 'is', null)
        .neq(col, '');
    const [{ count: pscPresent }, { count: naicsPresent }] = await Promise.all([
      activeNotNull('psc_code'),
      activeNotNull('naics_code'),
    ]);
    const activeBase = activeRecords || 0;
    const pct = (n: number | null) => (activeBase > 0 ? Math.round(((n || 0) / activeBase) * 1000) / 10 : 0);
    const coverage = {
      activeRecords: activeBase,
      pscPresent: pscPresent || 0,
      pscCoveragePct: pct(pscPresent),
      naicsPresent: naicsPresent || 0,
      naicsCoveragePct: pct(naicsPresent),
    };

    // Get recent health checks
    const { data: healthChecks } = await supabase
      .from('sam_sync_health')
      .select('*')
      .order('checked_at', { ascending: false })
      .limit(5);

    // Calculate health score
    let healthScore = 100;
    const hours = cacheAgeHours || 999;

    if (hours > 48) healthScore -= 50;
    else if (hours > 24) healthScore -= 25;
    else if (hours > 12) healthScore -= 10;

    // Count consecutive failures
    let consecutiveFailures = 0;
    for (const run of recentRuns || []) {
      if (run.status === 'failed') consecutiveFailures++;
      else break;
    }
    healthScore -= consecutiveFailures * 10;

    if ((activeRecords || 0) < 10000) healthScore -= 20;
    healthScore = Math.max(0, Math.min(100, healthScore));

    const healthStatus = healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'warning' : 'critical';

    const result = {
      cache: {
        totalRecords,
        activeRecords,
        newestSyncedAt: newestRecord?.synced_at,
        cacheAgeHours: cacheAgeHours ? Math.round(cacheAgeHours * 100) / 100 : null,
      },
      coverage,
      health: {
        score: healthScore,
        status: healthStatus,
        consecutiveFailures,
      },
      recentRuns: recentRuns?.map(run => ({
        id: run.id,
        startedAt: run.started_at,
        completedAt: run.completed_at,
        status: run.status,
        syncType: run.sync_type || 'full',
        totalFetched: run.total_fetched,
        totalInserted: run.total_inserted,
        totalUpdated: run.total_updated,
        totalAvailable: run.total_available,
        lastSuccessfulOffset: run.last_successful_offset,
        failedOffsets: run.failed_offsets,
        error: run.error_message,
      })),
      healthChecks: healthChecks?.map(check => ({
        checkedAt: check.checked_at,
        healthScore: check.health_score,
        healthStatus: check.health_status,
        cacheAgeHours: check.cache_age_hours,
        actionTaken: check.action_taken,
      })),
      timestamp: new Date().toISOString(),
    };

    if (format === 'html') {
      const statusColor = healthStatus === 'healthy' ? '#10b981' :
                          healthStatus === 'warning' ? '#f59e0b' : '#dc2626';

      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>SAM Sync Status</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 1200px; margin: 0 auto; background: #f9fafb; }
    h1 { color: #1f2937; }
    .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .health-badge { display: inline-block; padding: 8px 16px; border-radius: 999px; font-weight: 600; color: white; background: ${statusColor}; font-size: 18px; }
    .stat { display: inline-block; margin-right: 30px; margin-bottom: 15px; }
    .stat-value { font-size: 24px; font-weight: 700; color: #1f2937; }
    .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f3f4f6; font-weight: 600; color: #374151; }
    .status-completed { color: #10b981; }
    .status-failed { color: #dc2626; }
    .status-running { color: #3b82f6; }
    .status-partial { color: #f59e0b; }
    .refresh { margin-top: 20px; }
    .refresh a { color: #3b82f6; text-decoration: none; }
  </style>
</head>
<body>
  <h1>SAM.gov Sync Status</h1>

  <div class="card">
    <h2>Health Status</h2>
    <span class="health-badge">${healthStatus.toUpperCase()} (${healthScore}/100)</span>

    <div style="margin-top: 20px;">
      <div class="stat">
        <div class="stat-value">${(activeRecords || 0).toLocaleString()}</div>
        <div class="stat-label">Active Opportunities</div>
      </div>
      <div class="stat">
        <div class="stat-value">${cacheAgeHours ? cacheAgeHours.toFixed(1) + 'h' : 'N/A'}</div>
        <div class="stat-label">Cache Age</div>
      </div>
      <div class="stat">
        <div class="stat-value">${consecutiveFailures}</div>
        <div class="stat-label">Consecutive Failures</div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Recent Sync Runs</h2>
    <table>
      <thead>
        <tr>
          <th>Started</th>
          <th>Type</th>
          <th>Status</th>
          <th>Fetched</th>
          <th>Inserted</th>
          <th>Updated</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        ${(recentRuns || []).map(run => `
          <tr>
            <td>${new Date(run.started_at).toLocaleString()}</td>
            <td>${run.sync_type || 'full'}</td>
            <td class="status-${run.status}">${run.status}</td>
            <td>${(run.total_fetched || 0).toLocaleString()}</td>
            <td>${(run.total_inserted || 0).toLocaleString()}</td>
            <td>${(run.total_updated || 0).toLocaleString()}</td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${run.error_message || '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <div class="card">
    <h2>Actions</h2>
    <p><a href="/api/cron/sync-sam-opportunities?type=delta&password=${password}">Trigger Delta Sync</a></p>
    <p><a href="/api/cron/sync-sam-opportunities?type=full&password=${password}">Trigger Full Sync</a></p>
    <p><a href="/api/cron/sam-sync-watchdog?password=${password}">Run Watchdog Check</a></p>
  </div>

  <div class="refresh">
    <a href="?password=${password}&format=html">🔄 Refresh</a> |
    <a href="?password=${password}">View JSON</a>
  </div>
</body>
</html>
      `;

      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[SAM Status] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
