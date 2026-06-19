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
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
