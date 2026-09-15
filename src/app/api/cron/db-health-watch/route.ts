import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { sendOpsAlert } from '@/lib/ops-alert';
import {
  appendProbeSample,
  buildAlertHtml,
  buildAlertSubject,
  buildProbeTimingSample,
  PROBE_SAMPLES_KEY,
  type DbHealthStatus,
  type ProbeResult,
  type ProbeTimingSample,
} from '@/lib/ops/db-health-alert';

/**
 * DB Health Watch — Layer 2 early warning (the "hear it first, not from users").
 *
 * WHY: The 2026-06-30 → 07-03 outage ran ~13+ hours before we fully grasped the
 * DB was the problem. This cron measures the signals that actually precede an
 * outage — reachability, latency, and connection/table-size pressure — and
 * ALERTS THE MOMENT they degrade, so capacity creep is caught before it's
 * downtime. It is the detection half of the resilience work; the last-good
 * layer (src/lib/resilience/last-good.ts) is the survival half.
 *
 * DESIGN:
 *  - Runs off the dispatcher (a cron_jobs row: route=/api/cron/db-health-watch),
 *    NOT vercel.json (the 100-cron cap rule).
 *  - Three probes, cheapest → most telling:
 *      1. Reachability + latency: a trivial SELECT with a hard timeout.
 *         Wall-clock includes PostgREST first-request path (not SQL alone).
 *      2. Write-path check: the alert pipeline reads sam_opportunities; confirm
 *         a light COUNT returns (the query class that thrashed during the incident).
 *      3. Pressure signals: row counts on the hottest tables + pg_stat activity
 *         via a lightweight RPC if present (best-effort — absence never fails).
 *  - State is kept in KV (survives a Supabase outage — the thing being watched
 *    can't also be the alarm's storage). We only alert on a status TRANSITION
 *    (healthy→degraded / degraded→down / recovery), so a sustained incident
 *    doesn't spam; a flapping signal is rate-limited to one alert per 30 min.
 *  - Every run persists probe timings to KV (`dbhealth:probeSamples`) so
 *    reachability_ms / alert_count_ms / pg_stats_ms / overall_ms have a real
 *    distribution — do not use cron_job_runs.duration_ms as a proxy.
 *  - Degraded alert copy reports MEASURED fields only (no unmeasured cause).
 *
 * AUTH: cron secret (x-cron-secret / ?password=ADMIN_PASSWORD), like sibling crons.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const CRON_SECRET = process.env.CRON_SECRET;
const ALERT_TO = process.env.DB_HEALTH_ALERT_EMAIL || 'eric@govcongiants.com';

// Thresholds — a slow-but-up data path is the early-warning window we want to catch.
const LATENCY_WARN_MS = 2500;   // a simple SELECT should be well under this
const LATENCY_DOWN_MS = 8000;   // past this, treat as effectively unusable
const PROBE_TIMEOUT_MS = 10000; // hard cap on any single probe

const STATE_KEY = 'dbhealth:state';         // last status we alerted on
const LAST_ALERT_KEY = 'dbhealth:lastAlert'; // ISO of last alert sent (rate limit)
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;    // ≤ 1 transition alert / 30 min

type Status = DbHealthStatus;

function isAuthed(request: NextRequest): boolean {
  const pw = request.nextUrl.searchParams.get('password');
  // The dispatcher invokes job routes with `authorization: Bearer <CRON_SECRET>`
  // (see api/cron/dispatch) and an `x-cron-dispatch: 1` header — match that,
  // plus the `x-vercel-cron` header and the manual ?password= path.
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const isDispatch = request.headers.get('x-cron-dispatch') === '1';
  return (
    (!!ADMIN_PASSWORD && pw === ADMIN_PASSWORD) ||
    (!!CRON_SECRET && bearer === CRON_SECRET) ||
    isVercelCron ||
    isDispatch
  );
}

/**
 * Run a thenable with a hard timeout so a hung DB can't hang the cron.
 * Accepts PromiseLike because the Supabase query builder is a thenable, not a
 * real Promise — Promise.resolve() normalizes it.
 */
