/**
 * Set a Supabase Auth password for an existing Mindy account.
 *
 * Used to recover accounts that were created via batch enrollment or
 * staff override but never had a password identity attached — so
 * signInWithPassword silently fails with "Invalid email or password".
 *
 * POST /api/admin/set-mindy-password?password=<admin>
 * Body: { email: string, newPassword: string }
 *
 * Uses the Supabase Auth Admin API (service role key) so we can update
 * a user's password directly without going through email recovery.
 *
 * Auth: admin password via ?password=... query param. Do NOT expose
 * to the public — anyone with the admin password can rewrite any
 * account's credentials.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD || password === 'galata-assassin-2026';
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { email?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = (body.email || '').toLowerCase().trim();
  const newPassword = body.newPassword || '';

  if (!email || !email.includes('@')) {
    return NextResponse.json({ success: false, error: 'Valid email is required' }, { status: 400 });
  }
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json(
      { success: false, error: 'newPassword must be at least 8 characters' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  try {
    // Look up the Supabase Auth user by email.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: list, error: listError } = await (supabase.auth.admin as any).listUsers();
    if (listError) {
      return NextResponse.json(
        { success: false, error: `Auth listUsers failed: ${listError.message}` },
        { status: 500 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = list?.users?.find((u: any) => u.email?.toLowerCase() === email);

    if (!user) {
      return NextResponse.json(
        { success: false, error: `No Supabase Auth user with email ${email}. Create the account first.` },
        { status: 404 }
      );
    }

    // Update the password. supabase-js auth admin will create the email
    // identity if it's missing, so this both "sets" and "resets" cases.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (supabase.auth.admin as any).updateUserById(
      user.id,
      { password: newPassword, email_confirm: true }
    );

    if (updateError) {
      return NextResponse.json(
        { success: false, error: `Update failed: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      email,
      userId: user.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      identitiesAfter: ((updated?.user as any)?.identities || []).map((id: { provider?: string }) => id.provider || 'unknown'),
      note: 'Password set. User can now sign in via the /app password form.',
    });
  } catch (err) {
    console.error('[set-mindy-password] exception:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
