import { NextRequest, NextResponse } from 'next/server';

// Simple password for Market Assassin access - you can share this with customers
const MA_PASSWORD = process.env.MA_ACCESS_PASSWORD || 'gcg-assassin-2024';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (!password) {
      return NextResponse.json({ success: false, error: 'Password required' }, { status: 400 });
    }

    if (password !== MA_PASSWORD) {
      return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
    }

    // Set cookie for access
    const response = NextResponse.json({ success: true });

    response.cookies.set('ma_access_email', 'authorized-user', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Error verifying MA password:', error);
    return NextResponse.json({ success: false, error: 'Failed to verify password' }, { status: 500 });
  }
}
