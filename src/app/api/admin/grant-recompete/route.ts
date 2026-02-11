import { NextRequest, NextResponse } from 'next/server';
import { grantRecompeteAccess } from '@/lib/access-codes';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

// Admin endpoint to manually grant Recompete Contracts Tracker access
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIP(request);
    const rl = await checkAdminRateLimit(ip);
    if (!rl.allowed) return rateLimitResponse(rl);

    const { email, customerName, adminPassword } = await request.json();

    if (!verifyAdminPassword(adminPassword)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (!email) {
      return NextResponse.json(
        { error: 'Email required' },
        { status: 400 }
      );
    }

    // Grant access
    console.log('Grant Recompete - received customerName:', customerName, 'for email:', email);
    const access = await grantRecompeteAccess(email, customerName);
    console.log('Grant Recompete - saved access:', JSON.stringify(access));

    return NextResponse.json({
      success: true,
      message: `Recompete access granted to ${email}${access.customerName ? ` (${access.customerName})` : ''}`,
      access,
    });

  } catch (error) {
    console.error('Error granting Recompete access:', error);
    return NextResponse.json(
      { error: 'Failed to grant access' },
      { status: 500 }
    );
  }
}
