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
    // No entitlement → return the same generic message (don't leak who has access).
    if (access.tier === 'none') {
      return NextResponse.json({ success: true, message: SETUP_SUCCESS_MESSAGE });
    }

    await sendSetupInvite(email, { tier: access.tier, staffRole: access.staffRole || 'none' });

    return NextResponse.json({ success: true, message: SETUP_SUCCESS_MESSAGE });
  } catch (error) {
    console.error('[MI Account Setup] Failed to send setup link:', error);
    return NextResponse.json({ success: false, error: 'Unable to send setup link' }, { status: 500 });
  }
}
