/**
 * Event registration → GoHighLevel.
 *
 * Upserts the registrant into Mindy's GHL location (GHL_API_KEY / GHL_LOCATION_ID,
 * the same location lead-attribution.ts and sms.ts use), then ADDS the event tag
 * with the additive tags endpoint so an existing contact keeps its other tags.
 * (Sending tags inside /contacts/upsert can replace a contact's tag list.)
 *
 * Unlike lead captures, a failed GHL push here is a FAILED registration: the
 * whole event runs on GHL workflows, so a registrant who never reaches GHL never
 * gets the confirmation or the join link. The route surfaces the error.
 */
import { normalizePhoneNumber } from '@/lib/ghl/sms';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

export interface EventRegistrant {
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  smsConsent: boolean;
  ownsBusiness?: string;
  samRegistered?: string;
}

export interface EventRegistrationResult {
  ok: boolean;
  contactId?: string;
  error?: string;
}

function headers(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Version: GHL_VERSION };
}

export async function registerContactForEvent(
  reg: EventRegistrant,
  opts: { tags: string[]; source: string; note?: string; fetchImpl?: typeof fetch },
): Promise<EventRegistrationResult> {
  const token = (process.env.GHL_API_KEY || '').trim();
  const locationId = (process.env.GHL_LOCATION_ID || '').trim();
  if (!token || !locationId) return { ok: false, error: 'GHL not configured' };
  const f = opts.fetchImpl ?? fetch;

  const phone = reg.phone ? normalizePhoneNumber(reg.phone) : null;
  const body: Record<string, unknown> = {
    locationId,
    email: reg.email.toLowerCase().trim(),
    firstName: reg.firstName.trim(),
    ...(reg.lastName?.trim() ? { lastName: reg.lastName.trim() } : {}),
    ...(phone ? { phone } : {}),
    source: opts.source,
  };

  let contactId: string | undefined;
  try {
    const res = await f(`${GHL_BASE}/contacts/upsert`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `GHL upsert ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    contactId = data?.contact?.id;
    if (!contactId) return { ok: false, error: 'GHL upsert returned no contact id' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'GHL upsert failed' };
  }

  try {
    const res = await f(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ tags: opts.tags }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, contactId, error: `GHL tag ${res.status}: ${text.slice(0, 200)}` };
    }
  } catch (err) {
    return { ok: false, contactId, error: err instanceof Error ? err.message : 'GHL tag failed' };
  }

  // Qualifier answers as a contact note. Best-effort: the tag is what matters.
  if (opts.note) {
    try {
      await f(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ body: opts.note }),
      });
    } catch {
      /* non-fatal */
    }
  }

  return { ok: true, contactId };
}
