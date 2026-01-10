import { NextRequest, NextResponse } from 'next/server';

// Admin endpoint to verify password
export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    // Verify admin password
    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (password === expectedPassword) {
      return NextResponse.json({ valid: true });
    } else {
      return NextResponse.json({ valid: false });
    }

  } catch (error) {
    console.error('Error verifying password:', error);
    return NextResponse.json(
      { error: 'Failed to verify password' },
      { status: 500 }
    );
  }
}
