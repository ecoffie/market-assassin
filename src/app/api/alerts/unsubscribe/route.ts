import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { ensureFreeSettingsRow } from '@/lib/onboarding/ensure-free-settings-row';
import { UNSUBSCRIBE_PATH } from '@/lib/email/unsubscribe';
import { applyUnsubscribe, sendLegacyUnsubscribeLink, unsubscribePage } from '@/lib/email/unsubscribe-apply';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

/**
 * GET /api/alerts/unsubscribe?email=xxx — LEGACY link (still sitting in inboxes).
 *
 * It used to unsubscribe whatever address the URL named: anyone could unsubscribe anyone, and mail scanners that
 * pre-fetch links unsubscribed recipients who never clicked. It now writes NOTHING. If the address has a Mindy
 * settings row, it is emailed its own signed one-click link (at most once per 24 h), and the page says so without
 * confirming whether the address exists. Signed links (/api/unsubscribe) are the only path that unsubscribes.
 * A GET carrying the signed e/t parameters is forwarded there.
 */
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    if (q.get('e') && q.get('t')) {
      const url = new URL(UNSUBSCRIBE_PATH, request.nextUrl.origin);
      for (const k of ['e', 't', 's']) { const v = q.get(k); if (v) url.searchParams.set(k, v); }
      return NextResponse.redirect(url, 303);
    }
    const email = (q.get('email') || '').toLowerCase().trim();
    if (email && email.includes('@')) {
      await sendLegacyUnsubscribeLink(getSupabase(), email).catch((e) => console.error('[Unsubscribe] legacy link send failed:', e instanceof Error ? e.message : e));
    }
    return new NextResponse(unsubscribePage({ state: 'legacy_sent' }), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  } catch (error) {
    console.error('[Unsubscribe] Error:', error);
    return new NextResponse(unsubscribePage({ state: 'error' }), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

/**
 * POST /api/alerts/unsubscribe
 * API endpoint for unsubscribe
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // SECURITY: Verify user owns this email for POST requests
    // (GET is intentionally unauthenticated for CAN-SPAM one-click unsubscribe compliance)
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    // Authenticated: a signed-in user who unsubscribes before any settings row exists gets a
    // PAUSED row, so a row created later (setup, profile) can never start their alerts.
    const ensured = await ensureFreeSettingsRow(getSupabase(), auth.email!, { paused: true });
    if (ensured.outcome === 'failed') {
      console.error('[Unsubscribe] could not establish settings row:', ensured.error);
      return NextResponse.json({ success: false, error: 'Failed to unsubscribe' }, { status: 500 });
    }

    // Same write as the signed one-click link: suppression (all non-transactional mail) + alerts/briefings off.
    const applied = await applyUnsubscribe(getSupabase(), auth.email!.toLowerCase().trim(), { via: 'authenticated_post' });
    if (!applied.ok) {
      console.error('[Unsubscribe] Error:', applied.error);
      return NextResponse.json({ success: false, error: 'Failed to unsubscribe' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Successfully unsubscribed from Mindy alerts and briefings',
    });
  } catch (error) {
    console.error('[Unsubscribe] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
