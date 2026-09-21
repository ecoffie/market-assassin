/**
 * POST /api/app/sms/verify/send
 * Body: { email, phone }
 *
 * Double opt-in step 1 of 2. Generates a 6-digit code, stores it (with a 10-min
 * expiry) on the user's user_notification_settings row, and texts it via GHL.
 * The verification text itself carries the TCPA/CTIA consent + STOP/HELP language
 * — so replying to / acting on it IS the recorded consent. The number is NOT
 * marked verified here; that happens in /verify/check once the user enters the code.
 *
 * Rate-limited to prevent SMS-bombing a number.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { sendViaGHL, normalizePhoneNumber } from '@/lib/ghl/sms';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// 6-digit numeric code. Uses crypto for a non-guessable value (Math.random is
// unavailable in some runtimes + weaker); 100000-999999 range.
function generateCode(): string {
  const n = require('crypto').randomInt(0, 1_000_000);
  return String(n).padStart(6, '0');
}

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const phone = normalizePhoneNumber(String(body.phone || ''));
  if (!phone) {
    return NextResponse.json({ success: false, error: 'Enter a valid US phone number.' }, { status: 400 });
  }

  // Rate limit: max a handful of code sends per user per window (SMS costs money
  // + protects the number from being bombed).
  const rl = await checkRateLimit(`sms-verify:${email}`, 5, 60 * 60); // 5/hour
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'Too many code requests. Try again in an hour.' },
      { status: 429 },
    );
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  const supabase = getSupabase();
  // Store the pending phone + code. We store the phone here (unverified) and only
  // flip phone_verified in /verify/check. Reset attempts + clear any prior opt-out.
  const { error: upErr } = await supabase
    .from('user_notification_settings')
    .upsert(
      {
        user_email: email,
        phone_number: phone,
        sms_verify_code: code,
        sms_verify_expires_at: expiresAt,
        sms_verify_attempts: 0,
        phone_verified: false,
        sms_opted_out: false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_email' },
    );
  if (upErr) {
    console.error('[sms/verify/send] upsert error', upErr.message);
    return NextResponse.json({ success: false, error: 'Could not start verification.' }, { status: 500 });
  }

  // The verification text = the consent moment. Carries required disclosures.
  const smsBody =
    `Mindy: your verification code is ${code}. ` +
    `Enter it to turn on pursuit-change text alerts. ` +
    `Msg&data rates may apply. Reply STOP to cancel, HELP for help.`;

  const res = await sendViaGHL(phone, smsBody);
  if (!res.success) {
    console.error('[sms/verify/send] GHL send failed', res.error);
    return NextResponse.json(
      { success: false, error: 'Could not send the code. Check the number and try again.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, phone, expiresInSec: CODE_TTL_MS / 1000 });
}
