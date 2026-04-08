import { NextRequest, NextResponse } from 'next/server';
import { consumeAccessLink } from '@/lib/access-links';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json() as { token?: string };
    if (!token) {
      return NextResponse.json({ success: false, error: 'Token is required' }, { status: 400 });
    }

    const payload = await consumeAccessLink(token);
    if (!payload) {
      return NextResponse.json({ success: false, error: 'This secure link is invalid or has expired.' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      email: payload.email,
      destination: payload.destination,
      redirectTo: payload.destination === 'briefings' ? '/briefings' : '/alerts/preferences',
    });
  } catch (error) {
    console.error('[AccessLinks] Consume failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to verify secure link' }, { status: 500 });
  }
}
