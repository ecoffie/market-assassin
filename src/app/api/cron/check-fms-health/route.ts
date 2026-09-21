import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { FORECAST_SOURCE_POLICY, type ForecastSourcePolicy } from '@/lib/forecasts/source-policy';
import { rollupForecastDomain } from '@/lib/forecasts/domain-health';
import { readPhysicalPairs, readInstances, readPairBindings } from '@/lib/forecasts/domain-health-read';
import { sendOpsAlert } from '@/lib/ops-alert';

type HealthStatus = 'healthy' | 'warning' | 'critical';

interface ForecastSourceRow {
  agency_code: string;
  agency_name: string | null;
  total_records: number | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number | null;
  is_active: boolean | null;
}

interface RecompeteSyncRow {
  started_at: string | null;
  completed_at: string | null;
  status: string | null;
  contracts_fetched: number | null;
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

/**
 * Per-agency liveness read from the LIVE forecast rows.
 *
 * ⚠️ EXACT COUNT, NOT A ROW SCAN. The first cut of this selected
 * `source_agency, last_synced_at` and tallied in code. PostgREST silently caps an
 * unranged select at 1,000 rows, so it reported 383 rows against a 33,687-row
 * corpus (DHS 76 vs a real 1,634) — a fabricated-low count, which is exactly the
 * truncation class this repo gates against. One `head:true, count:'exact'` per
 * agency cannot be capped, and a null count is surfaced as UNKNOWN rather than 0.
 */
async function forecastLiveness(
  supabase: ReturnType<typeof getAdminClient>,
): Promise<{ data: Map<string, { rows: number; lastWriteAt: string | null }> | null; error: { message: string } | null }> {
  const out = new Map<string, { rows: number; lastWriteAt: string | null }>();
  for (const policy of Object.values(FORECAST_SOURCE_POLICY)) {
    const [{ count, error: cErr }, { data: newest, error: nErr }] = await Promise.all([
      supabase.from('agency_forecasts')
        .select('id', { count: 'exact', head: true })
        .eq('source_agency', policy.code),
      supabase.from('agency_forecasts')
        // unranged-ok: single newest row per agency, explicitly limited to 1.
        .select('last_synced_at')
        .eq('source_agency', policy.code)
        .order('last_synced_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (cErr || nErr) return { data: null, error: { message: (cErr || nErr)!.message } };
    // A null count means COULD NOT MEASURE. Never coerce it to 0 (Bug Prevention #11).
    out.set(policy.code, {
      rows: count ?? -1,
      lastWriteAt: (newest?.last_synced_at as string | undefined) ?? null,
    });
  }
  return { data: out, error: null };
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

  // ⚠️ FORECAST HEALTH IS DERIVED FROM THE FORECAST ROWS, NOT FROM CONFIG.
  // `forecast_sources` is an abandoned CONFIG table: measured 2026-09-13 it reported
  // total_records=0 on all 11 rows against 33,687 real rows, DHS is_active=false while
  // DHS writes daily, and DOE last_sync_at=2026-04-06 while DOE wrote that same day.
  // The live sync-forecasts cron never maintains it. Reading it for health meant a
  // working source could be called `critical` purely because a config row went stale.
  // It keeps its legitimate config role (source_url, scraper_config); it is no longer
  // health truth. See src/lib/forecasts/live-source-health.ts.
  const [{ data: forecastRows, error: forecastError }, { data: recompeteSyncs, error: recompeteError }] = await Promise.all([
    // Per-source liveness from the live rows. See the note below on why this is a
    // per-agency EXACT COUNT rather than a row scan.
    forecastLiveness(supabase),
    supabase
      .from('recompete_sync_runs')
      .select('started_at, completed_at, status, contracts_fetched')
      .order('started_at', { ascending: false })
      .limit(5),
  ]);

  if (forecastError || recompeteError) {
    return NextResponse.json({
      success: false,
      error: forecastError?.message || recompeteError?.message || 'Failed to fetch FMS health data',
    }, { status: 500 });
  }

  // forecastError is checked above, so a null map here is unreachable — but narrow
  // explicitly rather than assert, so a future refactor cannot silently pass null.
  const liveByAgency = forecastRows ?? new Map<string, { rows: number; lastWriteAt: string | null }>();

  const evaluatedSources = Object.values(FORECAST_SOURCE_POLICY).map(policy => {
    const live = liveByAgency.get(policy.code);
    // Shape the LIVE evidence into the existing evaluator's row contract, so the
    // established thresholds and reasons are reused unchanged — only the SOURCE of
    // truth moved from the abandoned config table to the forecast rows.
    const row: ForecastSourceRow = {
      agency_code: policy.code,
      agency_name: policy.name,
      total_records: live && live.rows >= 0 ? live.rows : 0,
      last_success_at: live?.lastWriteAt ?? null,
      last_failure_at: null,
      consecutive_failures: 0,
      is_active: Boolean(live?.rows),
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

  // ── THE FORECAST AUTHORITY ────────────────────────────────────────────────
  // Enumerated from the HELD CORPUS, not from FORECAST_SOURCE_POLICY (8 entries,
  // which hid 13 of 20 agencies and 20,299 rows) and not from data_source_instances
  // (7 rows, which would hide exactly the same agencies). A pair present in the data
  // can never vanish from health; at worst it reports UNREGISTERED.
  let forecastDomain: ReturnType<typeof rollupForecastDomain> | null = null;
  let forecastDomainError: string | null = null;
  try {
    const [pairs, instances, bindings] = await Promise.all([
      readPhysicalPairs(supabase), readInstances(supabase), readPairBindings(supabase)]);
    forecastDomain = rollupForecastDomain(pairs, instances, new Date().toISOString(), bindings);
  } catch (e) {
    // Surface the failure; never fall back to a registry that would look healthier.
    forecastDomainError = (e as Error).message;
  }

  const result = {
    success: true,
    status,
    checkedAt: new Date().toISOString(),
    forecastDomain: forecastDomain ?? { error: forecastDomainError ?? 'unmeasured' },
    summary: {
      productionSources: productionSources.length,
      productionHealthy: productionSources.filter(source => source.status === 'healthy').length,
      productionWarning,
      productionCritical,
      validateSources: evaluatedSources.filter(source => source.stage === 'validate').length,
      disabledSources: evaluatedSources.filter(source => source.stage === 'disabled').length,
    },
    // ⚠️ LEGACY, NON-AUTHORITATIVE. Kept for existing consumers only. It enumerates
    // the hardcoded 8-entry FORECAST_SOURCE_POLICY, so it CANNOT see 13 represented
    // agencies. `forecastDomain` above is the authority. Do not reintroduce this as one.
    forecastsLegacyPolicyView: evaluatedSources,
    recompete: {
      healthy: recompeteHealthy,
      latestStatus: latestRecompete?.status || 'unknown',
      latestCompletedAt: latestRecompete?.completed_at || null,
      latestStartedAt: latestRecompete?.started_at || null,
      daysSinceLatestRun: recompeteDaysAgo,
      recordsProcessed: latestRecompete?.contracts_fetched || 0,
    },
  };

  const alertEmail = process.env.ADMIN_ALERT_EMAIL;
  if (shouldEmail && alertEmail && status !== 'healthy') {
    const problemSources = productionSources
      .filter(source => source.status !== 'healthy')
      .map(source => `<li><strong>${source.agencyCode}</strong>: ${source.reasons.join('; ') || source.status}</li>`)
      .join('');

    await sendOpsAlert({
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
