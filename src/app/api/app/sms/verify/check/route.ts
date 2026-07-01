/**
 * POST /api/app/sms/verify/check
 * Body: { email, code }
 *
 * Double opt-in step 2 of 2. Validates the 6-digit code the user received. On
 * success: sms_enabled=true, phone_verified=true, phone_verified_at=now, and the
 * code is cleared. Only a VERIFIED number is ever texted by pursuit-changes.
 *
 * Guards: code must match, not be expired, and be within the attempt limit
 * (prevents brute-forcing a 6-digit code).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

const MAX_ATTEMPTS = 5;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').toLowerCase().trim();
  const code = String(body.code || '').trim();
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ success: false, error: 'Enter the 6-digit code.' }, { status: 400 });
  }

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from('user_notification_settings')
    .select('sms_verify_code, sms_verify_expires_at, sms_verify_attempts, phone_number')
    .eq('user_email', email)
    .single();

  if (error || !row) {
    return NextResponse.json({ success: false, error: 'Request a code first.' }, { status: 400 });
  }

  const attempts = Number(row.sms_verify_attempts || 0);
  if (attempts >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { success: false, error: 'Too many attempts. Request a new code.' },
      { status: 429 },
    );
  }

  const expired = !row.sms_verify_expires_at || new Date(row.sms_verify_expires_at).getTime() < Date.now();
  const matches = row.sms_verify_code && row.sms_verify_code === code;

  if (!matches || expired) {
    // Count the failed attempt (only meaningful while a code exists).
    await supabase
      .from('user_notification_settings')
      .update({ sms_verify_attempts: attempts + 1 })
      .eq('user_email', email);
    return NextResponse.json(
      { success: false, error: expired ? 'That code expired. Request a new one.' : 'Incorrect code.' },
      { status: 400 },
    );
  }

  // Verified — activate SMS, clear the code.
  const { error: upErr } = await supabase
    .from('user_notification_settings')
    .update({
      sms_enabled: true,
      phone_verified: true,
      phone_verified_at: new Date().toISOString(),
      sms_verify_code: null,
      sms_verify_expires_at: null,
      sms_verify_attempts: 0,
      sms_opted_out: false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_email', email);

  if (upErr) {
    console.error('[sms/verify/check] activate error', upErr.message);
    return NextResponse.json({ success: false, error: 'Could not activate SMS.' }, { status: 500 });
  }

  return NextResponse.json({ success: true, phone_verified: true, phone_number: row.phone_number });
}
