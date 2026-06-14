/**
 * Getting Started journey progress.
 *
 *   GET   ?email=                          → load progress (creates the row on
 *                                            first hit so created_at anchors the
 *                                            14-day forced-landing window)
 *   PATCH {journey?, done?, dismiss?}      → mark a journey done / dismiss the card
 *
 * Backs the in-app guided journeys (docs/PLAN-mindy-guided-journeys.md). Auth via
 * the standard MI session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { JOURNEYS, type JourneyKey } from '@/lib/journeys/definitions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

const PROGRESS_COLS = 'profile_done, customers_done, bid_done, card_dismissed, created_at';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const sb = getSupabase();
  let { data } = await sb.from('mindy_journey_progress').select(PROGRESS_COLS).eq('user_email', email).maybeSingle();
  if (!data) {
    // First visit — create the row so created_at anchors the 14-day window.
    const { data: created } = await sb
      .from('mindy_journey_progress')
      .insert({ user_email: email })
      .select(PROGRESS_COLS)
      .maybeSingle();
    data = created || { profile_done: false, customers_done: false, bid_done: false, card_dismissed: false, created_at: new Date().toISOString() };
  }
  return NextResponse.json({ success: true, progress: data });
}

export async function PATCH(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  let body: { journey?: JourneyKey; done?: boolean; dismiss?: boolean };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }

  const update: Record<string, unknown> = { user_email: email, updated_at: new Date().toISOString() };
  if (body.journey) {
    const def = JOURNEYS.find((j) => j.key === body.journey);
    if (!def) return NextResponse.json({ success: false, error: 'Unknown journey' }, { status: 400 });
    update[def.doneField] = body.done !== false; // default to marking done
  }
  if (typeof body.dismiss === 'boolean') update.card_dismissed = body.dismiss;

  if (Object.keys(update).length <= 2) {
    return NextResponse.json({ success: false, error: 'Nothing to update (send journey or dismiss)' }, { status: 400 });
  }

  // Upsert so a PATCH before the GET-created row still works.
  const { error } = await getSupabase().from('mindy_journey_progress').upsert(update, { onConflict: 'user_email' });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
