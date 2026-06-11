import { NextRequest, NextResponse } from 'next/server';
import { verifyMIAccess } from '@/lib/api-auth';
import { sendSetupInvite } from '@/lib/mindy/account-setup';

const SETUP_SUCCESS_MESSAGE = 'If that email has Mindy access, an account setup link is on the way.';

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    // Resolve entitlement. If the access lookup itself errors (KV/Supabase blip on
    // an unknown email), treat as NO access rather than 500 — a new visitor should
    // be routed to signup, never see a server error.
    let tier: string = 'none';
    let staffRole = 'none';
    try {
      const access = await verifyMIAccess(email);
      tier = access.tier;
      staffRole = access.staffRole || 'none';
    } catch (accessErr) {
      console.warn('[MI Account Setup] access lookup failed, treating as no-access:', accessErr);
      tier = 'none';
    }

    // No entitlement → DON'T fake "check your inbox" (that's a dead end — no email
    // is sent). Tell THIS user (who typed their own email) there's no Mindy access
    // for it and to create a free account. `entitled:false` lets the UI redirect to
    // signup. Not meaningful enumeration: self-service, the user's own email.
    if (tier === 'none') {
      return NextResponse.json({
        success: true,
        entitled: false,
        message: "We couldn't find Mindy access for that email. Create a free account to get started.",
      });
    }

    // Entitled → send the setup link. If the SEND fails, still don't 500 the user;
    // report a soft failure they can retry.
    try {
      await sendSetupInvite(email, { tier, staffRole });
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
