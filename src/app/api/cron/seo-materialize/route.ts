/**
 * /api/cron/seo-materialize — keeps the public SEO summaries materialized (2026-11-12).
 *
 * Three public pages read pre-built data from KV and must never compute it on a request:
 *   - /forecasts      ← seo:forecast-summary:v1   (Supabase agency_forecasts, ~37 pages of 8 cols)
 *   - /awards latest  ← awards:latest:50          (BigQuery, ~10-15 GB scan)
 *   - /awards largest ← awards:largest:50         (BigQuery, ~17 GB scan)
 * Nothing scheduled any of them. Found 2026-11-12: all three KV keys were absent, so /forecasts
 * noindexed itself and /awards rendered two empty tables. This job is their only writer.
 *
 * Cost: the forecast build is Supabase-only. The award lists run under maximumBytesBilled
 * (20 GiB each): "latest" refreshes every run (it is a freshness list); "largest" only when
 * missing (an all-time list; its KV TTL is 90 days and DATA_VERSION bumps orphan it).
 *
 * A step that fails leaves the previous value in place and reports ok:false — the watchdog sees
 * last_status=error. A truncated forecast build is never written over a good one.
 *
 * BIGQUERY GUARDS (this route is the only live path to two 10-17 GB scans):
 *   - Auth: Bearer CRON_SECRET (the dispatcher) or ?password=ADMIN_PASSWORD (manual). NOT the
 *     `x-vercel-cron` header: any client can send it, and accepting it would let anyone trigger
 *     the scans on demand.
 *   - Concurrency: a KV lock (SET NX, 10 min). An overlapping run returns 409 without querying.
 *     If KV is unreachable the lock cannot be taken and the run refuses (fails closed).
 *   - Frequency: "latest" re-scans at most once per 20h (KV timestamp) unless ?force=1;
 *     "largest" only when its key is missing. Worst case ≈ one ~15 GB scan/day plus a ~17 GB
 *     scan per DATA_VERSION bump, each capped by maximumBytesBilled (20 GiB).
 *
 * Schedule: a `cron_jobs` row (daily), inserted only after this route is live and verified.
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';
import { FORECAST_SUMMARY_KEY } from '@/lib/seo/forecasts-summary';
import { buildForecastSummary, FORECAST_SUMMARY_TTL_SECONDS } from '@/lib/seo/forecast-summary-builder';
import { getLatestAwards, getLargestAwards, awardListKey } from '@/lib/bigquery/awards';
import { bqUnavailable } from '@/lib/bigquery/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const auth = request.headers.get('authorization');
  if (auth && process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const pw = request.nextUrl.searchParams.get('password');
  return !!pw && !!process.env.ADMIN_PASSWORD && pw === process.env.ADMIN_PASSWORD;
}

type Step = { ok: boolean; detail: string };

async function forecasts(): Promise<Step> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, detail: 'no Supabase credentials' };
  const summary = await buildForecastSummary(createClient(url, key, { auth: { persistSession: false } }));
  if (summary.truncated) return { ok: false, detail: `truncated build (total ${summary.total}); previous summary kept` };
  await kv.set(FORECAST_SUMMARY_KEY, summary, { ex: FORECAST_SUMMARY_TTL_SECONDS });
  return { ok: true, detail: `${summary.total} forecasts, ${summary.agencies.length} agencies` };
}

const LOCK_KEY = 'cron:seo-materialize:lock';
const LATEST_AT_KEY = 'cron:seo-materialize:latest-at';
const LATEST_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;

async function awardList(kind: 'latest' | 'largest', force: boolean): Promise<Step> {
  const cacheKey = awardListKey(kind, 50);
  const read = kind === 'latest' ? getLatestAwards : getLargestAwards;
  const cached = await read(50); // cache-only probe, zero BigQuery
  if (cached.length > 0 && kind === 'largest') {
    return { ok: true, detail: `cached (${cached.length} rows), not rebuilt` };
  }
  if (cached.length > 0 && kind === 'latest' && !force) {
    const last = Number(await kv.get<number>(LATEST_AT_KEY)) || 0;
    if (Date.now() - last < LATEST_MIN_INTERVAL_MS) {
      return { ok: true, detail: `fresh (${cached.length} rows, refreshed ${Math.round((Date.now() - last) / 3.6e6)}h ago), not rebuilt` };
    }
  }
  const rows = await read(50, { liveBq: true, forceRefresh: true });
  if (rows.length === 0 && bqUnavailable(cacheKey, 0)) return { ok: false, detail: 'BigQuery read failed; previous value kept' };
  if (kind === 'latest' && rows.length > 0) await kv.set(LATEST_AT_KEY, Date.now());
  return { ok: rows.length > 0, detail: `${rows.length} rows` };
}

async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const force = request.nextUrl.searchParams.get('force') === '1';

  // One run at a time. SET NX with a TTL so a crashed run cannot hold the lock forever.
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let locked = false;
  try {
    locked = (await kv.set(LOCK_KEY, token, { nx: true, ex: 600 })) === 'OK';
  } catch (err) {
    return NextResponse.json({ success: false, error: `lock unavailable (KV): ${err instanceof Error ? err.message : err}` }, { status: 503 });
  }
  if (!locked) return NextResponse.json({ success: false, error: 'another run is in progress' }, { status: 409 });
  try {
    return await runAll(force);
  } finally {
    try { if ((await kv.get<string>(LOCK_KEY)) === token) await kv.del(LOCK_KEY); } catch { /* TTL releases it */ }
  }
}

async function runAll(force: boolean) {
  const run = async (name: string, fn: () => Promise<Step>): Promise<[string, Step]> => {
    try { return [name, await fn()]; } catch (err) {
      return [name, { ok: false, detail: err instanceof Error ? err.message : String(err) }];
    }
  };
  const steps = Object.fromEntries(await Promise.all([
    run('forecasts', forecasts),
    run('awardsLatest', () => awardList('latest', force)),
    run('awardsLargest', () => awardList('largest', force)),
  ]));
  if (steps.forecasts.ok) revalidatePath('/forecasts');
  if (steps.awardsLatest.ok || steps.awardsLargest.ok) revalidatePath('/awards');
  const ok = Object.values(steps).every((s) => s.ok);
  return NextResponse.json({ success: ok, steps }, { status: ok ? 200 : 500 });
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
