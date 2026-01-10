import { NextRequest, NextResponse } from 'next/server';
import { hasOpportunityScoutProAccess, getOpportunityScoutProAccess } from '@/lib/access-codes';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email required' },
        { status: 400 }
      );
    }

    const hasAccess = await hasOpportunityScoutProAccess(email);

    if (hasAccess) {
      const accessData = await getOpportunityScoutProAccess(email);
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
    console.error('Error verifying Opportunity Scout Pro access:', error);
    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 500 }
    );
  }
}
