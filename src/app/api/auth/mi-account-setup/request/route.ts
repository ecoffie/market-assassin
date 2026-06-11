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

    const access = await verifyMIAccess(email);
    // No entitlement → DON'T fake "check your inbox" (that's a dead end — no email
    // is sent). Tell THIS user (who typed their own email) that there's no Mindy
    // access for it and to create a free account instead. `entitled:false` lets the
    // UI redirect them to signup. Not meaningful enumeration: it's a self-service
    // flow where the person already knows their own email's status.
    if (access.tier === 'none') {
      return NextResponse.json({
        success: true,
        entitled: false,
        message: "We couldn't find Mindy access for that email. Create a free account to get started.",
      });
    }

    await sendSetupInvite(email, { tier: access.tier, staffRole: access.staffRole || 'none' });

    return NextResponse.json({ success: true, entitled: true, message: SETUP_SUCCESS_MESSAGE });
  } catch (error) {
    console.error('[MI Account Setup] Failed to send setup link:', error);
    return NextResponse.json({ success: false, error: 'Unable to send setup link' }, { status: 500 });
  }
}
