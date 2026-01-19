import { NextRequest, NextResponse } from 'next/server';
import { hasOpportunityHunterProAccess, getOpportunityHunterProAccess } from '@/lib/access-codes';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email required' },
        { status: 400 }
      );
    }

    const hasAccess = await hasOpportunityHunterProAccess(email);

    if (hasAccess) {
      const accessData = await getOpportunityHunterProAccess(email);
      return NextResponse.json({
        hasAccess: true,
        email: email.toLowerCase(),
        grantedAt: accessData?.createdAt,
        productId: 'opportunity-scout-pro',
      });
    }

    return NextResponse.json({
      hasAccess: false,
      email: email.toLowerCase(),
    });

  } catch (error) {
    console.error('Error verifying Opportunity Hunter Pro access:', error);
    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 500 }
    );
  }
}
