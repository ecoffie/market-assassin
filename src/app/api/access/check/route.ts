import { NextRequest, NextResponse } from 'next/server';
import { verifyMIAccess } from '@/lib/api-auth';
import { resolveAccess } from '@/lib/access/resolve-access';
import { resolveCoachAccess } from '@/lib/mindy/coach-access';
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

    const [access, resolved, coachMode] = await Promise.all([
      verifyMIAccess(email),
      resolveAccess(email),
      resolveCoachAccess(email),
    ]);

    // Partner trials (and other per-user trial_ends_at) stamp Pro via
    // resolveAccess — not permanent KV. Team/enterprise stay above trial.
    let tier = access.tier;
    if (
      resolved.level === 'pro'
      && tier !== 'team'
      && tier !== 'enterprise'
    ) {
      tier = 'pro';
    }

    const isPaidMI =
      tier === 'pro'
      || tier === 'team'
      || tier === 'enterprise';

    return NextResponse.json({
      success: true,
      email,
      tier,
      isStaff: access.isStaff ?? false,
      staffRole: access.staffRole ?? 'none',
      trialEndsAt: resolved.trialEndsAt,
      accessSource: resolved.source,
      access: {
        mi_free: tier !== 'none',
        mi_pro: isPaidMI,
        briefings: isPaidMI,
        team: tier === 'team',
        enterprise: tier === 'enterprise',
        staff: access.isStaff ?? false,
        admin: access.staffRole === 'admin',
        legacy_sources: access.sources ?? {},
      },
      coachMode: {
        allowed: coachMode.allowed,
        reason: coachMode.reason,
        canAddClients: coachMode.canAddClients,
        maxClients: coachMode.maxClients,
        upgradeRequired: coachMode.upgradeRequired ?? null,
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