async function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function persistProbeSample(sample: ProbeTimingSample): Promise<void> {
  try {
    const existing = (await kv.get<ProbeTimingSample[]>(PROBE_SAMPLES_KEY)) ?? [];
    await kv.set(PROBE_SAMPLES_KEY, appendProbeSample(existing, sample));
  } catch (err) {
    console.error('[db-health-watch] probe sample persist failed:', (err as Error).message);
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthed(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Alarm self-test: fire a real, clearly-labelled Slack alert without waiting for
  // an actual outage — so "is the alarm even working?" is answerable on demand.
  // GET /api/cron/db-health-watch?password=<ADMIN_PASSWORD>&test=1
  if (new URL(request.url).searchParams.get('test') === '1') {
    const r = await sendOpsAlert({
      to: ALERT_TO,
      subject: '✅ [Mindy DB] alarm self-test — NOT an incident',
      html: `<p>db-health-watch → Slack alerting is live. If this reached your Slack, a real DB degradation/outage alert will too.</p><p>${new Date().toISOString()}</p>`,
    });
    return NextResponse.json({ test: true, delivered_to_slack: r.ok, error: r.error ?? null });
  }

  const overallStarted = Date.now();
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const probes: ProbeResult[] = [];

  // Probe 1 — reachability + latency (trivial indexed read).
  // Wall-clock includes PostgREST first-request path on a fresh client.
  {
    const t = Date.now();
    try {
      const r = await withTimeout(
        sb.from('sam_opportunities').select('notice_id').limit(1),
        PROBE_TIMEOUT_MS,
        'reachability',
      );
      if (r.error) throw new Error(r.error.message);
      probes.push({ name: 'reachability', ok: true, ms: Date.now() - t });
    } catch (err) {
      probes.push({ name: 'reachability', ok: false, ms: Date.now() - t, detail: (err as Error).message });
    }
  }

  // Probe 2 — the alert-pipeline query class (a COUNT on the hot table). This is
  // the query family that thrashed during the incident; if it's slow, alerts are
  // about to back up.
  {
    const t = Date.now();
    try {
      const { count, error } = await withTimeout<{ count: number | null; error: { message: string } | null }>(
        sb.from('sam_opportunities').select('notice_id', { count: 'exact', head: true }).eq('active', true),
        PROBE_TIMEOUT_MS,
        'alert-count',
      );
      if (error) throw new Error(error.message);
      probes.push({ name: 'alert-count', ok: true, ms: Date.now() - t, detail: `active=${count}` });
    } catch (err) {
      probes.push({ name: 'alert-count', ok: false, ms: Date.now() - t, detail: (err as Error).message });
    }
  }

  // Probe 3 — connection/activity pressure via optional RPC. Best-effort: if the
  // RPC isn't installed, we simply skip it (never fail the health check on it).
  {
    const t = Date.now();
    try {
      const { data, error } = await withTimeout<{ data: unknown; error: { message: string } | null }>(
        sb.rpc('db_health_stats'),
        PROBE_TIMEOUT_MS,
        'pg-stats',
      );
      if (error) throw new Error(error.message);
      // Full JSON — alert measured fields parse this; do not truncate.
      probes.push({ name: 'pg-stats', ok: true, ms: Date.now() - t, detail: JSON.stringify(data) });
    } catch (err) {
      // Expected when the RPC isn't deployed — informational, not a failure.
      probes.push({ name: 'pg-stats', ok: true, ms: Date.now() - t, detail: `skipped: ${(err as Error).message}` });
    }
  }

  const overallMs = Date.now() - overallStarted;

  // Derive overall status from the two hard probes (1 & 2).
  const hard = probes.filter((p) => p.name === 'reachability' || p.name === 'alert-count');
  const anyDown = hard.some((p) => !p.ok || p.ms >= LATENCY_DOWN_MS);
  const anySlow = hard.some((p) => p.ok && p.ms >= LATENCY_WARN_MS);
  const status: Status = anyDown ? 'down' : anySlow ? 'degraded' : 'healthy';

  const checkedAt = new Date().toISOString();
  const sample = buildProbeTimingSample({
    at: checkedAt,
    status,
    probes,
    overallMs,
  });
  // Persist every run (not only transitions) so P50/P90 are real probe timings.
  await persistProbeSample(sample);

  // Read prior state (KV — survives a Supabase outage).
  let prev: Status = 'healthy';
  try {
    prev = ((await kv.get<Status>(STATE_KEY)) as Status) || 'healthy';
  } catch { /* KV down — treat as healthy baseline, still evaluate current */ }

  const transitioned = status !== prev;
  let alerted = false;

  if (transitioned) {
    // Rate-limit: at most one transition email per cooldown window.
    let lastAlertMs = 0;
    try {
      const last = await kv.get<string>(LAST_ALERT_KEY);
      if (last) lastAlertMs = new Date(last).getTime();
    } catch { /* ignore */ }
    const now = Date.now();
    const worsened = rank(status) > rank(prev);
    const recovered = status === 'healthy' && prev !== 'healthy';

    if ((worsened || recovered) && now - lastAlertMs > ALERT_COOLDOWN_MS) {
      try {
        // Ops alerts go to SLACK, not email (Eric moved all internal ops/health
        // notifications off email onto Slack 2026-07-01 — the outage detector must
        // land in the channel he actually watches). sendOpsAlert is a drop-in for
        // sendEmail; `to` is ignored.
        await sendOpsAlert({
          to: ALERT_TO,
          subject: buildAlertSubject(status, prev, checkedAt),
          html: buildAlertHtml(status, prev, probes),
        });
        alerted = true;
        await kv.set(LAST_ALERT_KEY, checkedAt);
      } catch (err) {
        console.error('[db-health-watch] Slack alert failed:', (err as Error).message);
      }
    }
    try { await kv.set(STATE_KEY, status); } catch { /* ignore */ }
  }

  return NextResponse.json({
    status,
    prev,
    transitioned,
    alerted,
    probes,
    timings: {
      reachability_ms: sample.reachability_ms,
      alert_count_ms: sample.alert_count_ms,
      pg_stats_ms: sample.pg_stats_ms,
      overall_ms: sample.overall_ms,
    },
    checkedAt,
  });
}

function rank(s: Status): number {
  return s === 'down' ? 2 : s === 'degraded' ? 1 : 0;
}
