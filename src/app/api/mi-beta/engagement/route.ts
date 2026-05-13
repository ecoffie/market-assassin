import { NextRequest, NextResponse } from 'next/server';
import { EventTypes, logEngagement } from '@/lib/engagement';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const ALLOWED_EVENT_TYPES = new Set<string>([
  EventTypes.PAGE_VIEW,
  EventTypes.TOOL_USE,
  EventTypes.LOGIN,
  EventTypes.PROFILE_UPDATE,
  EventTypes.ONBOARDING_STEP,
  EventTypes.REPORT_GENERATE,
  EventTypes.EXPORT,
]);

function getClientIp(request: NextRequest): string | undefined {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email || '').toLowerCase().trim();
    const eventType = String(body.eventType || '');
    const eventSource = typeof body.eventSource === 'string' ? body.eventSource : 'market_intelligence';
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};

    if (!email || !email.includes('@')) {
      return NextResponse.json({ success: false, error: 'Valid email is required' }, { status: 400 });
    }

    // SECURITY: Verify user owns this email
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) {
      return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
    }

    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return NextResponse.json({ success: false, error: 'Unsupported event type' }, { status: 400 });
    }

    const result = await logEngagement({
      userEmail: auth.email!,
      eventType: eventType as typeof EventTypes[keyof typeof EventTypes],
      eventSource,
      metadata,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent') || undefined,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[mi-beta/engagement] Failed to record engagement:', error);
    return NextResponse.json({ success: false, error: 'Failed to record engagement' }, { status: 500 });
  }
}
