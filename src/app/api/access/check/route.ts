import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyMIAccess, canSeePrototypeSurfaces } from '@/lib/api-auth';
import { resolveAccess } from '@/lib/access/resolve-access';
import { resolveCoachAccess } from '@/lib/mindy/coach-access';
import { requireMIAuthSession } from '@/lib/two-factor-session';

// Has the user saved a real profile yet? Drives the new-user → onboarding gate on
// /app (every login lands here, including password logins that skip OAuth's
// onboarding redirect). On error → true (never force-onboard a real user).
async function hasSavedProfile(email: string): Promise<boolean> {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await sb.from('user_notification_settings').select('naics_codes').eq('user_email', email).maybeSingle();
    return Array.isArray(data?.naics_codes) && (data!.naics_codes as string[]).length > 0;
  } catch { return true; }
}

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

    const [access, resolved, coachMode, profileExists] = await Promise.all([
      verifyMIAccess(email),
      resolveAccess(email),
      resolveCoachAccess(email),
      hasSavedProfile(email),
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
      needsOnboarding: !profileExists,
      isStaff: access.isStaff ?? false,
      staffRole: access.staffRole ?? 'none',
      // Prototype demo tabs are gated on their own allowlist, NOT isStaff, so
      // company/demo accounts get the clean Pro-member view by default.
      canSeePrototypes: canSeePrototypeSurfaces(email),
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
