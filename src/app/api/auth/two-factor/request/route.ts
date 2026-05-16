import { createHash, randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';

const CODE_TTL_MINUTES = 10;
const RESEND_WINDOW_SECONDS = 60;

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

function normalizeEmail(email: string) {
  return email.toLowerCase().trim();
}

function hashCode(email: string, code: string) {
  const secret = process.env.TWO_FACTOR_SECRET || process.env.ADMIN_PASSWORD || process.env.SUPABASE_SERVICE_ROLE_KEY || 'mindy-2fa';
  return createHash('sha256').update(`${normalizeEmail(email)}:${code}:${secret}`).digest('hex');
}

async function ensureTwoFactorTable() {
  const { error } = await getSupabase().from('two_factor_codes').select('id').limit(1);
  if (!error || error.code !== '42P01') return { ready: true };

  const { error: migrationError } = await getSupabase().rpc('exec_migration', {
    sql_query: `
      CREATE TABLE IF NOT EXISTS two_factor_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        attempts INTEGER NOT NULL DEFAULT 0,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_two_factor_codes_email_created
        ON two_factor_codes(user_email, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_two_factor_codes_expires
        ON two_factor_codes(expires_at);
    `,
  });

  return { ready: !migrationError, error: migrationError?.message };
}

function buildEmailHtml(code: string) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a;">
      <div style="background:#020617;color:white;border-radius:14px;padding:24px;">
        <div style="font-size:13px;color:#34d399;text-transform:uppercase;letter-spacing:.08em;">Mindy</div>
        <h1 style="margin:10px 0 8px;font-size:24px;">Your verification code</h1>
        <p style="color:#cbd5e1;margin:0 0 22px;">Enter this code to finish signing in. It expires in ${CODE_TTL_MINUTES} minutes.</p>
        <div style="font-size:36px;letter-spacing:10px;font-weight:700;background:#0f172a;border:1px solid #334155;border-radius:12px;padding:18px 20px;text-align:center;">
          ${code}
        </div>
        <p style="font-size:13px;color:#94a3b8;margin:22px 0 0;">If you did not request this, you can ignore this email.</p>
      </div>
    </div>
  `;
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
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid email or password. Use forgot password if you already have an account.',
          needsAccountSetup: true,
        },
        { status: 401 }
      );
    }

    const table = await ensureTwoFactorTable();
    if (!table.ready) {
      return NextResponse.json(
        { success: false, error: 'Two-factor table is not ready', details: table.error },
        { status: 500 }
      );
    }

    const resendAfter = new Date(Date.now() - RESEND_WINDOW_SECONDS * 1000).toISOString();
    const { data: recentCode } = await getSupabase()
      .from('two_factor_codes')
      .select('id')
      .eq('user_email', email)
      .gte('created_at', resendAfter)
      .is('consumed_at', null)
      .limit(1)
      .maybeSingle();

    if (recentCode) {
      return NextResponse.json(
        { success: false, error: 'Code already sent. Please wait a minute before requesting another.' },
        { status: 429 }
      );
    }

    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

    const { error: insertError } = await getSupabase()
      .from('two_factor_codes')
      .insert({
        user_email: email,
        code_hash: hashCode(email, code),
        expires_at: expiresAt,
        ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        user_agent: request.headers.get('user-agent'),
      });

    if (insertError) throw insertError;

    await sendEmail({
      to: email,
      subject: `${code} is your Mindy verification code`,
      html: buildEmailHtml(code),
      text: `Your Mindy verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`,
      emailType: 'two_factor_code',
      eventSource: 'mindy_login',
      tags: { product: 'mindy', type: '2fa' },
      metadata: { expiresAt },
    });

    return NextResponse.json({
      success: true,
      expiresAt,
      message: 'Verification code sent',
    });
  } catch (error) {
    console.error('[2FA Request] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send verification code' },
      { status: 500 }
    );
  }
}
