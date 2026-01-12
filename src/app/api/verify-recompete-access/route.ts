import { NextRequest, NextResponse } from 'next/server';
import { hasRecompeteAccess } from '@/lib/access-codes';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 });
    }

    const hasAccess = await hasRecompeteAccess(email);

    if (!hasAccess) {
      return NextResponse.json({ success: false, error: 'No access found for this email' }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error verifying recompete access:', error);
    return NextResponse.json({ success: false, error: 'Failed to verify access' }, { status: 500 });
  }
}
