import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSecureAccessUrl } from '@/lib/access-links';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { ensureFreeSettingsRow } from '@/lib/onboarding/ensure-free-settings-row';

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
 * GET /api/alerts/unsubscribe?email=xxx
 * One-click unsubscribe from alerts (CAN-SPAM compliant)
 */
export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get('email');

    if (!email) {
      return new NextResponse(await getUnsubscribePage('error', 'No email provided'), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Deactivate alerts for this user (unified table). Counted: a bare update that matched 0 rows
    // used to render "Unsubscribed" for an address we hold no settings for (P0-H). This GET is
    // unauthenticated (CAN-SPAM one-click), so it must NOT create a row for an arbitrary address —
    // it reports the truth instead. Every alert sender mails only addresses that HAVE a row.
    const { count, error } = await getSupabase()
      .from('user_notification_settings')
      .update({
        alerts_enabled: false,
        alert_frequency: 'paused',
        updated_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('user_email', email.toLowerCase().trim());

    if (error || count == null) {
      console.error('[Unsubscribe] Error:', error?.message ?? 'update count unknown');
      return new NextResponse(await getUnsubscribePage('error', 'Failed to unsubscribe'), {
        headers: { 'Content-Type': 'text/html' },
      });
    }
    if (count === 0) {
      return new NextResponse(await getUnsubscribePage('none', email), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    console.log(`[Unsubscribe] Unsubscribed ${email} from alerts`);

    return new NextResponse(await getUnsubscribePage('success', email), {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (error) {
    console.error('[Unsubscribe] Error:', error);
    return new NextResponse(await getUnsubscribePage('error', 'Something went wrong'), {
      headers: { 'Content-Type': 'text/html' },
    });
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

    const { count, error } = await getSupabase()
      .from('user_notification_settings')
      .update({
        alerts_enabled: false,
        alert_frequency: 'paused',
        updated_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('user_email', auth.email!.toLowerCase().trim());

    if (error || !count) {
      console.error('[Unsubscribe] Error:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to unsubscribe' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Successfully unsubscribed from alerts',
    });
  } catch (error) {
    console.error('[Unsubscribe] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Generate HTML page for unsubscribe confirmation
// Every interpolated value is escaped: `message` carries the raw ?email= query value, which used to
// be reflected into this page unescaped (SEC-5).
function escapeHtml(v: string): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

async function getUnsubscribePage(status: 'success' | 'error' | 'none', rawMessage: string): Promise<string> {
  const isSuccess = status === 'success';
  const isNone = status === 'none';
  const message = escapeHtml(rawMessage);
  const resubscribeUrl = escapeHtml(isSuccess ? await createSecureAccessUrl(rawMessage, 'preferences') : '/alerts/preferences');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isSuccess ? 'Unsubscribed' : isNone ? 'No alerts' : 'Error'} - GovCon Giants</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f3f4f6;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      padding: 40px;
      max-width: 400px;
      text-align: center;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      color: ${isSuccess || isNone ? '#166534' : '#dc2626'};
      font-size: 24px;
      margin: 0 0 16px 0;
    }
    p {
      color: #6b7280;
      margin: 0 0 24px 0;
      line-height: 1.6;
    }
    .email {
      background: #f3f4f6;
      padding: 8px 16px;
      border-radius: 6px;
      font-family: monospace;
      color: #374151;
    }
    a {
      color: #2563eb;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .btn {
      display: inline-block;
      background: #1e3a8a;
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 500;
      margin-top: 16px;
    }
    .btn:hover {
      background: #1e40af;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isSuccess || isNone ? '✅' : '❌'}</div>
    <h1>${isSuccess ? 'Unsubscribed' : isNone ? 'No alerts for this address' : 'Error'}</h1>
    ${isNone ? `
      <p>Mindy has no alert settings for this address, so it is not being sent opportunity alerts. Nothing was changed.</p>
      <p class="email">${message}</p>
    ` : isSuccess ? `
      <p>You've been unsubscribed from daily opportunity alerts.</p>
      <p class="email">${message}</p>
      <p style="margin-top: 24px; font-size: 14px;">
        Changed your mind? <a href="${resubscribeUrl}">Resubscribe</a>
      </p>
    ` : `
      <p>${message}</p>
      <p>Please contact <a href="mailto:hello@getmindy.ai">hello@getmindy.ai</a> for help.</p>
    `}
    <a href="https://shop.govcongiants.com" class="btn">Return to GovCon Giants</a>
  </div>
</body>
</html>
`;
}
