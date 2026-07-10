import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createTwoFactorSessionToken } from '@/lib/two-factor-session';
import { recordFailedLogin, clearFailedLogins } from '@/lib/login-abuse';
import { getClientIP } from '@/lib/rate-limit';

const MAX_ATTEMPTS = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

function hashCode(email: string, code: string) {
  const secret = process.env.TWO_FACTOR_SECRET || process.env.ADMIN_PASSWORD || process.env.SUPABASE_SERVICE_ROLE_KEY || 'mindy-2fa';
  return createHash('sha256').update(`${normalizeEmail(email)}:${code}:${secret}`).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = normalizeEmail(String(body.email || ''));
    const code = String(body.code || '').replace(/\D/g, '');

    if (!email || !email.includes('@') || code.length !== 6) {
      return NextResponse.json(
        { success: false, error: 'Email and 6-digit code are required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const { data: pendingCode, error } = await getSupabase()
      .from('two_factor_codes')
      .select('id, code_hash, attempts, expires_at')
      .eq('user_email', email)
      .is('consumed_at', null)
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json(
          { success: false, error: 'No verification code found. Request a new code.' },
          { status: 404 }
        );
      }
      throw error;
    }

    if (!pendingCode) {
      return NextResponse.json(
        { success: false, error: 'Code expired or not found. Request a new code.' },
        { status: 404 }
      );
    }

    const ip = getClientIP(request);

    if ((pendingCode.attempts || 0) >= MAX_ATTEMPTS) {
      await recordFailedLogin({ email, ip, reason: 'lockout', route: 'two-factor/verify' });
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Request a new code.' },
        { status: 429 }
      );
    }

    const isMatch = pendingCode.code_hash === hashCode(email, code);
    if (!isMatch) {
      await getSupabase()
        .from('two_factor_codes')
        .update({ attempts: (pendingCode.attempts || 0) + 1 })
        .eq('id', pendingCode.id);

      await recordFailedLogin({ email, ip, reason: 'bad_2fa_code', route: 'two-factor/verify' });

      return NextResponse.json(
        { success: false, error: 'Invalid verification code' },
        { status: 401 }
      );
    }

    await getSupabase()
      .from('two_factor_codes')
      .update({ consumed_at: now, attempts: (pendingCode.attempts || 0) + 1 })
      .eq('id', pendingCode.id);

    // Successful login — reset the per-account failure counter.
    await clearFailedLogins(email);

    return NextResponse.json({
      success: true,
      email,
      verifiedAt: now,
      sessionToken: createTwoFactorSessionToken(email),
    });
  } catch (error) {
    console.error('[2FA Verify] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to verify code' },
      { status: 500 }
    );
  }
}
