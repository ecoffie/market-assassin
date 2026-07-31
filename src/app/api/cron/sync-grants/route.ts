/**
 * Cron: refresh Grants.gov opportunities into grants_cache (the Grants layer of the Opportunity
 * Map). Steady-state daily re-pull of the ACTIONABLE statuses (posted + forecasted) so the map
 * stays current as grants open, close, and get forecasted. Schedule via a cron_jobs row (rule #5,
 * NOT vercel.json) — deploy the route FIRST, curl it 200 on prod, THEN insert the row.
 *   GET /api/cron/sync-grants           (auth: ?password=ADMIN_PASSWORD  OR  Bearer CRON_SECRET)
 *
 * Wraps the SHARED ingestGrants() core (src/lib/grants/ingest.ts) — the exact fn the local runner
 * (scripts/ingest-grants.ts) calls, so cron and script can't drift. Upserts on opp_number
 * (accumulate pattern); the expired-posted-grant pruning happens at READ time in
 * getGrantsViewportPins (close_date filter), so this sync just keeps the corpus fresh.
 *
 * FREE API (no key, no per-call cost — unlike sync-dibbs), so no money-guard urgency; auth still
 * required so a random caller can't hammer Grants.gov through us. Fast (~1,700 rows, ~few s), well
 * under maxDuration.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ingestGrants } from '@/lib/grants/ingest';
import { reportCronOutcome } from '@/lib/cron-self-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  const isAuthorized =
    (!!process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) ||
    (!!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET);
  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  try {
    const r = await ingestGrants(supabase);

    // A run that fetched ZERO grants but did not error is a silent-failure red flag (Grants.gov
    // always has ~1,200+ posted). Surface it as an error so the dispatcher records it + the watchdog
    // sees it, rather than a green 200 that hides a broken upstream. `degraded` (partial fetch) is a
    // 200 — the next run finishes it via upsert/dedupe, same as sync-dibbs' `truncated`.
    if (r.fetched === 0) {
      await reportCronOutcome('sync-grants', 'error', 'STARVED: fetched 0 grants (Grants.gov empty/blocked)');
      return NextResponse.json({ success: false, error: 'STARVED: fetched 0 grants', ...r }, { status: 500 });
    }

    // `degraded` (a partial fetch) is still a SUCCESS — the next daily run finishes it via
    // upsert/dedupe (same as sync-dibbs' `truncated`). Only a 0-fetch is an error (handled above).
    await reportCronOutcome('sync-grants', 'success');
    return NextResponse.json({ success: true, ...r });
  } catch (e) {
    const msg = (e as Error).message;
    await reportCronOutcome('sync-grants', 'error', msg).catch(() => {});
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
