import { NextRequest, NextResponse } from 'next/server';
import { isKnownMindyAccount } from '@/lib/mindy/known-accounts';
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

    const known = await isKnownMindyAccount(email);
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
