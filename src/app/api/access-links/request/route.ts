import { NextRequest, NextResponse } from 'next/server';
import { AccessDestination, normalizeReturnTo, sendAccessLinkEmail, validateAccessRequest } from '@/lib/access-links';

export async function POST(request: NextRequest) {
  try {
    const { email, destination, returnTo } = await request.json() as { email?: string; destination?: AccessDestination; returnTo?: unknown };

    if (!email || !destination || !['briefings', 'preferences'].includes(destination)) {
      return NextResponse.json({ success: false, error: 'Email and destination are required' }, { status: 400 });
    }

    const validation = await validateAccessRequest(email, destination);
    if (!validation.ok) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 403 });
    }

    await sendAccessLinkEmail(email, destination, normalizeReturnTo(returnTo));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[AccessLinks] Request failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to send secure link' }, { status: 500 });
  }
}
