import { NextRequest, NextResponse } from 'next/server';
import { grantOpportunityHunterProAccess } from '@/lib/access-codes';

// Admin endpoint to manually grant Opportunity Hunter Pro access
export async function POST(request: NextRequest) {
  try {
    const { email, customerName, adminPassword } = await request.json();

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

    // Grant access
    const access = await grantOpportunityHunterProAccess(email, customerName);

    return NextResponse.json({
      success: true,
      message: `Opportunity Hunter Pro access granted to ${email}`,
      access,
    });

  } catch (error) {
    console.error('Error granting Opportunity Hunter Pro access:', error);
    return NextResponse.json(
      { error: 'Failed to grant access' },
      { status: 500 }
    );
  }
}
