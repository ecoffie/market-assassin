/**
 * Admin-only: mint a real MI session token for QA / screenshot testing.
 *
 * Uses the server-side signing secret (TWO_FACTOR_SECRET) via the canonical
 * createMIAuthSessionToken(), so the returned token verifies on every /app
 * route exactly like a real sign-in. Admin-password gated — never exposed to
 * users. Lets us drive an authed /app session headlessly to verify UI.
 *
 *   GET ?password=<admin>&email=<user> -> { token }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const token = createMIAuthSessionToken(email);
  return NextResponse.json({ token, email }, { headers: { 'Cache-Control': 'no-store' } });
}
