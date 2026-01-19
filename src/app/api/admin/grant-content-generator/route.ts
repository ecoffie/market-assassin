import { NextRequest, NextResponse } from 'next/server';
import { grantContentGeneratorAccess, ContentGeneratorTier } from '@/lib/access-codes';

// Admin endpoint to manually grant GovCon Content Generator access
export async function POST(request: NextRequest) {
  try {
    const { email, customerName, tier, adminPassword } = await request.json();

    // Verify admin password
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';
    if (adminPassword !== expectedPassword) {
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
      message: `GovCon Content Generator (${tierName}) access granted to ${email}`,
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
