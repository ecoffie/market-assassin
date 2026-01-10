import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

// Admin endpoint to revoke access
export async function POST(request: NextRequest) {
  try {
    const { email, product, adminPassword } = await request.json();

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

    if (!product || !['market-assassin', 'opportunity-scout-pro'].includes(product)) {
      return NextResponse.json(
        { error: 'Valid product required (market-assassin or opportunity-scout-pro)' },
        { status: 400 }
      );
    }

    const emailLower = email.toLowerCase();

    if (product === 'market-assassin') {
      // Delete Market Assassin access
      await kv.del(`ma:${emailLower}`);
      await kv.lrem('ma:all', 1, emailLower);
    } else if (product === 'opportunity-scout-pro') {
      // Delete Opportunity Scout Pro access
      await kv.del(`ospro:${emailLower}`);
      await kv.lrem('ospro:all', 1, emailLower);
    }

    return NextResponse.json({
      success: true,
      message: `Access revoked for ${email} (${product})`,
    });

  } catch (error) {
    console.error('Error revoking access:', error);
    return NextResponse.json(
      { error: 'Failed to revoke access' },
      { status: 500 }
    );
  }
}
