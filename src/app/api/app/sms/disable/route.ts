/**
 * POST /api/app/sms/disable
 * Body: { email }
 *
 * Turn SMS alerts off. No re-verification needed to opt OUT (only to opt in).
 * Clears sms_enabled + phone_verified so re-enabling requires a fresh verify.
 * Leaves phone_number so it can be pre-filled next time.
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

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = (body.email || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  // Counted (P0-H): with no settings row this used to return success having changed nothing.
  // SMS can only ever have been enabled on an existing row (sms/verify/check), so a missing row
  // means SMS is already off — say so explicitly rather than implying a change was made.
  const { count, error } = await getSupabase()
    .from('user_notification_settings')
    .update({
      sms_enabled: false,
      phone_verified: false,
      phone_verified_at: null,
      sms_verify_code: null,
      sms_verify_expires_at: null,
      updated_at: new Date().toISOString(),
    }, { count: 'exact' })
    .eq('user_email', email);

  if (error || count == null) {
    console.error('[sms/disable] error', error?.message ?? 'update count unknown');
    return NextResponse.json({ success: false, error: 'Could not update.' }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ success: true, changed: false, sms_enabled: false, reason: 'no_settings_row' });
  }
  return NextResponse.json({ success: true, changed: true, sms_enabled: false });
}
