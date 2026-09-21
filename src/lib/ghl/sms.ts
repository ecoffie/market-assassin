/**
 * GHL SMS sender — Mindy's outbound texts route through GoHighLevel (NOT the
 * app's raw Twilio number), because GHL is where our A2P 10DLC registration +
 * verified sending numbers live. Sending via GHL reuses that compliant infra
 * instead of maintaining a parallel Twilio brand/campaign.
 *
 * Flow (GHL v2 API, services.leadconnectorhq.com):
 *   1. Upsert a contact by phone within the Mindy location → contactId.
 *   2. POST /conversations/messages { type:'SMS', contactId, message }.
 *
 * The message appears in GHL's conversation history for that contact — fine,
 * GHL is already our contact system of record (src/lib/ghl/tag-sync.ts).
 *
 * Auth: GHL_API_KEY (Private Integration token, "Mindy SMS Alerts") with
 * contacts.write + conversations/message.write scope. GHL_LOCATION_ID targets
 * the Govcon EDU (Mindy) sub-account.
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

function ghlHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Version: GHL_VERSION,
  };
}

/**
 * Normalize a phone number to E.164 (US-friendly). Returns null if it can't be
 * coerced to a plausible E.164 number. Lives here because SMS is the only thing
 * that needs it now (moved off the old Twilio sender).
 */
export function normalizePhoneNumber(phone: string): string | null {
  const cleaned = (phone || '').replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+1') && cleaned.length === 12) return cleaned;
  if (cleaned.startsWith('+')) return cleaned.length >= 10 ? cleaned : null;
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  return null;
}

export interface GhlSmsResult {
  success: boolean;
  contactId?: string;
  messageId?: string;
  error?: string;
  /**
   * True when GHL refused the send because the contact has unsubscribed / is in
   * SMS DND (they texted STOP). GHL is the source of truth for opt-out and hard-
   * blocks the send itself, so this is not a real failure — it means "skip, they
   * opted out." Callers should mirror this to sms_opted_out and NOT log an error.
   */
  optedOut?: boolean;
}

/**
 * Upsert a GHL contact by phone (E.164) and return its id. Upsert is idempotent:
 * an existing contact with that phone is returned, not duplicated.
 */
async function upsertContactByPhone(
  token: string,
  locationId: string,
  phone: string,
): Promise<{ contactId?: string; error?: string }> {
  const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: 'POST',
    headers: ghlHeaders(token),
    body: JSON.stringify({ locationId, phone }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: data?.message || `contact upsert failed (${res.status})` };
  }
  const contactId = data?.contact?.id || data?.id;
  if (!contactId) return { error: 'no contactId returned from upsert' };
  return { contactId };
}

/**
 * Send an SMS to a phone number through GHL. Returns { success, messageId }.
 * Caller supplies an E.164 phone (normalize before calling).
 */
export async function sendViaGHL(phone: string, body: string): Promise<GhlSmsResult> {
  const token = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    return { success: false, error: 'GHL not configured (GHL_API_KEY / GHL_LOCATION_ID)' };
  }

  const { contactId, error: upsertErr } = await upsertContactByPhone(token, locationId, phone);
  if (!contactId) return { success: false, error: upsertErr || 'contact upsert failed' };

  const res = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: ghlHeaders(token),
    body: JSON.stringify({ type: 'SMS', contactId, message: body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // GHL enforces STOP itself: a send to an unsubscribed contact returns 400
    // CONVERSATIONS_MSG_UNSUBSCRIBED_SMS. That's not a failure — it's the carrier/
    // GHL honoring opt-out. Surface it as optedOut so callers can sync our flag.
    const optedOut =
      data?.canonicalCode === 'CONVERSATIONS_MSG_UNSUBSCRIBED_SMS' ||
      /unsubscribed/i.test(String(data?.message || ''));
    return {
      success: false,
      contactId,
      optedOut,
      error: data?.message || `message send failed (${res.status})`,
    };
  }
  return {
    success: true,
    contactId,
    messageId: data?.messageId || data?.conversationId || data?.id,
  };
}
