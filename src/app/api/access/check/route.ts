import { NextRequest, NextResponse } from 'next/server';
import { verifyMIAccess } from '@/lib/api-auth';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    const authSession = requireMIAuthSession(request, email);
    if (!authSession.ok) return authSession.response;

    const access = await verifyMIAccess(email);
    const isPaidMI =
      access.tier === 'pro'
      || access.tier === 'team'
      || access.tier === 'enterprise';

    return NextResponse.json({
      success: true,
      email,
      tier: access.tier,
      isStaff: access.isStaff ?? false,
      staffRole: access.staffRole ?? 'none',
      access: {
        mi_free: access.tier !== 'none',
        mi_pro: isPaidMI,
        briefings: isPaidMI,
        team: access.tier === 'team',
        enterprise: access.tier === 'enterprise',
        staff: access.isStaff ?? false,
        admin: access.staffRole === 'admin',
        legacy_sources: access.sources ?? {},
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
