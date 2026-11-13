/**
 * /api/cron/seo-lookup-demand — persists one day of SEO cold-lookup usage (2026-11-13).
 *
 * The per-day budget counters in KV expire after ~26h, so trends were unmeasurable. Scheduled
 * daily at 23:55 UTC through the cron_jobs dispatcher, this reads the day's metrics
 * (src/lib/seo/lookup-metrics.ts) for award, contractor and contract-page lookups, plus the
 * contractor warming queue, and stores them in data_sources row `seo_lookup_demand` (rolling 60
 * days, one entry per date; a re-run replaces that date). Read-only toward KV; no BigQuery.
 *
 * ?date=YYYY-MM-DD records another day (only while its keys still exist). Auth: Bearer
 * CRON_SECRET, or the admin password with ?password= for a manual run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';
import { authorizeCronRequest } from '@/lib/cron/cron-request-auth';
import { readKindDay, utcDay, mergeDemandHistory, DEMAND_OPEN as OPEN, DEMAND_CLOSE as CLOSE, type LookupKind } from '@/lib/seo/lookup-metrics';
import { awardColdDailyLimit } from '@/lib/seo/award-cold-budget';
import { seoColdDailyLimit } from '@/lib/seo/seo-unavailable';
import { WARM_PRIORITY_KEY, WARM_PRIORITY_DAILY_CAP, warmDailyKey } from '@/lib/seo/warm-priority';
import { WARM_QUEUE_KEY } from '@/lib/seo/served-slugs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY = 'seo_lookup_demand';


async function handle(request: NextRequest) {
  const auth = await authorizeCronRequest(request, { isTest: request.nextUrl.searchParams.has('password') });
  if (!auth.ok) return auth.response;
  const date = request.nextUrl.searchParams.get('date') ?? utcDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'bad date' }, { status: 400 });

  const kinds: LookupKind[] = ['award', 'contractor', 'contracts'];
  const [award, contractor, contracts] = await Promise.all(kinds.map((k) => readKindDay(k, date)));
  const entry = {
    date,
    recordedAt: new Date().toISOString(),
    award: { ...award, limit: awardColdDailyLimit() },
    contractor: { ...contractor, limit: seoColdDailyLimit('contractor') },
    contracts: { ...contracts, limit: seoColdDailyLimit('contracts') },
    warming: {
      priorityWarmed: Number((await kv.get<number>(warmDailyKey(date))) ?? 0),
      priorityDailyCap: WARM_PRIORITY_DAILY_CAP,
      priorityQueueDepth: await kv.zcard(WARM_PRIORITY_KEY),
      legacyQueueDepth: await kv.scard(WARM_QUEUE_KEY),
    },
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ success: false, error: 'no Supabase env', entry }, { status: 500 });
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: existing, error: readErr } = await db.from('data_sources').select('id, notes').eq('key', KEY).limit(1).maybeSingle();
  if (readErr) return NextResponse.json({ success: false, error: readErr.message, entry }, { status: 500 });
  const history = mergeDemandHistory(existing?.notes, entry);
  const row = {
    key: KEY, name: 'SEO cold-lookup demand (daily)', category: 'live_api', built_from: 'KV budget metrics',
    refresh_cadence: 'daily 23:55 UTC',
    notes: `Daily award / contractor / contract-page cold-lookup usage vs budgets, plus the contractor warming queue (/api/cron/seo-lookup-demand).\n\n${OPEN}\n${JSON.stringify({ history })}\n${CLOSE}`,
    last_built: date, record_count: history.length, updated_at: new Date().toISOString(),
  };
  const { error } = existing
    ? await db.from('data_sources').update(row).eq('id', existing.id)
    : await db.from('data_sources').insert(row);
  if (error) return NextResponse.json({ success: false, error: error.message, entry }, { status: 500 });
  return NextResponse.json({ success: true, entry, days: history.length });
}

export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
