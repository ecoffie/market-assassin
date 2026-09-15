/**
 * db-health-watch alert copy + probe sample shape.
 *
 * Alert text must report MEASURED fields only. Do not diagnose unmeasured causes
 * (ingest/backfill, memory pressure, pooler, right-size, imminent outage).
 */

export type DbHealthStatus = 'healthy' | 'degraded' | 'down';

export interface ProbeResult {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

/** Fields returned by public.db_health_stats() when the RPC is installed. */
export interface PgHealthStats {
  total_connections?: number;
  active_connections?: number;
  idle_in_txn?: number;
  max_connections?: number;
  longest_query_secs?: number;
  oldest_xmin_age?: number;
  db_size_mb?: number;
}

export interface ProbeTimingSample {
  at: string;
  status: DbHealthStatus;
  reachability_ms: number;
  alert_count_ms: number;
  pg_stats_ms: number;
  overall_ms: number;
  reachability_ok: boolean;
  alert_count_ok: boolean;
}

/** Keep ~30 days of hourly samples (ring buffer in KV). */
export const PROBE_SAMPLES_MAX = 720;
export const PROBE_SAMPLES_KEY = 'dbhealth:probeSamples';

export function probeMs(probes: ProbeResult[], name: string): number | null {
  const p = probes.find((x) => x.name === name);
  return p ? p.ms : null;
}

export function probeOk(probes: ProbeResult[], name: string): boolean | null {
  const p = probes.find((x) => x.name === name);
  return p ? p.ok : null;
}

/** Parse pg-stats probe detail JSON; returns null if skipped / unparseable. */
export function parsePgStatsDetail(detail: string | undefined): PgHealthStats | null {
  if (!detail || detail.startsWith('skipped:')) return null;
  try {
    const v = JSON.parse(detail) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as PgHealthStats;
  } catch {
    return null;
  }
}

export function buildProbeTimingSample(args: {
  at: string;
  status: DbHealthStatus;
  probes: ProbeResult[];
  overallMs: number;
}): ProbeTimingSample {
  const { at, status, probes, overallMs } = args;
  return {
    at,
    status,
    reachability_ms: probeMs(probes, 'reachability') ?? -1,
    alert_count_ms: probeMs(probes, 'alert-count') ?? -1,
    pg_stats_ms: probeMs(probes, 'pg-stats') ?? -1,
    overall_ms: overallMs,
    reachability_ok: probeOk(probes, 'reachability') ?? false,
    alert_count_ok: probeOk(probes, 'alert-count') ?? false,
  };
}

export function appendProbeSample(
  existing: ProbeTimingSample[] | null | undefined,
  sample: ProbeTimingSample,
  max = PROBE_SAMPLES_MAX,
): ProbeTimingSample[] {
  const next = [...(existing ?? []), sample];
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}

export function buildAlertSubject(
  status: DbHealthStatus,
  prev: DbHealthStatus,
  whenIso: string,
): string {
  if (status === 'degraded') {
    return `⚠️ [Mindy] data API latency elevated — was ${prev} (${whenIso})`;
  }
  if (status === 'down') {
    return `🚨 [Mindy DB] DOWN — was ${prev} (${whenIso})`;
  }
  return `✅ [Mindy] recovered to healthy — was ${prev} (${whenIso})`;
}

function fmtMs(ms: number | null): string {
  return ms == null ? 'n/a' : `${ms}ms`;
}

function fmtNum(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? 'n/a' : String(n);
}

function measuredSummaryHtml(probes: ProbeResult[]): string {
  const reach = probes.find((p) => p.name === 'reachability');
  const alert = probes.find((p) => p.name === 'alert-count');
  const pg = probes.find((p) => p.name === 'pg-stats');
  const stats = parsePgStatsDetail(pg?.detail);
  const reachable = reach?.ok === true;

  const connections =
    stats?.total_connections != null && stats?.max_connections != null
      ? `${stats.total_connections} / ${stats.max_connections}`
      : 'n/a';

  const rows: Array<[string, string]> = [
    ['First PostgREST / reachability', fmtMs(reach?.ms ?? null)],
    ['Subsequent check (alert-count)', fmtMs(alert?.ms ?? null)],
    ['Subsequent check (pg-stats)', fmtMs(pg?.ms ?? null)],
    ['Connections (current / max)', connections],
    ['Active connections', fmtNum(stats?.active_connections)],
    [
      'Longest query',
      stats?.longest_query_secs == null ? 'n/a' : `${stats.longest_query_secs}s`,
    ],
    ['DB reachable', reachable ? 'yes' : 'no'],
  ];

  return rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 10px;color:#555">${k}</td><td style="padding:4px 10px"><b>${v}</b></td></tr>`,
    )
    .join('');
}

function interpretationFor(status: DbHealthStatus): string {
  if (status === 'down') {
    return (
      'Reachability probe failed or exceeded the critical latency threshold. ' +
      'Read routes may serve last-good snapshots. Check the Supabase status page ' +
      'and platform DATABASE metrics before restarting or resizing mid-incident.'
    );
  }
  if (status === 'degraded') {
    return (
      'Database remains reachable. Elevated latency was observed on the data ' +
      'API/reachability path. Check API and database metrics before attributing the cause.'
    );
  }
  return 'Recovered to healthy. Probe latencies are back under the warning threshold.';
}

export function buildAlertHtml(
  status: DbHealthStatus,
  prev: DbHealthStatus,
  probes: ProbeResult[],
): string {
  const color = status === 'down' ? '#dc2626' : status === 'degraded' ? '#d97706' : '#059669';
  const title =
    status === 'degraded'
      ? 'Mindy data API latency elevated'
      : status === 'down'
        ? 'Mindy DB DOWN'
        : 'Mindy DB health: HEALTHY';

  const probeRows = probes
    .map(
      (p) =>
        `<tr><td style="padding:4px 10px">${p.name}</td><td style="padding:4px 10px">${p.ok ? 'ok' : 'fail'}</td><td style="padding:4px 10px">${p.ms}ms</td><td style="padding:4px 10px;color:#666">${p.detail || ''}</td></tr>`,
    )
    .join('');

  return `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2 style="color:${color};margin-bottom:4px">${title}</h2>
      <p style="color:#555;margin-top:0">Transitioned from <b>${prev}</b> → <b>${status}</b>.</p>
      <table style="border-collapse:collapse;font-size:14px;margin:12px 0;border:1px solid #eee;width:100%">
        <thead><tr style="background:#f8f8f8"><th style="padding:4px 10px;text-align:left" colspan="2">Measured</th></tr></thead>
        <tbody>${measuredSummaryHtml(probes)}</tbody>
      </table>
      <table style="border-collapse:collapse;font-size:13px;margin:12px 0;border:1px solid #eee;width:100%">
        <thead><tr style="background:#f8f8f8"><th style="padding:4px 10px;text-align:left">Probe</th><th style="padding:4px 10px">OK</th><th style="padding:4px 10px">Latency</th><th style="padding:4px 10px;text-align:left">Detail</th></tr></thead>
        <tbody>${probeRows}</tbody>
      </table>
      <p style="color:#555;font-size:13px">${interpretationFor(status)}</p>
    </div>`;
}
