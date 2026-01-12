import { NextRequest, NextResponse } from 'next/server';

// Password for recompete access - share with customers after purchase
const RECOMPETE_PASSWORD = process.env.RECOMPETE_ACCESS_PASSWORD || 'gcg-recompete-2026';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (!password) {
      return NextResponse.json({ success: false, error: 'Password required' }, { status: 400 });
    }

    if (password !== RECOMPETE_PASSWORD) {
      return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
    }

    // Set cookie for access
    const response = NextResponse.json({ success: true });

    response.cookies.set('recompete_access', 'authorized-user', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Error verifying recompete password:', error);
    return NextResponse.json({ success: false, error: 'Failed to verify password' }, { status: 500 });
  }
}
