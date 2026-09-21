import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export const runtime = 'nodejs';

type JsonRecord = Record<string, unknown>;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeEmail(value: unknown): string | null {
  if (Array.isArray(value)) {
    return normalizeEmail(value[0]);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim().toLowerCase() || null;
}

function tagsArrayToObject(tags: unknown): JsonRecord {
  if (Array.isArray(tags)) {
    return tags.reduce<JsonRecord>((acc, tag) => {
      const row = asRecord(tag);
      const name = asString(row.name);
      if (name) {
        acc[name] = row.value ?? '';
      }
      return acc;
    }, {});
  }
  return asRecord(tags);
}

function getProviderMessageId(data: JsonRecord): string | null {
  const nestedEmail = asRecord(data.email);
  return asString(data.email_id)
    || asString(data.emailId)
    || asString(data.message_id)
    || asString(data.id)
    || asString(nestedEmail.id);
}

function getEventTimestamp(payload: JsonRecord, data: JsonRecord): string {
  return asString(payload.created_at)
    || asString(payload.createdAt)
    || asString(data.created_at)
    || asString(data.createdAt)
    || new Date().toISOString();
}

function statusForEvent(eventType: string): string | null {
  switch (eventType) {
    case 'email.delivered':
      return 'delivered';
    case 'email.bounced':
      return 'bounced';
    case 'email.complained':
      return 'complained';
    case 'email.delivery_delayed':
      return 'delayed';
    case 'email.sent':
      return 'sent';
    // opened/clicked deliberately return null: they are ENGAGEMENT, not delivery
    // state, and must not overwrite a send's terminal status. They are still
    // recorded as rows in email_provider_events and folded into the user's
    // engagement counters below (recordEngagement).
    default:
      return null;
  }
}

/**
 * Fold an open/click into the user's engagement counters.
 *
 * WHY: alerts_opened_30d was 100% ZERO across all 1,792 alert-enabled users — the
 * column existed but NOTHING ever wrote it (data-invariants 2026-07-27,
 * `alerts.dead_engagement_telemetry_pct`). That made "are they even reading these?"
 * unanswerable, which in turn blocked a real product decision about 279 users
 * receiving default-profile alerts. Delivery events alone can't answer it.
 *
 * Counts are incremented, never recomputed here; the 30-day window is trimmed by
 * the existing profile-aggregation cron. Failure is non-fatal: engagement telemetry
 * must never break webhook ingestion (a 500 makes Resend retry a delivery event).
 */
async function recordEngagement(
  supabase: ReturnType<typeof getSupabase>,
  eventType: string,
  userEmail: string | null,
): Promise<void> {
  if (!userEmail) return;
  const isOpen = eventType === 'email.opened';
  const isClick = eventType === 'email.clicked';
  if (!isOpen && !isClick) return;

  try {
    const { data: row, error } = await supabase
      .from('user_notification_settings')
      .select('alerts_opened_30d')
      .eq('user_email', userEmail)
      .maybeSingle();
    if (error) {
      console.error('[resend-webhook] engagement lookup failed:', error.message);
      return;
    }
    if (!row) return; // not an alert subscriber — nothing to attribute

    const patch: Record<string, unknown> = {};
    if (isOpen) patch.alerts_opened_30d = Number(row.alerts_opened_30d ?? 0) + 1;
    // A click implies engagement even if the open pixel was blocked (Apple Mail
    // Privacy Protection etc.), so stamp last_click_at on clicks too.
    if (isClick) patch.last_click_at = new Date().toISOString();

    const { error: upErr } = await supabase
      .from('user_notification_settings')
      .update(patch)
      .eq('user_email', userEmail);
    if (upErr) console.error('[resend-webhook] engagement update failed:', upErr.message);
  } catch (err) {
    console.error('[resend-webhook] recordEngagement threw (non-fatal):', err);
  }
}

async function verifyResendWebhook(rawPayload: string, request: NextRequest): Promise<JsonRecord> {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('RESEND_WEBHOOK_SECRET is not configured');
  }

  const resend = new Resend(process.env.RESEND_API_KEY || 're_missing');
  const verified = resend.webhooks.verify({
    payload: rawPayload,
    webhookSecret,
    headers: {
      id: request.headers.get('svix-id') || '',
      timestamp: request.headers.get('svix-timestamp') || '',
      signature: request.headers.get('svix-signature') || '',
    },
  });

  return asRecord(verified);
}

export async function POST(request: NextRequest) {
  const rawPayload = await request.text();
  const supabase = getSupabase();

  try {
    const payload = await verifyResendWebhook(rawPayload, request);
    const data = asRecord(payload.data);
    const eventType = asString(payload.type) || 'unknown';
    const providerEventId = request.headers.get('svix-id') || asString(payload.id);
    const providerMessageId = getProviderMessageId(data);

    let sendRecord: JsonRecord | null = null;
    if (providerMessageId) {
      const { data: existingSend, error: existingSendErr } = await supabase
        .from('email_provider_sends')
        .select('user_email,email_type,event_source,tags,metadata')
        .eq('provider', 'resend')
        .eq('provider_message_id', providerMessageId)
        .maybeSingle();
      if (existingSendErr) console.error('[resend-webhook] send lookup query error:', existingSendErr.message);

      sendRecord = existingSend || null;
    }

    const tags = {
      ...tagsArrayToObject(data.tags),
      ...asRecord(sendRecord?.tags),
    };
    const metadata = {
      ...asRecord(sendRecord?.metadata),
      resend: {
        from: data.from ?? null,
        to: data.to ?? null,
        subject: data.subject ?? null,
        click: data.click ?? null,
      },
    };

    const userEmail = normalizeEmail(data.to)
      || normalizeEmail(data.email)
      || normalizeEmail(sendRecord?.user_email);
    const emailType = asString(sendRecord?.email_type) || asString(tags.email_type);
    const eventSource = asString(sendRecord?.event_source) || asString(tags.event_source);
    const occurredAt = getEventTimestamp(payload, data);

    const { error: insertError } = await supabase
      .from('email_provider_events')
      .insert({
        provider: 'resend',
        provider_event_id: providerEventId,
        provider_message_id: providerMessageId,
        event_type: eventType,
        user_email: userEmail,
        email_type: emailType,
        event_source: eventSource,
        tags,
        metadata,
        raw_payload: payload,
        occurred_at: occurredAt,
      });

    if (insertError && insertError.code !== '23505') {
      throw insertError;
    }

    // Engagement (open/click) → the user's counters. Non-fatal by design.
    await recordEngagement(supabase, eventType, userEmail);

    const status = statusForEvent(eventType);
    if (status && providerMessageId) {
      await supabase
        .from('email_provider_sends')
        .update({ status })
        .eq('provider', 'resend')
        .eq('provider_message_id', providerMessageId);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[ResendWebhook] Error:', error);
    return NextResponse.json({ error: 'Webhook rejected' }, { status: 400 });
  }
}
