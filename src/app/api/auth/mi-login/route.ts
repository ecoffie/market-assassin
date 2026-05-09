import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';

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
          error: 'Invalid email or password. Use account setup or forgot password if needed.',
          needsAccountSetup: true,
        },
        { status: 401 }
      );
    }

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
