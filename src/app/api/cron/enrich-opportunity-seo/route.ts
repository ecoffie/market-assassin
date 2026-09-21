/**
 * Cron: AI-enrich active opportunities for the public /opportunity/[slug] pages.
 * Steady-state handler — keeps NEW opps enriched as they sync. The one-time bulk
 * drain of the backlog is a local tsx runner (rule #7): scripts/drain-seo-enrich.ts.
 *
 * Schedule via cron_jobs INSERT (not vercel.json — rule #5). Resumable via
 * seo_enriched_at. Bulk = cheap models (job:'extraction', no Claude).
 *   GET /api/cron/enrich-opportunity-seo?limit=25
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { enrichOppBatch } from '@/lib/seo/enrich';
import { reportCronOutcome } from '@/lib/cron-self-report';

// Fired by exactly ONE cron_jobs row.
const CRON_JOB_NAME = 'enrich-opportunity-seo';

// ⚠️ This route has NO auth guard (pre-existing — it is publicly reachable), so the
// terminal self-report is gated on the dispatcher's own `x-cron-dispatch` header.
// Without that gate a passer-by could stamp a status on a scheduled job it never ran.
// The missing auth itself is out of scope here and NOT fixed.
function isDispatcherFire(request: NextRequest): boolean {
  return request.headers.get('x-cron-dispatch') === '1';
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });

  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') || '25', 10), 60);
  try {
    const result = await enrichOppBatch(supabase, limit);
    // TERMINAL SELF-REPORT. Every one of this job's 628 runs in the preceding 30
    // days was recorded `dispatched` with http_status NULL: the batch is an LLM
    // loop that always outlives the dispatcher's 12s ack, so the 200 below is
    // written to a closed connection and no run had ANY completion evidence.
    //
    // EXECUTION vs ADVANCEMENT stay separate. A batch that claimed rows and wrote
    // ZERO summaries ran to completion but moved nothing — that is `partial`, not
    // success, because generateOppSummary swallows provider failures to null and a
    // dead LLM key would otherwise look identical to a healthy run. An EMPTY queue
    // (processed 0) is a genuine success: there was nothing to advance.
    if (isDispatcherFire(request)) await reportCronOutcome(
      CRON_JOB_NAME,
      result.processed > 0 && result.written === 0 ? 'partial' : 'success',
      result.processed > 0 && result.written === 0
        ? `0 summaries written from ${result.processed} claimed rows`
        : undefined,
    );
    return NextResponse.json({
      success: true,
      ...result,
      message: result.remaining
        ? `${result.processed} processed (${result.written} summaries); ${result.remaining} remaining`
        : 'SEO enrichment complete for active opps',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'enrich failed';
    console.error('[enrich-opportunity-seo]', message);
    if (isDispatcherFire(request)) await reportCronOutcome(CRON_JOB_NAME, 'error', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
