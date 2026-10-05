/**
 * Lightweight briefing access check
 * POST /api/briefings/verify
 * Body: { email?: string }
 * Returns: { hasAccess: boolean }
 *
 * R1: answers only for the VERIFIED caller (Mindy or Supabase session). The body email is a
 * claim that must match it. An anonymous caller gets 401 `auth_required`, never a yes/no about
 * someone else's address, so this cannot be used to check who is a paying customer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { hasProAccess } from '@/lib/access/resolve-access';
import { verifyClaimedIdentity } from '@/lib/api-auth';
import { shadowEntitlement } from '@/lib/entitlements/shadow';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const claimed = typeof body?.email === 'string' ? body.email : null;

    const identity = await verifyClaimedIdentity(request, claimed);
    if (identity.status !== 'verified') {
      return NextResponse.json(
        { hasAccess: false, auth_required: true, error: identity.status === 'mismatch' ? 'Email mismatch with session' : 'Sign in required' },
        { status: 401 },
      );
    }

    // Pro access = paid OR active trial (MINDY_TRIAL_OPEN).
    const hasAccess = await hasProAccess(identity.email);
    shadowEntitlement({ route: 'briefings/verify POST', capability: 'briefings.ai', email: identity.email, identityVerified: true, currentAllow: hasAccess });
    return NextResponse.json({ hasAccess });
  } catch {
    return NextResponse.json({ hasAccess: false }, { status: 500 });
  }
}
