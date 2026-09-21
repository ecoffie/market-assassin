import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { DATA_VERSION } from '@/lib/bigquery/cache';
import {
  acquireLock, releaseLock, readUpstreamSourceAsOf, readLiveSourceAsOf,
  evaluateFreshness, alert, UPSTREAM_STALE_DAYS,
  type RefreshOutcome, type RefreshTelemetry,
} from '@/lib/awards-refresh';
import { enqueueBuild, alertOnStuckJobs, alertOnFailedJobs } from '@/lib/awards-build-jobs';

/**
 * Durable awards refresh cron.
 *
 * Run daily. The FRESHNESS GATE means most days are a near-free no-op: a single
 * aggregate against BigQuery to ask "did upstream advance?", and if it did not,
 * nothing is rebuilt. The paid rebuild (~$0.11, 23k row rewrite) happens only when
 * upstream genuinely has data the live generation lacks.
 *
 * ?dry=1  — run every read-only step (lock, freshness, decision) and report what
 *           it WOULD do, without building or promoting.
 *
 * Auth: Vercel cron Bearer CRON_SECRET, or ?password= for manual runs.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 55; // check only — the worker owns the long build

function authed(req: NextRequest): boolean {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return verifyAdminPassword(req.nextUrl.searchParams.get('password'));
}

interface BuiltRow {
  recipient_uei: string; page_number: number;
  contract_count: number; displayed_action_count: number; total_action_count: number;
  displayed_obligated: number; source_as_of: { value: string } | string | null;
  awards: Record<string, unknown>[];
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const t0 = Date.now();
  const token = randomUUID();
  // A distinct staging version so a failed build can never be mistaken for, or
  // promoted alongside, the live generation.
  const stagingVersion = `${DATA_VERSION}-staging-${Date.now()}`;

  const tel: RefreshTelemetry = {
    outcome: 'failed-build', durationMs: 0, bytesBilled: null,
    upstreamSourceAsOf: null, liveSourceAsOf: null, upstreamAgeDays: null,
    recipients: null, pages: null, rows: null,
  };
  const finish = (outcome: RefreshOutcome, detail?: string, status = 200) => {
    tel.outcome = outcome; tel.durationMs = Date.now() - t0; if (detail) tel.detail = detail;
    console.log('[awards-refresh]', JSON.stringify(tel));
    return NextResponse.json(tel, { status, headers: { 'Cache-Control': 'no-store' } });
  };

  // ── 1. LOCK ───────────────────────────────────────────────────────────────
  let locked = false;
  try {
    locked = await acquireLock(token);
    if (!locked) {
      // Not an error: a previous run is still going. Exit cleanly rather than
      // racing it — two concurrent builds would fight over the staging version.
      return finish('skipped-locked', 'another run holds the lock');
    }

    // Watchdogs run every check — a stuck or failed job is silent by nature.
    await alertOnStuckJobs();
    await alertOnFailedJobs();

    // ── 2. UPSTREAM SOURCE DATE ─────────────────────────────────────────────
    const upstream = await readUpstreamSourceAsOf();
    const live = await readLiveSourceAsOf();
    tel.upstreamSourceAsOf = upstream.date;
    tel.upstreamAgeDays = upstream.ageDays;
    tel.liveSourceAsOf = live;

    // ── 3. FRESHNESS GATE ───────────────────────────────────────────────────
    const fresh = evaluateFreshness(upstream.date, live, upstream.ageDays);

    // Upstream staleness is INDEPENDENT of whether we rebuild. Both can be true:
    // upstream may be newer than live yet itself weeks behind, which means
    // rebuild AND report the ingest problem to whoever owns it.
    if (fresh.upstreamStale) {
      await alert(
        'Awards upstream data is stale',
        `<p>BigQuery's newest <code>action_date</code> is <b>${upstream.date}</b>, ` +
          `<b>${upstream.ageDays} days</b> old (threshold ${UPSTREAM_STALE_DAYS}).</p>` +
          `<p>This is an <b>ingest</b> problem, not a refresh problem — the refresh cron can only ` +
          `serve what upstream holds. Serving pages will be rebuilt to ${upstream.date} if newer ` +
          `than live (${live ?? 'none'}), but cannot become fresher than the source.</p>`,
      );
    }

    if (!fresh.shouldRebuild) {
      // The money-saving path. Most days land here.
      return finish('noop-upstream-not-newer', fresh.reason);
    }

    if (dry) {
      return finish('success', `DRY RUN — would enqueue a build: ${fresh.reason}`);
    }

    // ── 4. ENQUEUE, DO NOT BUILD ────────────────────────────────────────────
    // The rebuild takes ~4 minutes and the dispatcher allows 55 seconds. Building
    // inline would either be cut off mid-flight or force a timeout increase that
    // hides the mismatch — and a terminated request loses the work entirely.
    // The job row is the durable handoff; the worker picks it up.
    const sourceVersion = upstream.date!;
    const { job, created, error: enqErr } = await enqueueBuild(sourceVersion);
    if (enqErr || !job) {
      await alert('Awards refresh could not enqueue a build', `<pre>${enqErr ?? 'unknown'}</pre>`);
      return finish('failed-build', enqErr ?? 'enqueue failed', 500);
    }

    // Idempotent: a second check on the same upstream version finds the existing
    // job rather than queueing a duplicate build.
    if (!created) {
      return finish(
        'noop-upstream-not-newer',
        `build for source ${sourceVersion} already exists (job ${job.id}, status ${job.status})`,
      );
    }

    tel.detail = `enqueued job ${job.id} for source ${sourceVersion}`;
    tel.outcome = 'success';
    tel.durationMs = Date.now() - t0;
    console.log('[awards-refresh]', JSON.stringify(tel));
    // 202: accepted, not completed. The worker does the work.
    return NextResponse.json(tel, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await alert('Awards refresh threw', `<pre>${msg.slice(0, 500)}</pre>`);
    return finish('failed-build', msg.slice(0, 200), 500);
  } finally {
    // ── 10. RELEASE ────────────────────────────────────────────────────────
    if (locked) await releaseLock(token);
  }
}
