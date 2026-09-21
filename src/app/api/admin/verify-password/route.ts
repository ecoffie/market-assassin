import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    // Brute-force protection
    const ip = getClientIP(request);
    const rl = await checkAdminRateLimit(ip);
    if (!rl.allowed) return rateLimitResponse(rl);

    const { password } = await request.json();

    if (verifyAdminPassword(password)) {
      return NextResponse.json({ valid: true });
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch (error) {
    console.error('Error verifying password:', error);
    return NextResponse.json(
      { error: 'Failed to verify password' },
      { status: 500 }
    );
  }
}
