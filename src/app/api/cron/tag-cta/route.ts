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
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
