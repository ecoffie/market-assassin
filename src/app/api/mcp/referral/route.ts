/**
 * GET /api/mcp/referral — the signed-in user's referral link + stats (for /mcp/account).
 * Token-only identity (resolveMcpEmail); never trusts a client-supplied email.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';
import { getReferralStats } from '@/lib/mcp/referrals';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) return NextResponse.json({ success: false, error: 'not_authenticated' }, { status: 401 });

  const origin = new URL(request.url).origin || 'https://getmindy.ai';
  try {
    const stats = await getReferralStats(email, origin);
    return NextResponse.json({ success: true, ...stats });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
