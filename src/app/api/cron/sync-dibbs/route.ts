/**
 * Cron: sync DLA DIBBS RFQs via the Apify actor. Steady-state refresh of recent
 * small-buy solicitations into dibbs_rfqs. Schedule via cron_jobs row (rule #5).
 * Needs a VALID paid-tier APIFY_TOKEN — note a dead token still reads as
 * `present:true` to Vercel's env check, so verify with
 * `GET https://api.apify.com/v2/users/me` (that 401 was the whole Jul-2026 outage).
 *   GET /api/cron/sync-dibbs?maxItems=2500&daysBack=2
 *
 * Tuning (2026-07-28): maxItems 1000 → 2500 and the cron row moved daysBack 7 → 2.
 * DLA posts ~400–800 new RFQs/weekday, so 1000 truncated on busy days; and daysBack=7
 * spent most of each run re-walking a week of index files it already had. The response
 * now reports `truncated` and `starved` so neither failure hides behind success:true.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ingestDibbs } from '@/lib/dibbs/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!process.env.APIFY_TOKEN) {
    return NextResponse.json({ success: false, error: 'APIFY_TOKEN not set — DIBBS pilot disabled' }, { status: 503 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Accumulate pattern (like the SAM cache): pull wide, upsert into the durable
  // table, dedupe by solicitation_number. Default to a big maxItems + ALL available
  // files (daysBack omitted) so the table grows instead of tracking a rolling window.
  // Pass ?daysBack=N to narrow; ?maxItems=N to cap.
  // Cap raised 1000 → 2500 (2026-07-28). MEASURED: DLA posts ~400–800 new RFQs on a normal
  // weekday (from raw.indexFileDate: Jul 22 = 433, Jul 24 = 260, Jul 26 = 664/520-unique),
  // and the actor returns ~22% duplicates across index files. At the old 1000 cap a busy day
  // TRUNCATED — silently, since a capped run looks like a successful one. 2500 clears the
  // observed ceiling with headroom. Bounded by maxDuration=120s above, not by this number:
  // a 5000-item pull measured ~40s locally, so 2500 has ample budget.
  const maxItems = Math.min(parseInt(request.nextUrl.searchParams.get('maxItems') || '2500', 10), 2500);
  const daysBackParam = request.nextUrl.searchParams.get('daysBack');
  const daysBack = daysBackParam == null ? null : Math.min(parseInt(daysBackParam, 10), 30);
  try {
    const result = await ingestDibbs(supabase, { maxItems, daysBack });
    // Two silent-failure modes this surfaces, because BOTH previously returned success:true
    // and looked identical to a healthy run in the cron_jobs row:
    //  • truncated — hit maxItems exactly, so current RFQs were left unfetched.
    //  • starved   — the DIBBS WAF throttled the residential proxy mid-scrape, so the actor
    //    commits ~1 item. This is what made Jul 9–15 look like 7 successful runs while the
    //    table gained 1–2 rows/day. Do NOT retry into it; back off for hours.
    const truncated = result.fetched >= maxItems;
    const starved = result.fetched <= 1;
    if (truncated) console.warn(`[sync-dibbs] TRUNCATED at maxItems=${maxItems} — more current RFQs exist; the daily run will accumulate the rest via dedupe.`);
    if (starved) console.error(`[sync-dibbs] STARVED: fetched only ${result.fetched} — the DIBBS WAF is likely throttling the proxy. Do NOT retry/burst; back off for hours.`);
    return NextResponse.json({
      success: true, ...result, truncated, starved,
      message: `DIBBS: fetched ${result.fetched}, upserted ${result.upserted}${truncated ? ' (TRUNCATED)' : ''}${starved ? ' (STARVED — proxy likely throttled)' : ''}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DIBBS sync failed';
    console.error('[sync-dibbs]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
