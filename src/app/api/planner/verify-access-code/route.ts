import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ valid: false, error: 'Access code is required' }, { status: 400 });
    }

    const validCode = process.env.PLANNER_ACCESS_CODE;

    if (!validCode) {
      console.error('PLANNER_ACCESS_CODE environment variable is not set');
      return NextResponse.json({ valid: false, error: 'Access code verification unavailable' }, { status: 500 });
    }

    const valid = code.trim().toUpperCase() === validCode.trim().toUpperCase();

    return NextResponse.json({ valid });
  } catch (error) {
    console.error('Error verifying access code:', error);
    return NextResponse.json({ valid: false, error: 'Verification failed' }, { status: 500 });
  }
}
