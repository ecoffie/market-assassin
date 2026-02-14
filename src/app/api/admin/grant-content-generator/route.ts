import { NextRequest, NextResponse } from 'next/server';
import { grantContentGeneratorAccess, ContentGeneratorTier } from '@/lib/access-codes';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

// Admin endpoint to manually grant GovCon Content Generator access
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIP(request);
    const rl = await checkAdminRateLimit(ip);
    if (!rl.allowed) return rateLimitResponse(rl);

    const { email, customerName, tier, adminPassword } = await request.json();

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

    // Validate tier
    const validTier: ContentGeneratorTier = tier === 'full-fix' ? 'full-fix' : 'content-engine';

    // Grant access with tier
    const access = await grantContentGeneratorAccess(email, validTier, customerName);

    const tierName = validTier === 'full-fix' ? 'Full Fix' : 'Content Engine';
    return NextResponse.json({
      success: true,
      message: `Content Reaper (${tierName}) access granted to ${email}`,
      access,
    });

  } catch (error) {
    console.error('Error granting Content Generator access:', error);
    return NextResponse.json(
      { error: 'Failed to grant access' },
      { status: 500 }
    );
  }
}
