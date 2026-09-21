import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (!password) {
      return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 });
    }

    // Check if this email has been granted access
    const email = password.toLowerCase().trim();
    const access = await kv.get(`dbaccess:${email}`);

    if (!access) {
      return NextResponse.json({ success: false, error: 'No access found for this email. Please purchase access or contact support.' }, { status: 401 });
    }

    // Set cookie for access
    const response = NextResponse.json({ success: true });

    response.cookies.set('db_access_email', email, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Error verifying DB access:', error);
    return NextResponse.json({ success: false, error: 'Failed to verify access' }, { status: 500 });
  }
}
