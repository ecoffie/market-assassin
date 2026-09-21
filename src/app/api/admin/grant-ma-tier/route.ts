import { NextRequest, NextResponse } from 'next/server';
import { grantMarketAssassinAccess, MarketAssassinTier } from '@/lib/access-codes';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

// Admin endpoint to manually grant Market Assassin tier access
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIP(request);
    const rl = await checkAdminRateLimit(ip);
    if (!rl.allowed) return rateLimitResponse(rl);

    const { email, tier, customerName, adminPassword } = await request.json();

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

    if (!tier || !['standard', 'premium'].includes(tier)) {
      return NextResponse.json(
        { error: 'Valid tier required (standard or premium)' },
        { status: 400 }
      );
    }

    // Grant access
    const access = await grantMarketAssassinAccess(email, tier as MarketAssassinTier, customerName);

    return NextResponse.json({
      success: true,
      message: `Market Assassin ${tier} access granted to ${email}`,
      access,
    });

  } catch (error) {
    console.error('Error granting Market Assassin tier access:', error);
    return NextResponse.json(
      { error: 'Failed to grant access' },
      { status: 500 }
    );
  }
}
