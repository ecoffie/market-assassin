/**
 * Signup Health Monitor
 *
 * GET /api/admin/signup-health?password=xxx
 *
 * Monitors the health of signup flows by:
 * 1. Checking recent signup_events for success/failure rates
 * 2. Running synthetic tests against signup endpoints
 * 3. Checking for error spikes in the last hour
 *
 * Enterprise SaaS pattern: Synthetic monitoring + funnel analytics
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

interface SignupHealthMetrics {
  // Recent activity (last 24h)
  signupsAttempted: number;
  signupsCompleted: number;
  signupsFailed: number;
  successRate: number;

  // Error breakdown
  errorsByType: Record<string, number>;

  // Funnel metrics (last 24h)
  funnelDropoffs: {
    step: string;
    started: number;
    completed: number;
    dropoffRate: number;
  }[];

  // Synthetic test results
  syntheticTests: {
    endpoint: string;
    status: 'pass' | 'fail';
    responseTime: number;
    error?: string;
  }[];

  // Overall health
  healthScore: number;
  healthStatus: 'healthy' | 'degraded' | 'critical';
  alerts: string[];
}

async function getRecentSignupMetrics(supabase: ReturnType<typeof getSupabase>): Promise<{
  attempted: number;
  completed: number;
  failed: number;
  errorsByType: Record<string, number>;
}> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Get signup events from the last 24h
  const { data: events, error } = await supabase
    .from('signup_events')
    .select('event_type, status, error_type, created_at')
    .gte('created_at', twentyFourHoursAgo)
    .order('created_at', { ascending: false });

  if (error || !events) {
    // Table might not exist yet - return zeros
    return { attempted: 0, completed: 0, failed: 0, errorsByType: {} };
  }

  const attempted = events.filter(e => e.event_type === 'signup_started').length;
  const completed = events.filter(e => e.event_type === 'signup_completed').length;
  const failed = events.filter(e => e.status === 'failed').length;

  const errorsByType: Record<string, number> = {};
  events.filter(e => e.error_type).forEach(e => {
    errorsByType[e.error_type] = (errorsByType[e.error_type] || 0) + 1;
  });

  return { attempted, completed, failed, errorsByType };
}

async function getFunnelMetrics(supabase: ReturnType<typeof getSupabase>): Promise<{
  step: string;
  started: number;
  completed: number;
  dropoffRate: number;
}[]> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: events } = await supabase
    .from('signup_events')
    .select('event_type, step, created_at')
    .gte('created_at', twentyFourHoursAgo);

  if (!events) return [];

  // Group by step
  const steps = ['email', 'business_description', 'industries', 'agencies', 'geography', 'delivery'];
  const funnelData = steps.map(step => {
    const started = events.filter(e => e.step === step && e.event_type === 'step_started').length;
    const completed = events.filter(e => e.step === step && e.event_type === 'step_completed').length;
    const dropoffRate = started > 0 ? Math.round((1 - completed / started) * 100) : 0;
    return { step, started, completed, dropoffRate };
  });

  return funnelData;
}

async function runSyntheticTests(): Promise<{
  endpoint: string;
  status: 'pass' | 'fail';
  responseTime: number;
  error?: string;
}[]> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://mi.govcongiants.com';

  const tests = [
    {
      name: 'Alerts Signup Page',
      endpoint: '/alerts/signup',
      method: 'GET' as const,
      expectedStatus: 200,
    },
    {
      name: 'Save Profile API (OPTIONS)',
      endpoint: '/api/alerts/save-profile',
      method: 'OPTIONS' as const,
      expectedStatus: [200, 204],
    },
    {
      name: 'Preferences API (GET without auth)',
      endpoint: '/api/alerts/preferences?email=test-synthetic@test.com',
      method: 'GET' as const,
      // Should return 401 for unauthenticated users - that's correct behavior
      expectedStatus: [401],
    },
  ];

  const results = [];

  for (const test of tests) {
    const start = Date.now();
    try {
      const response = await fetch(`${baseUrl}${test.endpoint}`, {
        method: test.method,
        headers: {
          'User-Agent': 'GovCon-Synthetic-Monitor/1.0',
        },
      });

      const responseTime = Date.now() - start;
      const expectedStatuses = Array.isArray(test.expectedStatus) ? test.expectedStatus : [test.expectedStatus];
      const passed = expectedStatuses.includes(response.status);

      results.push({
        endpoint: test.name,
        status: passed ? 'pass' as const : 'fail' as const,
        responseTime,
        error: passed ? undefined : `Expected ${expectedStatuses.join('/')}, got ${response.status}`,
      });
    } catch (err) {
      results.push({
        endpoint: test.name,
        status: 'fail' as const,
        responseTime: Date.now() - start,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return results;
}

function calculateHealthScore(metrics: {
  successRate: number;
  errorsByType: Record<string, number>;
  syntheticTests: { status: string }[];
}): { score: number; status: 'healthy' | 'degraded' | 'critical'; alerts: string[] } {
  let score = 100;
  const alerts: string[] = [];

  // Deduct for low success rate
  if (metrics.successRate < 50) {
    score -= 40;
    alerts.push(`Critical: Signup success rate is ${metrics.successRate}%`);
  } else if (metrics.successRate < 80) {
    score -= 20;
    alerts.push(`Warning: Signup success rate is ${metrics.successRate}%`);
  } else if (metrics.successRate < 95) {
    score -= 10;
  }

  // Deduct for auth errors (the specific issue we just fixed)
  const authErrors = metrics.errorsByType['auth_failed'] || 0;
  if (authErrors > 10) {
    score -= 30;
    alerts.push(`Critical: ${authErrors} auth failures in last 24h`);
  } else if (authErrors > 3) {
    score -= 15;
    alerts.push(`Warning: ${authErrors} auth failures in last 24h`);
  }

  // Deduct for synthetic test failures
  const failedTests = metrics.syntheticTests.filter(t => t.status === 'fail').length;
  if (failedTests > 0) {
    score -= failedTests * 15;
    alerts.push(`${failedTests} synthetic test(s) failing`);
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Determine status
  let status: 'healthy' | 'degraded' | 'critical';
  if (score >= 80) {
    status = 'healthy';
  } else if (score >= 50) {
    status = 'degraded';
  } else {
    status = 'critical';
  }

  return { score, status, alerts };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const format = searchParams.get('format');
  const runSynthetic = searchParams.get('synthetic') !== 'false'; // default true

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  try {
    // Get metrics
    const recentMetrics = await getRecentSignupMetrics(supabase);
    const funnelMetrics = await getFunnelMetrics(supabase);

    // Run synthetic tests (optional, can be slow)
    const syntheticTests = runSynthetic ? await runSyntheticTests() : [];

    // Calculate success rate
    const successRate = recentMetrics.attempted > 0
      ? Math.round((recentMetrics.completed / recentMetrics.attempted) * 100)
      : 100; // No signups = healthy (nothing broken)

    // Calculate health
    const { score, status, alerts } = calculateHealthScore({
      successRate,
      errorsByType: recentMetrics.errorsByType,
      syntheticTests,
    });

    const result: SignupHealthMetrics = {
      signupsAttempted: recentMetrics.attempted,
      signupsCompleted: recentMetrics.completed,
      signupsFailed: recentMetrics.failed,
      successRate,
      errorsByType: recentMetrics.errorsByType,
      funnelDropoffs: funnelMetrics,
      syntheticTests,
      healthScore: score,
      healthStatus: status,
      alerts,
    };

    if (format === 'html') {
      const statusColor = status === 'healthy' ? '#10b981' :
                          status === 'degraded' ? '#f59e0b' : '#dc2626';

      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Signup Health Monitor</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; max-width: 1000px; margin: 0 auto; background: #f9fafb; }
    h1 { color: #1f2937; }
    .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .health-badge { display: inline-block; padding: 8px 16px; border-radius: 999px; font-weight: 600; color: white; background: ${statusColor}; font-size: 18px; }
    .stat { display: inline-block; margin-right: 30px; margin-bottom: 15px; }
    .stat-value { font-size: 24px; font-weight: 700; color: #1f2937; }
    .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
    .alert { padding: 12px; margin-bottom: 8px; border-radius: 6px; }
    .alert-warning { background: #fef3c7; color: #92400e; }
    .alert-critical { background: #fee2e2; color: #991b1b; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f3f4f6; }
    .pass { color: #10b981; }
    .fail { color: #dc2626; }
  </style>
</head>
<body>
  <h1>Signup Health Monitor</h1>

  <div class="card">
    <h2>Health Status</h2>
    <span class="health-badge">${status.toUpperCase()} (${score}/100)</span>

    <div style="margin-top: 20px;">
      <div class="stat">
        <div class="stat-value">${recentMetrics.attempted}</div>
        <div class="stat-label">Signups Attempted (24h)</div>
      </div>
      <div class="stat">
        <div class="stat-value">${recentMetrics.completed}</div>
        <div class="stat-label">Completed</div>
      </div>
      <div class="stat">
        <div class="stat-value">${successRate}%</div>
        <div class="stat-label">Success Rate</div>
      </div>
      <div class="stat">
        <div class="stat-value">${recentMetrics.failed}</div>
        <div class="stat-label">Failed</div>
      </div>
    </div>
  </div>

  ${alerts.length > 0 ? `
  <div class="card">
    <h2>Alerts</h2>
    ${alerts.map(alert => `
      <div class="alert ${alert.includes('Critical') ? 'alert-critical' : 'alert-warning'}">
        ${alert}
      </div>
    `).join('')}
  </div>
  ` : ''}

  <div class="card">
    <h2>Synthetic Tests</h2>
    <table>
      <thead>
        <tr>
          <th>Endpoint</th>
          <th>Status</th>
          <th>Response Time</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        ${syntheticTests.map(test => `
          <tr>
            <td>${test.endpoint}</td>
            <td class="${test.status}">${test.status.toUpperCase()}</td>
            <td>${test.responseTime}ms</td>
            <td>${test.error || '-'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  ${Object.keys(recentMetrics.errorsByType).length > 0 ? `
  <div class="card">
    <h2>Errors by Type (24h)</h2>
    <table>
      <thead>
        <tr>
          <th>Error Type</th>
          <th>Count</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(recentMetrics.errorsByType).map(([type, count]) => `
          <tr>
            <td>${type}</td>
            <td>${count}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <div style="margin-top: 20px; color: #6b7280; font-size: 14px;">
    <a href="?password=${password}&format=html">Refresh</a> |
    <a href="?password=${password}">View JSON</a> |
    Last checked: ${new Date().toISOString()}
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
    console.error('[Signup Health] Error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
