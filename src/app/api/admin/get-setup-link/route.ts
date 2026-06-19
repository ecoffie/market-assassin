/**
 * Admin: GENERATE a setup link for an account and RETURN it (don't email).
 *
 * Used when email delivery is unreliable (yahoo/aol/gmail spam) — hand the user
 * their direct setup link via text/Slack so they can set a password + log in.
 * Reuses generateSetupLink (Supabase invite → recovery fallback for existing
 * accounts), the same link the email would contain.
 *
 * GET ?password=...&email=...  → { url, type }
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateSetupLink, getSetupRedirectUrl } from '@/lib/mindy/account-setup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const email = (request.nextUrl.searchParams.get('email') || '').toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

  try {
    const link = await generateSetupLink(email, getSetupRedirectUrl());
    return NextResponse.json({ success: true, email, type: link.type, url: link.url });
  } catch (e) {
    return NextResponse.json({ success: false, email, error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
