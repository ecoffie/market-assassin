// Admin endpoint to grant / revoke Mindy Team Access.
//
// Team Access (the "seats + roles" panel) is gated on
// user_profiles.access_team. When true, verifyMIAccess() returns tier 'team'
// and the Team Access sidebar item (tier ['team','enterprise']) appears.
//
// Standard admin contract:
//   GET  ?password=...&email=...           → PREVIEW current access_team state
//   POST ?password=...&email=...           → GRANT (set access_team = true)
//   POST ?password=...&email=...&revoke=1  → REVOKE (set access_team = false)
//
// No KV / Stripe side effects — this is a single boolean on the profile row.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// GET = preview: show whether this email currently has Team Access.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const email = searchParams.get('email')?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
  }
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('email, access_team')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({
      success: true,
      mode: 'preview',
      email,
      found: false,
      access_team: false,
      message: `No user_profiles row for ${email}. A POST will create one with access_team=true.`,
    });
  }

  return NextResponse.json({
    success: true,
    mode: 'preview',
    email,
    found: true,
    access_team: !!data.access_team,
    message: data.access_team
      ? `${email} already HAS Team Access.`
      : `${email} does NOT have Team Access. POST to grant.`,
  });
}

// POST = execute: grant (default) or revoke (?revoke=1) Team Access.
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const email = searchParams.get('email')?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
  }
  const revoke = searchParams.get('revoke') === '1' || searchParams.get('revoke') === 'true';
  const target = !revoke;

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
  }

  // user_profiles has no unique constraint on email, so we can't upsert by it.
  // Update the existing row; if there isn't one (grant only), insert it.
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('email', email)
    .maybeSingle();

  let data: { email: string; access_team: boolean } | null = null;
  let error: { message: string } | null = null;

  if (existing) {
    const res = await supabase
      .from('user_profiles')
      .update({ access_team: target })
      .eq('email', email)
      .select('email, access_team')
      .maybeSingle();
    data = res.data; error = res.error;
  } else if (target) {
    // Only create a row when granting (no point creating a row to set false).
    const res = await supabase
      .from('user_profiles')
      .insert({ email, access_team: true })
      .select('email, access_team')
      .maybeSingle();
    data = res.data; error = res.error;
  } else {
    return NextResponse.json({
      success: true, mode: 'revoke', email, access_team: false,
      message: `No profile row for ${email} — nothing to revoke.`,
    });
  }

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    mode: revoke ? 'revoke' : 'grant',
    email,
    access_team: !!data?.access_team,
    message: revoke
      ? `Team Access REVOKED for ${email}. They'll drop to their underlying tier on next page load (refresh / re-login).`
      : `Team Access GRANTED to ${email}. The Team Access nav appears on next page load (hard refresh, or sign out/in).`,
  });
}
