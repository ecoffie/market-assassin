/**
 * Admin: reset an account to the FRESH NEW-USER state so you can verify the real
 * first-run experience (Eric, Jun 2026: "I want to see what new users see").
 *
 * Clears the new-user SIGNALS without deleting the account/login:
 *   - user_notification_settings targeting: naics_codes, psc_codes, keywords,
 *     agencies, location_states, business_type → empty (so onboarding/checklist
 *     read "nothing set yet")
 *   - mindy_journey_progress → profile_done/customers_done/bid_done = false,
 *     card_dismissed = false (so the Getting Started journeys + Start Here card show)
 *
 * Does NOT touch: the Supabase auth user, My Target List (user_target_list),
 * pipeline, library — those are real work, not signals. (Pass ?wipeTargets=1 to
 * also clear the target list if you want a TRULY blank slate.)
 *
 * The "Start Here" card also has a localStorage dismiss flag (mindy_start_here_
 * dismissed) — clear it in the browser console: localStorage.removeItem(
 * 'mindy_start_here_dismissed'), or just use an incognito window.
 *
 * GET  ?password=...&email=...            → preview what would be cleared
 * POST ?password=...&email=...&mode=execute[&wipeTargets=1] → do it
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const email = (request.nextUrl.searchParams.get('email') || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });
  const supabase = sb();
  const { data: cur } = await supabase
    .from('user_notification_settings')
    .select('naics_codes, psc_codes, keywords, agencies, location_states, business_type')
    .eq('user_email', email).maybeSingle();
  return NextResponse.json({
    success: true,
    wouldClear: cur || null,
    note: 'POST ?mode=execute to reset to new-user. Add &wipeTargets=1 to also clear My Target List. Then clear localStorage mindy_start_here_dismissed (or use incognito).',
  });
}

export async function POST(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  if (p.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (p.get('mode') !== 'execute') {
    return NextResponse.json({ success: false, error: 'pass ?mode=execute to run' }, { status: 400 });
  }
  const email = (p.get('email') || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });
  const supabase = sb();
  const did: string[] = [];

  // 1. Clear targeting signals (keep the row + account).
  const { error: nsErr } = await supabase.from('user_notification_settings').update({
    naics_codes: [], psc_codes: [], keywords: [], agencies: [], location_states: [],
    business_type: null, updated_at: new Date().toISOString(),
  }).eq('user_email', email);
  did.push(nsErr ? `notification_settings: ${nsErr.message}` : 'notification_settings cleared');

  // 2. Reset journeys + un-dismiss the Getting Started card.
  const { error: jErr } = await supabase.from('mindy_journey_progress').upsert({
    user_email: email, profile_done: false, customers_done: false, bid_done: false,
    card_dismissed: false,
  }, { onConflict: 'user_email' });
  did.push(jErr ? `journey_progress: ${jErr.message}` : 'journey_progress reset');

  // 3. Optional: wipe My Target List for a truly blank slate.
  if (p.get('wipeTargets') === '1') {
    const { error: tErr } = await supabase.from('user_target_list').delete().eq('user_email', email);
    did.push(tErr ? `target_list: ${tErr.message}` : 'target_list wiped');
  }

  return NextResponse.json({
    success: true,
    email,
    did,
    nextStep: 'In your browser: localStorage.removeItem("mindy_start_here_dismissed") then hard-refresh — or open an incognito window. You now see the new-user first run.',
  });
}
