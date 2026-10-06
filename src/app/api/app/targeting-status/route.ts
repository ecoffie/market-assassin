/**
 * /api/app/targeting-status — is this user's profile actually targeted, and what can they confirm?
 *
 * GET  ?email=  → { state, alertsOn, notice, setupPath, storedNaics, typedCodeOffers }
 *   Server truth for the "finish setup" notice (never localStorage). `state` mirrors the
 *   daily-alerts gate — see src/lib/profile/targeting-state.ts. A read error is a 500, never a
 *   guessed `none`: an unknown state must not tell a configured user their alerts stopped.
 *
 * POST { email, action: 'reject_typed_code', code } → remembers the rejection so the code is
 *   not offered again. ACCEPT is deliberately NOT here: an accepted code is written through the
 *   existing save path (POST /api/alerts/preferences), which validates the code and records
 *   naics_source='user_confirmed'. This route never writes naics_codes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { isKnownNaicsCode } from '@/lib/codes/validate-market-codes';
import { TARGETING_SETUP_PATH, targetingNotice, targetingStateFrom } from '@/lib/profile/targeting-state';
import { mergeTypedCodeRejection, rejectedTypedCodes, typedCodeOffers } from '@/lib/profile/typed-codes';

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const client = sb();
  const [settings, business] = await Promise.all([
    client.from('user_notification_settings')
      .select('naics_codes, keywords, naics_source, alerts_enabled, alert_frequency, is_active, business_description, aggregated_profile')
      .eq('user_email', email)
      .maybeSingle(),
    client.from('user_business_profiles')
      .select('business_description')
      .eq('user_email', email)
      .maybeSingle(),
  ]);
  if (settings.error) {
    return NextResponse.json({ success: false, error: `settings read failed: ${settings.error.message}` }, { status: 500 });
  }
  if (business.error) {
    return NextResponse.json({ success: false, error: `business profile read failed: ${business.error.message}` }, { status: 500 });
  }

  const row = settings.data;
  const state = targetingStateFrom(row);
  const alertsOn = row
    ? (row.is_active !== false && row.alerts_enabled === true && row.alert_frequency !== 'paused')
    : false;
  const storedNaics = (row?.naics_codes || []).map(String);
  const offers = typedCodeOffers(
    [row?.business_description, business.data?.business_description],
    { stored: storedNaics, rejected: rejectedTypedCodes(row?.aggregated_profile) },
  );

  return NextResponse.json({
    success: true,
    state,
    alertsOn,
    hasSettingsRow: !!row,
    notice: targetingNotice(state, alertsOn),
    setupPath: TARGETING_SETUP_PATH,
    storedNaics,
    typedCodeOffers: offers,
  });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'invalid JSON' }, { status: 400 }); }
  const email = String(body.email || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  if (body.action !== 'reject_typed_code') {
    return NextResponse.json({ success: false, error: 'unknown action' }, { status: 400 });
  }
  const code = String(body.code || '').trim();
  if (!/^\d{6}$/.test(code) || !isKnownNaicsCode(code)) {
    return NextResponse.json({ success: false, error: 'not a known 6-digit NAICS code' }, { status: 400 });
  }

  const client = sb();
  const { data: row, error: readError } = await client.from('user_notification_settings')
    .select('aggregated_profile')
    .eq('user_email', email)
    .maybeSingle();
  if (readError) return NextResponse.json({ success: false, error: `settings read failed: ${readError.message}` }, { status: 500 });
  if (!row) return NextResponse.json({ success: false, error: 'no settings row' }, { status: 404 });

  const next = mergeTypedCodeRejection(row.aggregated_profile, code, new Date().toISOString());
  const { count, error } = await client.from('user_notification_settings')
    .update({ aggregated_profile: next }, { count: 'exact' })
    .eq('user_email', email);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  // null = unknown, never success (Bug Prevention Rule #11); 0 = nothing was written.
  if (count == null || count === 0) {
    return NextResponse.json({ success: false, error: 'rejection was not recorded' }, { status: 500 });
  }
  return NextResponse.json({ success: true, rejected: code });
}
