import { NextRequest, NextResponse } from 'next/server';
import { getMarketAssassinAccess, MarketAssassinTier } from '@/lib/access-codes';

// Verify Market Assassin tier access by email
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email required' },
        { status: 400 }
      );
    }

    const access = await getMarketAssassinAccess(email);

    if (!access) {
      return NextResponse.json({
        hasAccess: false,
        tier: null,
        email: email.toLowerCase(),
      });
    }

    return NextResponse.json({
      hasAccess: true,
      tier: access.tier,
      email: access.email,
      customerName: access.customerName,
      createdAt: access.createdAt,
      upgradedAt: access.upgradedAt,
    });

  } catch (error) {
    console.error('Error verifying Market Assassin tier:', error);
    return NextResponse.json(
      { error: 'Failed to verify access' },
      { status: 500 }
    );
  }
}

// GET endpoint for checking access via query params
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Email required' },
        { status: 400 }
      );
    }

    const access = await getMarketAssassinAccess(email);

    if (!access) {
      return NextResponse.json({
        hasAccess: false,
        tier: null,
        email: email.toLowerCase(),
      });
    }

    return NextResponse.json({
      hasAccess: true,
      tier: access.tier,
      email: access.email,
      customerName: access.customerName,
    });

  } catch (error) {
    console.error('Error verifying Market Assassin tier:', error);
    return NextResponse.json(
      { error: 'Failed to verify access' },
      { status: 500 }
    );
  }
}
