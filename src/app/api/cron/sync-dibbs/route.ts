/**
 * Cron: sync DLA DIBBS RFQs via the Apify actor (pilot). Steady-state refresh of
 * recent small-buy solicitations into dibbs_rfqs. Schedule via cron_jobs row (rule
 * #5). Needs APIFY_TOKEN. Gated off until the token + EULA check are in place.
 *   GET /api/cron/sync-dibbs?maxItems=200&daysBack=7
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

  const maxItems = Math.min(parseInt(request.nextUrl.searchParams.get('maxItems') || '200', 10), 1000);
  const daysBack = Math.min(parseInt(request.nextUrl.searchParams.get('daysBack') || '7', 10), 30);
  try {
    const result = await ingestDibbs(supabase, { maxItems, daysBack });
    return NextResponse.json({ success: true, ...result, message: `DIBBS: fetched ${result.fetched}, upserted ${result.upserted}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DIBBS sync failed';
    console.error('[sync-dibbs]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
