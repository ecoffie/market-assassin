import { NextRequest, NextResponse } from 'next/server';
import { qualifyReferralFromRequest } from '@/lib/mcp/referrals';
import { createClient } from '@supabase/supabase-js';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';
import { hasProAccess } from '@/lib/access/resolve-access';
import { sendTwoFactorCode } from '@/lib/mindy/two-factor-code';

// Paid-MFA gate (P0). When ON, a PAID account that signs in with a password must
// pass an email-OTP step before a session is minted (free accounts unaffected).
// OAuth users satisfy MFA upstream at Google/Microsoft, so they never hit this
// route. Default OFF (unset = off) → canary rollout. Fail-open: any error in the
// paid check mints the session normally (never lock a paying user out).
function mfaEnforcedForPaid(): boolean {
  const v = (process.env.MFA_ENFORCED_PAID || '').trim().toLowerCase();
  return ['on', 'true', '1', 'yes'].includes(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _authSupabase: any = null;
function getAuthSupabase() {
  if (!_authSupabase) {
    _authSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _authSupabase;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminSupabase: any = null;
function getAdminSupabase() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return null;
  if (!_adminSupabase) {
    _adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _adminSupabase;
}

async function mindyAccountExists(email: string): Promise<boolean> {
  const admin = getAdminSupabase();
  if (!admin) return false;

  try {
    let page = 1;
    for (;;) {
      const { data: list } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      const users = list?.users || [];
      if (users.some((u: { email?: string | null }) => (u.email || '').toLowerCase() === email)) {
        return true;
      }
      if (users.length < 1000) break;
      page += 1;
      if (page > 20) break;
    }

    const { data: notificationRow } = await admin
      .from('user_notification_settings')
      .select('user_email')
      .eq('user_email', email)
      .maybeSingle();
    return Boolean(notificationRow);
  } catch {
    return false;
  }
}

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = normalizeEmail(String(body.email || ''));
    const password = String(body.password || '');

    if (!email || !email.includes('@')) {
      return NextResponse.json({ success: false, error: 'Valid email is required' }, { status: 400 });
    }

    if (!password) {
      return NextResponse.json({ success: false, error: 'Password is required' }, { status: 400 });
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ success: false, error: 'Authentication is not configured' }, { status: 500 });
    }

    const { data: authData, error: authError } = await getAuthSupabase().auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      // Distinguish "no account yet" (email-only beta user → needs SETUP, not a
      // password reset) from "wrong password" (has an account → forgot-password is
      // right). Supabase's sign-in error is identical for both (security), so we look
      // up whether an auth user actually exists. This stops the dead-end where a
      // beta user clicks "forgot password" for an account that was never created.
      const hasAccount = await mindyAccountExists(email);

      return NextResponse.json(
        {
          success: false,
          needsAccountSetup: !hasAccount,
          error: hasAccount
            ? 'Incorrect password. Use "Forgot password" to reset it.'
            : "You haven't set up your password yet. Click \"Set up my account\" to get your secure link.",
        },
        { status: 401 }
      );
    }

    // PAID-MFA GATE. Password is verified at this point. If enforcement is on and
    // this is a paid account, do NOT mint the session — issue an email OTP and tell
    // the client to switch to the code step. mi-login already holds the verified
    // password, so we send the code here (no need to re-send the password from the
    // client). Fail-open: if the paid check throws, fall through and mint normally.
    if (mfaEnforcedForPaid()) {
      try {
        if (await hasProAccess(email)) {
          const sent = await sendTwoFactorCode(email, {
            ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
            userAgent: request.headers.get('user-agent'),
          });
          // Throttled = a code was already sent moments ago; still route to the code
          // step (the user has a valid code in hand). Only a hard table/error failure
          // falls open to a direct session, to avoid locking a paying user out.
          if (sent.ok || sent.reason === 'throttled') {
            return NextResponse.json({ success: true, mfaRequired: true, email });
          }
          console.error('[MI Login] OTP send failed, failing open to session:', sent);
        }
      } catch (err) {
        console.error('[MI Login] paid-MFA check errored, failing open to session:', err);
      }
    }

    // Referral: if this verified user arrived via a ?ref link, credit the referrer (fire-and-forget).
    void qualifyReferralFromRequest(request, email);
    const authenticatedAt = new Date().toISOString();
    return NextResponse.json({
      success: true,
      email,
      authenticatedAt,
      sessionToken: createMIAuthSessionToken(email),
      twoFactorOptional: true,
    });
  } catch (error) {
    console.error('[MI Login] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to sign in' },
      { status: 500 }
    );
  }
}
