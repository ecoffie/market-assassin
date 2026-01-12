import { NextRequest, NextResponse } from 'next/server';
import { grantRecompeteAccess } from '@/lib/access-codes';

// Admin endpoint to manually grant Recompete Contracts Tracker access
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
    const access = await grantRecompeteAccess(email, customerName);

    return NextResponse.json({
      success: true,
      message: `Recompete Contracts Tracker access granted to ${email}`,
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
