import { NextRequest, NextResponse } from 'next/server';
import { getFlaggedUsers, clearAbuseFlag, getAbuseRecord, ABUSE_THRESHOLDS } from '@/lib/abuse-detection';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

/**
 * Admin endpoint to view and manage abuse reports
 *
 * GET /api/admin/abuse-report?password=XXX
 *   Returns all flagged users with their generation counts
 *
 * GET /api/admin/abuse-report?password=XXX&email=test@example.com
 *   Returns abuse record for a specific email
 *
 * POST /api/admin/abuse-report
 *   Body: { password: "XXX", action: "clear", email: "test@example.com" }
 *   Clears abuse flag for a user after manual review
 */
export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const email = request.nextUrl.searchParams.get('email');

  // Rate limit admin endpoint
  const ip = getClientIP(request);
  const rl = await checkAdminRateLimit(ip);
  if (!rl.allowed) return rateLimitResponse(rl);

  // Auth check
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Single user lookup
  if (email) {
    const count = await getAbuseRecord(email);
    const level = count >= ABUSE_THRESHOLDS.BLOCK ? 'blocked' :
                  count >= ABUSE_THRESHOLDS.FLAG ? 'flagged' :
                  count >= ABUSE_THRESHOLDS.WARNING ? 'warning' : 'ok';

    return NextResponse.json({
      email,
      totalGenerations: count,
      level,
      thresholds: ABUSE_THRESHOLDS,
    });
  }

  // All flagged users
  const flaggedUsers = await getFlaggedUsers();

  return NextResponse.json({
    success: true,
    thresholds: ABUSE_THRESHOLDS,
    flaggedCount: flaggedUsers.length,
    users: flaggedUsers,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { password, action, email } = body;

  // Rate limit admin endpoint
  const ip = getClientIP(request);
  const rl = await checkAdminRateLimit(ip);
  if (!rl.allowed) return rateLimitResponse(rl);

  // Auth check
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (action === 'clear' && email) {
    await clearAbuseFlag(email);
    return NextResponse.json({
      success: true,
      message: `Cleared abuse flag for ${email}`,
    });
  }

  return NextResponse.json({
    error: 'Invalid action. Use action: "clear" with email.',
  }, { status: 400 });
}
