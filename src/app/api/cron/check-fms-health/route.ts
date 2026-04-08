import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { FORECAST_SOURCE_POLICY, type ForecastSourcePolicy } from '@/lib/forecasts/source-policy';
import { sendEmail } from '@/lib/send-email';

type HealthStatus = 'healthy' | 'warning' | 'critical';

interface ForecastSourceRow {
  agency_code: string;
  agency_name: string | null;
  total_records: number | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number | null;
  health_status: string | null;
  is_active: boolean | null;
}

interface RecompeteSyncRow {
  started_at: string | null;
  completed_at: string | null;
  status: string | null;
  records_processed: number | null;
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function daysSince(dateString: string | null): number | null {
  if (!dateString) return null;
  const diff = Date.now() - new Date(dateString).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function evaluateForecastSource(row: ForecastSourceRow, policy: ForecastSourcePolicy) {
  const lastSuccessDaysAgo = daysSince(row.last_success_at);
  const consecutiveFailures = row.consecutive_failures || 0;
  const totalRecords = row.total_records || 0;

  let status: HealthStatus = 'healthy';
  const reasons: string[] = [];

  if (policy.stage === 'production') {
    if (lastSuccessDaysAgo === null) {
      status = 'critical';
      reasons.push('Never synced successfully');
    } else if (lastSuccessDaysAgo > 7) {
      status = 'critical';
      reasons.push(`Last success ${lastSuccessDaysAgo} days ago`);
    } else if (lastSuccessDaysAgo > 3) {
      status = 'warning';
      reasons.push(`Last success ${lastSuccessDaysAgo} days ago`);
    }

    if (consecutiveFailures >= 3) {
      status = 'critical';
      reasons.push(`${consecutiveFailures} consecutive failures`);
    } else if (consecutiveFailures >= 1 && status === 'healthy') {
      status = 'warning';
      reasons.push(`${consecutiveFailures} recent failure${consecutiveFailures === 1 ? '' : 's'}`);
    }

    if (totalRecords === 0) {
      if (status === 'healthy') status = 'warning';
      reasons.push('No forecast records stored');
    }
  } else if (policy.stage === 'validate') {
    if (lastSuccessDaysAgo === null) {
      status = 'warning';
      reasons.push('Not yet validated with a successful sync');
    } else if (lastSuccessDaysAgo > 14) {
      status = 'warning';
      reasons.push(`Validation source stale (${lastSuccessDaysAgo} days)`);
    }
  }

  return {
    agencyCode: row.agency_code,
    agencyName: row.agency_name || policy.name,
    stage: policy.stage,
    schedulerEnabled: policy.schedulerEnabled,
    status,
    reasons,
    lastSuccessAt: row.last_success_at,
    lastSuccessDaysAgo,
    lastFailureAt: row.last_failure_at,
    consecutiveFailures,
    totalRecords,
  };
}

function overallStatus(params: {
  productionCritical: number;
  productionWarning: number;
  recompeteHealthy: boolean;
}): HealthStatus {
  if (params.productionCritical > 0 || !params.recompeteHealthy) return 'critical';
  if (params.productionWarning > 0) return 'warning';
  return 'healthy';
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const shouldEmail = request.nextUrl.searchParams.get('email') === 'true';

  if (!isVercelCron && !hasCronSecret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({
      message: 'FMS health monitor cron',
      usage: {
        manual: 'Triggered by Vercel cron or CRON_SECRET',
        email: 'Add ?email=true to send an alert when status is warning or critical',
      },
    });
  }

  const supabase = getAdminClient();

  const [{ data: forecastSources, error: forecastError }, { data: recompeteSyncs, error: recompeteError }] = await Promise.all([
    supabase
      .from('forecast_sources')
      .select('agency_code, agency_name, total_records, last_success_at, last_failure_at, consecutive_failures, health_status, is_active'),
    supabase
      .from('recompete_sync_runs')
      .select('started_at, completed_at, status, records_processed')
      .order('started_at', { ascending: false })
      .limit(5),
  ]);

  if (forecastError || recompeteError) {
    return NextResponse.json({
      success: false,
      error: forecastError?.message || recompeteError?.message || 'Failed to fetch FMS health data',
    }, { status: 500 });
  }

  const forecastRowsByCode = new Map(
    ((forecastSources || []) as ForecastSourceRow[]).map(row => [row.agency_code, row])
  );

  const evaluatedSources = Object.values(FORECAST_SOURCE_POLICY).map(policy => {
    const row = forecastRowsByCode.get(policy.code) || {
      agency_code: policy.code,
      agency_name: policy.name,
      total_records: 0,
      last_success_at: null,
      last_failure_at: null,
      consecutive_failures: 0,
      health_status: null,
      is_active: false,
    };

    return evaluateForecastSource(row, policy);
  });

  const productionSources = evaluatedSources.filter(source => source.stage === 'production');
  const productionCritical = productionSources.filter(source => source.status === 'critical').length;
  const productionWarning = productionSources.filter(source => source.status === 'warning').length;

  const latestRecompete = ((recompeteSyncs || []) as RecompeteSyncRow[])[0] || null;
  const recompeteDaysAgo = daysSince(latestRecompete?.completed_at || latestRecompete?.started_at || null);
  const recompeteHealthy = Boolean(
    latestRecompete &&
    latestRecompete.status === 'success' &&
    recompeteDaysAgo !== null &&
    recompeteDaysAgo <= 7
  );

  const status = overallStatus({
    productionCritical,
    productionWarning,
    recompeteHealthy,
  });

  const result = {
    success: true,
    status,
    checkedAt: new Date().toISOString(),
    summary: {
      productionSources: productionSources.length,
      productionHealthy: productionSources.filter(source => source.status === 'healthy').length,
      productionWarning,
      productionCritical,
      validateSources: evaluatedSources.filter(source => source.stage === 'validate').length,
      disabledSources: evaluatedSources.filter(source => source.stage === 'disabled').length,
    },
    forecasts: evaluatedSources,
    recompete: {
      healthy: recompeteHealthy,
      latestStatus: latestRecompete?.status || 'unknown',
      latestCompletedAt: latestRecompete?.completed_at || null,
      latestStartedAt: latestRecompete?.started_at || null,
      daysSinceLatestRun: recompeteDaysAgo,
      recordsProcessed: latestRecompete?.records_processed || 0,
    },
  };

  const alertEmail = process.env.ADMIN_ALERT_EMAIL;
  if (shouldEmail && alertEmail && status !== 'healthy') {
    const problemSources = productionSources
      .filter(source => source.status !== 'healthy')
      .map(source => `<li><strong>${source.agencyCode}</strong>: ${source.reasons.join('; ') || source.status}</li>`)
      .join('');

    await sendEmail({
      to: alertEmail,
      subject: `[${status.toUpperCase()}] FMS Health Check`,
      html: `
        <h2>Federal Market Scanner Health: ${status.toUpperCase()}</h2>
        <p><strong>Production healthy:</strong> ${result.summary.productionHealthy}/${result.summary.productionSources}</p>
        <p><strong>Recompete healthy:</strong> ${recompeteHealthy ? 'Yes' : 'No'}</p>
        ${problemSources ? `<ul>${problemSources}</ul>` : '<p>No production source issues detected.</p>'}
      `,
    });
  }

  return NextResponse.json(result);
}
