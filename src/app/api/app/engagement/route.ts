import { NextRequest, NextResponse } from 'next/server';
import { EventTypes, logEngagement } from '@/lib/engagement';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const ALLOWED_EVENT_TYPES = new Set<string>([
  EventTypes.PAGE_VIEW,
  EventTypes.LINK_CLICK,
  EventTypes.TOOL_USE,
  EventTypes.LOGIN,
  EventTypes.PROFILE_UPDATE,
  EventTypes.ONBOARDING_STEP,
  EventTypes.REPORT_GENERATE,
  EventTypes.EXPORT,
  EventTypes.FEEDBACK,
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

    // ── ANONYMOUS VISITORS ────────────────────────────────────────────────────────────────
    // Demo Day (2026-08-22) puts ~800 people on the map, almost none of them signed in on
    // first touch. _track used to return early without a token, so every one of those sessions
    // was invisible — and the share flywheel's whole premise is that a shared listing brings in
    // someone who is NOT a user yet. That arrival was, by construction, unmeasurable.
    //
    // user_engagement.user_email is NOT NULL, so an anonymous event needs a synthetic id rather
    // than a null: the client sends a stable per-browser "anon:<uuid>". Strictly validated so it
    // can never be used to forge events against a REAL account (no '@', fixed shape, length cap)
    // and it cannot collide with an email. Distinct anon ids = distinct anonymous visitors.
    const isAnon = /^anon:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(email);

    let resolvedEmail = email;
    if (!isAnon) {
      if (!email || !email.includes('@')) {
        return NextResponse.json({ success: false, error: 'Valid email is required' }, { status: 400 });
      }
      // SECURITY: Verify user owns this email.
      // requireStrongAuth SKIPS the two weak paths in verifyUserOwnsEmail: the spoofable
      // plaintext ma_access_email cookie, and "Method 4" which trusts ANY staff email with no
      // credential at all. MEASURED on prod 2026-08-21: POSTing {email:'eric@govcongiants.com'}
      // with NO token returned {"success":true} and wrote a row; a non-staff address correctly
      // 401'd. So anyone who knows a staff address could forge engagement events — and this table
      // is the ONLY proof of what happens on Demo Day, so a forged row is worse here than a lost
      // one. Anonymous visitors do not go through this branch at all: they carry an anon:<uuid>,
      // which is validated by shape above and can never name a real account.
      const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
      if (!auth.authenticated) {
        return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
      }
      resolvedEmail = auth.email!;
    }

    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return NextResponse.json({ success: false, error: 'Unsupported event type' }, { status: 400 });
    }

    const result = await logEngagement({
      userEmail: resolvedEmail,
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
    console.error('[app/engagement] Failed to record engagement:', error);
    return NextResponse.json({ success: false, error: 'Failed to record engagement' }, { status: 500 });
  }
}
