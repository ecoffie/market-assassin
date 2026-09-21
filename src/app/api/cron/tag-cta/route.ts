/**
 * Cron: tag SAM opportunities with DoD Critical Technology Areas.
 *
 * Rules-based (NAICS + keyword). Resumable via sam_opportunities.cta_tagged_at.
 * Schedule via cron_jobs INSERT (not vercel.json). Manual:
 *   GET /api/cron/tag-cta?limit=500
 *   GET /api/cron/tag-cta?limit=500&activeOnly=false  (include inactive corpus)
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { tagCtaBatch } from '@/lib/cta/tagger';
import { reportCronOutcome } from '@/lib/cron-self-report';

// Fired by exactly ONE cron_jobs row.
const CRON_JOB_NAME = 'tag-cta';

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
  if (!supabase) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
  }

  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get('limit') || '100', 10),
    500,
  );
  const activeOnly = request.nextUrl.searchParams.get('activeOnly') !== 'false';

  try {
    const result = await tagCtaBatch(supabase, { limit, activeOnly });
    // TERMINAL SELF-REPORT. 212 of 628 runs in the preceding 30 days were recorded
    // `dispatched` with http_status NULL — the batch outruns the dispatcher's 12s ack on
    // roughly a third of fires, so a third of runs had no completion evidence.
    //
    // EXECUTION vs ADVANCEMENT: a run that had rows left (`remaining`) but tagged NONE
    // completed without moving the queue — partial. A drained queue (remaining 0,
    // processed 0) is a real success.
    await reportCronOutcome(
      CRON_JOB_NAME,
      result.processed === 0 && Boolean(result.remaining) ? 'partial' : 'success',
      result.processed === 0 && Boolean(result.remaining)
        ? `0 tagged with ${result.remaining} still queued`
        : undefined,
    );
    return NextResponse.json({
      success: true,
      ...result,
      message: result.remaining
        ? `${result.processed} tagged; ${result.remaining} remaining`
        : 'CTA tagging complete for selected scope',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CTA tagger failed';
    console.error('[tag-cta]', message);
    await reportCronOutcome(CRON_JOB_NAME, 'error', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
