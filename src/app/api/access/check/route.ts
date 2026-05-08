import { NextRequest, NextResponse } from 'next/server';
import { verifyMIAccess } from '@/lib/api-auth';
import { requireTwoFactorSession } from '@/lib/two-factor-session';

export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    const twoFactor = requireTwoFactorSession(request, email);
    if (!twoFactor.ok) return twoFactor.response;

    const access = await verifyMIAccess(email);
    const isPro = access.tier === 'pro';

    return NextResponse.json({
      success: true,
      email,
      tier: access.tier,
      access: {
        briefings: isPro,
        mi_pro: isPro,
        team: false,
        enterprise: false,
      },
    });
  } catch (error) {
    console.error('[Access Check] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check access' },
      { status: 500 }
    );
  }
}
