import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSecureAccessUrl } from '@/lib/access-links';

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

    // Deactivate alerts for this user (unified table)
    const { error } = await getSupabase()
      .from('user_notification_settings')
      .update({
        alerts_enabled: false,
        alert_frequency: 'paused',
        updated_at: new Date().toISOString(),
      })
      .eq('user_email', email.toLowerCase());

    if (error) {
      console.error('[Unsubscribe] Error:', error);
      return new NextResponse(await getUnsubscribePage('error', 'Failed to unsubscribe'), {
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

    const { error } = await getSupabase()
      .from('user_notification_settings')
      .update({
        alerts_enabled: false,
        alert_frequency: 'paused',
        updated_at: new Date().toISOString(),
      })
      .eq('user_email', email.toLowerCase());

    if (error) {
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
async function getUnsubscribePage(status: 'success' | 'error', message: string): Promise<string> {
  const isSuccess = status === 'success';
  const resubscribeUrl = isSuccess ? await createSecureAccessUrl(message, 'preferences') : '/alerts/preferences';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isSuccess ? 'Unsubscribed' : 'Error'} - GovCon Giants</title>
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
      color: ${isSuccess ? '#166534' : '#dc2626'};
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
    <div class="icon">${isSuccess ? '✅' : '❌'}</div>
    <h1>${isSuccess ? 'Unsubscribed' : 'Error'}</h1>
    ${isSuccess ? `
      <p>You've been unsubscribed from daily opportunity alerts.</p>
      <p class="email">${message}</p>
      <p style="margin-top: 24px; font-size: 14px;">
        Changed your mind? <a href="${resubscribeUrl}">Resubscribe</a>
      </p>
    ` : `
      <p>${message}</p>
      <p>Please contact <a href="mailto:service@govcongiants.com">service@govcongiants.com</a> for help.</p>
    `}
    <a href="https://shop.govcongiants.org" class="btn">Return to GovCon Giants</a>
  </div>
</body>
</html>
`;
}
