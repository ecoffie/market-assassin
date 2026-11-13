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
 * Schedule: a `cron_jobs` row (daily), inserted only after this route is live and verified.
 * Auth: Bearer CRON_SECRET (dispatcher), x-vercel-cron, or ?password=ADMIN_PASSWORD (manual).
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
  if (request.headers.get('x-vercel-cron') === '1') return true;
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

async function awardList(kind: 'latest' | 'largest'): Promise<Step> {
  const cacheKey = awardListKey(kind, 50);
  const read = kind === 'latest' ? getLatestAwards : getLargestAwards;
  if (kind === 'largest') {
    const cached = await read(50); // cache-only probe: an all-time list only needs building once
    if (cached.length > 0) return { ok: true, detail: `cached (${cached.length} rows), not rebuilt` };
  }
  const rows = await read(50, { liveBq: true, forceRefresh: true });
  if (rows.length === 0 && bqUnavailable(cacheKey, 0)) return { ok: false, detail: 'BigQuery read failed; previous value kept' };
  return { ok: rows.length > 0, detail: `${rows.length} rows` };
}

async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const run = async (name: string, fn: () => Promise<Step>): Promise<[string, Step]> => {
    try { return [name, await fn()]; } catch (err) {
      return [name, { ok: false, detail: err instanceof Error ? err.message : String(err) }];
    }
  };
  const steps = Object.fromEntries(await Promise.all([
    run('forecasts', forecasts),
    run('awardsLatest', () => awardList('latest')),
    run('awardsLargest', () => awardList('largest')),
  ]));
  if (steps.forecasts.ok) revalidatePath('/forecasts');
  if (steps.awardsLatest.ok || steps.awardsLargest.ok) revalidatePath('/awards');
  const ok = Object.values(steps).every((s) => s.ok);
  return NextResponse.json({ success: ok, steps }, { status: ok ? 200 : 500 });
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
