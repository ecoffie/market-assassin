/**
 * Heal user_pipeline.value_estimate rows polluted with display labels.
 *
 * Built 2026-05-26 after audit found DashboardPanel was writing
 * item.amount (a display string like "Due in 6 days" or "Open market
 * research window...") into the value_estimate column instead of a
 * dollar amount. The bad write path is fixed in code; this endpoint
 * cleans the historical rows by nulling out non-dollar values.
 *
 * Same admin auth pattern as heal-pursuit-notice-ids — preview mode
 * shows what WOULD change, execute mode actually clears them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isCleanValueEstimate } from '@/lib/pipeline/value-estimate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

async function handle(request: NextRequest, execute: boolean) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== (process.env.ADMIN_PASSWORD)) {
    return unauthorized();
  }

  const supabase = getSupabase();

  // Scan all non-null value_estimate rows. Cap at 5000 for safety.
  const { data, error } = await supabase
    .from('user_pipeline')
    .select('id, user_email, title, value_estimate, source')
    .not('value_estimate', 'is', null)
    .limit(5000);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const polluted = (data || []).filter((r: { value_estimate: string }) => !isCleanValueEstimate(r.value_estimate));

  const bySource: Record<string, number> = {};
  polluted.forEach((r: { source: string | null }) => {
    const s = r.source || '(null)';
    bySource[s] = (bySource[s] || 0) + 1;
  });

  if (!execute) {
    return NextResponse.json({
      success: true,
      mode: 'preview',
      scanned: data?.length || 0,
      polluted: polluted.length,
      bySource,
      sample: polluted.slice(0, 25).map((r: { id: string; title: string; value_estimate: string; source: string | null }) => ({
        id: r.id,
        title: r.title?.slice(0, 80),
        bad_value: r.value_estimate?.slice(0, 80),
        source: r.source,
      })),
    });
  }

  // Execute: null out value_estimate for polluted rows. Done in
  // batches to keep payloads small.
  const ids: string[] = polluted.map((r: { id: string }) => r.id);
  const BATCH = 200;
  let updated = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    const { error: updErr } = await supabase
      .from('user_pipeline')
      .update({ value_estimate: null, updated_at: new Date().toISOString() })
      .in('id', slice);
    if (updErr) {
      return NextResponse.json({
        success: false,
        error: updErr.message,
        updated_so_far: updated,
      }, { status: 500 });
    }
    updated += slice.length;
  }

  return NextResponse.json({
    success: true,
    mode: 'execute',
    scanned: data?.length || 0,
    cleared: updated,
    bySource,
  });
}

// GET = preview (safe)
export async function GET(request: NextRequest) {
  return handle(request, false);
}

// POST = execute (writes)
export async function POST(request: NextRequest) {
  return handle(request, true);
}
