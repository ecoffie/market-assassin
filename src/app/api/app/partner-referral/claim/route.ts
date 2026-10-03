/**
 * POST /api/app/partner-referral/claim  { code }
 *
 * SEC-5d (P0, 2026-10-03): the only way a promotional partner trial is granted. The identity is
 * the VERIFIED session — the signed Mindy session token (x-mi-auth-token / x-mi-2fa-token /
 * Bearer) or a verified Supabase session. A body/query email, the plaintext ma_access_email
 * cookie and a claimed staff address are never read. The browser's stored referral code is
 * transport only; the server validates it. Rules live in src/lib/mindy/partner-referral-claim.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getTwoFactorTokenFromRequest, verifyTwoFactorSessionToken } from '@/lib/two-factor-session';
import { verifyUserSession } from '@/lib/api-auth';
import { resolveAccess } from '@/lib/access/resolve-access';
import { claimPartnerReferral, TERMINAL_CLAIM_STATUSES } from '@/lib/mindy/partner-referral-claim';

export const dynamic = 'force-dynamic';

const HTTP: Record<string, number> = {
  claimed: 200,
  invalid_code: 400,
  profile_required: 409,
  already_claimed: 409,
  not_eligible_active_pro: 409,
  error: 500,
};

async function verifiedIdentity(request: NextRequest): Promise<{ email: string; method: string } | null> {
  const token = getTwoFactorTokenFromRequest(request);
  if (token) {
    const mi = verifyTwoFactorSessionToken(token);
    if (mi.valid && mi.email) return { email: mi.email, method: 'mindy_session' };
  }
  const supa = await verifyUserSession(request);
  if (supa.authenticated && supa.email) return { email: supa.email, method: 'supabase_session' };
  return null;
}

export async function POST(request: NextRequest) {
  const identity = await verifiedIdentity(request);
  if (!identity) {
    return NextResponse.json({ success: false, status: 'unauthenticated', error: 'Sign in to claim a partner offer.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === 'string' ? body.code : '';

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ success: false, status: 'error', error: 'Server configuration error' }, { status: 500 });
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const result = await claimPartnerReferral(sb, identity.email, code, identity.method, {
    hasActivePro: async (email) => (await resolveAccess(email)).level === 'pro',
  });

  if (result.status === 'error') console.error('[partner-claim] failed:', identity.email, result.error);
  return NextResponse.json(
    {
      success: result.status === 'claimed',
      status: result.status,
      // Tells the browser whether to drop its pending referral (terminal) or keep it to retry.
      clearPending: TERMINAL_CLAIM_STATUSES.has(result.status),
      ...(result.status === 'claimed' ? { partner: result.partner.code, trialEndsAt: result.trialEndsAt } : {}),
      ...(result.status === 'already_claimed' ? { partner: result.partnerCode } : {}),
    },
    { status: HTTP[result.status] ?? 500 },
  );
}
