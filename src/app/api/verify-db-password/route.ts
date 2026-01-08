import { NextRequest, NextResponse } from 'next/server';

// Simple password for database access - you can share this with customers
const DB_PASSWORD = process.env.DB_ACCESS_PASSWORD || 'gcg-database-2024';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (!password) {
      return NextResponse.json({ success: false, error: 'Password required' }, { status: 400 });
    }

    if (password !== DB_PASSWORD) {
      return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
    }

    // Set cookie for access
    const response = NextResponse.json({ success: true });

    response.cookies.set('db_access_email', 'authorized-user', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Error verifying DB password:', error);
    return NextResponse.json({ success: false, error: 'Failed to verify password' }, { status: 500 });
  }
}
