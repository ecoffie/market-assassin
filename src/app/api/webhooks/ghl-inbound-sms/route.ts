/**
 * POST /api/webhooks/ghl-inbound-sms
 *
 * Inbound SMS from GoHighLevel. Fires when a user texts back on the Mindy SMS
 * number. Purpose: honor STOP/UNSUBSCRIBE (set sms_opted_out=true + turn SMS off)
 * and START (clear opt-out) so our DB stays in sync with what the carrier/GHL
 * already enforces. Our pursuit-changes cron gates on sms_opted_out, so this is
 * what makes an in-app STOP actually stop our alerts.
 *
 * GHL delivers this via a workflow: trigger "Customer Replied" (SMS) → Webhook
 * action → this URL. GHL's payload shape varies by config, so we parse phone +
 * body defensively from several common field names.
 *
 * Security: GHL webhooks don't sign requests by default, so we accept an optional
 * shared secret via ?token= (set GHL_INBOUND_WEBHOOK_SECRET) — if configured, it
 * must match. Without it we still process (the action is idempotent + limited to
 * flipping opt-out on a phone that matches a stored number).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizePhoneNumber } from '@/lib/ghl/sms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// Pull phone + message body out of whatever shape GHL sends.
function parsePayload(body: Record<string, unknown>): { phone: string | null; text: string } {
  // GHL may put the workflow "Custom Data" at the top level OR nested under
  // customData / data / payload. Merge those so we find the fields either way.
  const cd = (body.customData || body.custom_data || body.data || body.payload || {}) as Record<string, unknown>;
  const get = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (body[k] != null && body[k] !== '') return body[k];
      if (cd[k] != null && cd[k] !== '') return cd[k];
    }
    return '';
  };
  const phoneRaw =
    get('phone', 'phoneNumber', 'from', 'contactPhone') ||
    (body.contact as Record<string, unknown> | undefined)?.phone || '';
  const textRaw = get('message', 'body', 'sms', 'text', 'messageBody');
  return { phone: normalizePhoneNumber(String(phoneRaw)), text: String(textRaw || '') };
}

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'STOP ALL']);
const START_WORDS = new Set(['START', 'YES', 'UNSTOP', 'SUBSCRIBE']);

export async function POST(request: NextRequest) {
  // Optional shared-secret gate.
  const requiredSecret = process.env.GHL_INBOUND_WEBHOOK_SECRET;
  if (requiredSecret) {
    const token = request.nextUrl.searchParams.get('token');
    if (token !== requiredSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // GHL may send form-encoded in some configs.
    try {
      const form = await request.formData();
      body = Object.fromEntries(form.entries());
    } catch {
      return NextResponse.json({ success: false, error: 'unparseable body' }, { status: 400 });
    }
  }

  const { phone, text } = parsePayload(body);
  if (!phone) {
    // Nothing to match on — ack so GHL doesn't retry.
    return NextResponse.json({ success: true, matched: false, reason: 'no phone' });
  }

  const keyword = text.trim().toUpperCase();
  const isStop = STOP_WORDS.has(keyword);
  const isStart = START_WORDS.has(keyword);

  if (!isStop && !isStart) {
    // Not a control keyword — nothing for us to do (HELP is auto-answered by GHL).
    return NextResponse.json({ success: true, matched: true, action: 'none' });
  }

  const supabase = getSupabase();
  // Match the user by their stored phone (E.164). A number could belong to more
  // than one account in theory — update all matches (each opted in with it).
  const update = isStop
    ? { sms_opted_out: true, sms_enabled: false, updated_at: new Date().toISOString() }
    : { sms_opted_out: false, updated_at: new Date().toISOString() };

  const { data, error } = await supabase
    .from('user_notification_settings')
    .update(update)
    .eq('phone_number', phone)
    .select('user_email');

  if (error) {
    console.error('[ghl-inbound-sms] update error', error.message);
    return NextResponse.json({ success: false, error: 'update failed' }, { status: 500 });
  }

  console.log(
    `[ghl-inbound-sms] ${isStop ? 'STOP' : 'START'} from ${phone} → ${data?.length ?? 0} account(s) updated`,
  );

  return NextResponse.json({
    success: true,
    matched: (data?.length ?? 0) > 0,
    action: isStop ? 'opted_out' : 'opted_in',
    accountsUpdated: data?.length ?? 0,
  });
}

// GHL may probe the URL with a GET when you save the webhook — respond OK.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'ghl-inbound-sms', method: 'POST' });
}
