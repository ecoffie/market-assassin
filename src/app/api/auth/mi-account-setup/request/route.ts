import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess } from '@/lib/api-auth';
import { sendSetupInvite } from '@/lib/mindy/account-setup';

const SETUP_SUCCESS_MESSAGE = 'If that email has Mindy access, an account setup link is on the way.';

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

/**
 * Is this a KNOWN Mindy account worth a setup link? verifyMIAccess falls through
 * to tier:'free' for ANY email (it's a default, not an entitlement), so tier alone
 * can't tell a real user from a cold visitor. Real = paid/team/pro entitlement
 * (sources flag or staff) OR an existing user_notification_settings row (the beta
 * alert cohort — free tier but a real account). A brand-new visitor matches none.
 */
async function isKnownAccount(email: string): Promise<boolean> {
  try {
    const access = await verifyMIAccess(email);
    const hasPaidEntitlement =
      access.tier === 'pro' ||
      access.tier === 'team' ||
      access.isStaff === true ||
      Object.values(access.sources || {}).some(Boolean);
    if (hasPaidEntitlement) return true;
  } catch {
    // fall through to the settings check
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data } = await supabase
      .from('user_notification_settings')
      .select('user_email')
      .eq('user_email', email)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    // Only KNOWN accounts get a setup link. A brand-new visitor (no entitlement, no
    // existing settings row) is routed to signup instead of a fake "check your
    // inbox" dead end. `entitled:false` lets the UI redirect them. Not meaningful
    // enumeration: self-service, the user's own email.
    const known = await isKnownAccount(email);
    if (!known) {
      return NextResponse.json({
        success: true,
        entitled: false,
        message: "We couldn't find Mindy access for that email. Create a free account to get started.",
      });
    }

    // Known account → send the setup link. If the SEND fails, don't 500 — soft 502
    // they can retry.
    try {
      await sendSetupInvite(email, { tier: 'entitled' });
    } catch (sendErr) {
      console.error('[MI Account Setup] setup-link send failed:', sendErr);
      return NextResponse.json(
        { success: false, entitled: true, error: 'Could not send the setup link right now. Please try again.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, entitled: true, message: SETUP_SUCCESS_MESSAGE });
  } catch (error) {
    console.error('[MI Account Setup] Unexpected failure:', error);
    return NextResponse.json({ success: false, error: 'Unable to send setup link' }, { status: 500 });
  }
}
