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
    default:
      return null;
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
      const { data: existingSend } = await supabase
        .from('email_provider_sends')
        .select('user_email,email_type,event_source,tags,metadata')
        .eq('provider', 'resend')
        .eq('provider_message_id', providerMessageId)
        .maybeSingle();

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
