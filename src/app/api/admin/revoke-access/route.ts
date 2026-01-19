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

    if (!product || !['market-assassin', 'opportunity-hunter-pro', 'content-generator', 'recompete', 'database'].includes(product)) {
      return NextResponse.json(
        { error: 'Valid product required (market-assassin, opportunity-hunter-pro, content-generator, recompete, or database)' },
        { status: 400 }
      );
    }

    const emailLower = email.toLowerCase();

    if (product === 'market-assassin') {
      // Delete Market Assassin access
      await kv.del(`ma:${emailLower}`);
      await kv.lrem('ma:all', 1, emailLower);
    } else if (product === 'opportunity-hunter-pro') {
      // Delete Opportunity Hunter Pro access
      await kv.del(`ospro:${emailLower}`);
      await kv.lrem('ospro:all', 1, emailLower);
    } else if (product === 'content-generator') {
      // Delete Content Generator access
      await kv.del(`contentgen:${emailLower}`);
      await kv.lrem('contentgen:all', 1, emailLower);
    } else if (product === 'recompete') {
      // Delete Recompete Contracts Tracker access
      await kv.del(`recompete:${emailLower}`);
      await kv.lrem('recompete:all', 1, emailLower);
    } else if (product === 'database') {
      // Delete Federal Contractor Database access
      const access = await kv.get<{ token: string }>(`dbaccess:${emailLower}`);
      if (access?.token) {
        await kv.del(`dbtoken:${access.token}`);
      }
      await kv.del(`dbaccess:${emailLower}`);
      await kv.lrem('db:all', 0, emailLower);
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
