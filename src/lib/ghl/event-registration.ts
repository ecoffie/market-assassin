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
  opts: {
    tags: string[];
    source: string;
    note?: string;
    /** Contact custom fields to set, e.g. [{ id, key, field_value }]. */
    customFields?: Array<{ id?: string; key?: string; field_value: string }>;
    fetchImpl?: typeof fetch;
  },
): Promise<EventRegistrationResult> {
  const token = (process.env.GHL_API_KEY || '').trim();
  const locationId = (process.env.GHL_LOCATION_ID || '').trim();
  if (!token || !locationId) return { ok: false, error: 'GHL not configured' };
  const f = opts.fetchImpl ?? fetch;

  const phone = reg.phone ? normalizePhoneNumber(reg.phone) : null;
  const email = reg.email.toLowerCase().trim();
  // Fields we write. locationId is only sent on create (the update endpoint rejects it).
  const fields: Record<string, unknown> = {
    email,
    firstName: reg.firstName.trim(),
    ...(reg.lastName?.trim() ? { lastName: reg.lastName.trim() } : {}),
    source: opts.source,
    ...(opts.customFields?.length ? { customFields: opts.customFields } : {}),
  };

  // MATCH BY EMAIL FIRST. /contacts/upsert can match on PHONE, so a registrant who
  // reuses a phone already on another contact was merged into THAT contact and kept
  // its old email: GHL reminders then went to someone else. Look the email up first;
  // update that contact if it exists, else create a new one. If GHL refuses the phone
  // (it belongs to another contact), save without it rather than fail the seat.
  const send = async (method: 'POST' | 'PUT', url: string, body: Record<string, unknown>) => {
    const res = await f(url, { method, headers: headers(token), body: JSON.stringify(body) });
    const text = res.ok ? '' : await res.text().catch(() => '');
    const data = res.ok ? await res.json().catch(() => ({})) : null;
    return { ok: res.ok, status: res.status, text, data };
  };

  let contactId: string | undefined;
  try {
    const dup = await f(
      `${GHL_BASE}/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&email=${encodeURIComponent(email)}`,
      { method: 'GET', headers: headers(token) },
    );
    const existingId: string | undefined = dup.ok ? (await dup.json().catch(() => ({})))?.contact?.id : undefined;

    if (existingId) {
      let r = await send('PUT', `${GHL_BASE}/contacts/${existingId}`, { ...fields, ...(phone ? { phone } : {}) });
      if (!r.ok && phone) r = await send('PUT', `${GHL_BASE}/contacts/${existingId}`, fields);
      if (!r.ok) return { ok: false, error: `GHL update ${r.status}: ${r.text.slice(0, 200)}` };
      contactId = existingId;
    } else {
      let r = await send('POST', `${GHL_BASE}/contacts/`, { locationId, ...fields, ...(phone ? { phone } : {}) });
      if (!r.ok && phone) r = await send('POST', `${GHL_BASE}/contacts/`, { locationId, ...fields });
      if (!r.ok) return { ok: false, error: `GHL create ${r.status}: ${r.text.slice(0, 200)}` };
      contactId = r.data?.contact?.id;
    }
    if (!contactId) return { ok: false, error: 'GHL returned no contact id' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'GHL contact write failed' };
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

export interface TaggedContact {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tags: string[];
  customFields: Array<{ id: string; value: unknown }>;
}

function ghlEnv(): { token: string; locationId: string } {
  const token = (process.env.GHL_API_KEY || '').trim();
  const locationId = (process.env.GHL_LOCATION_ID || '').trim();
  if (!token || !locationId) throw new Error('GHL not configured');
  return { token, locationId };
}

/** Every contact carrying `tag` (GHL stores tags lowercase), paged 500 at a time. */
export async function listContactsByTag(tag: string, fetchImpl: typeof fetch = fetch): Promise<TaggedContact[]> {
  const { token, locationId } = ghlEnv();
  const out: TaggedContact[] = [];
  let searchAfter: unknown = undefined;
  for (let page = 0; page < 40; page++) {
    const res = await fetchImpl(`${GHL_BASE}/contacts/search`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({
        locationId,
        pageLimit: 500,
        filters: [{ field: 'tags', operator: 'contains', value: tag.toLowerCase() }],
        sort: [{ field: 'dateAdded', direction: 'desc' }],
        ...(searchAfter ? { searchAfter } : {}),
      }),
    });
    if (!res.ok) throw new Error(`GHL search ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = await res.json();
    const contacts: Array<Record<string, unknown>> = data.contacts || [];
    for (const c of contacts) {
      out.push({
        id: String(c.id),
        email: String(c.email || '').toLowerCase(),
        firstName: String(c.firstName || ''),
        lastName: String(c.lastName || ''),
        tags: (c.tags as string[]) || [],
        customFields: (c.customFields as Array<{ id: string; value: unknown }>) || [],
      });
    }
    if (contacts.length < 500) break;
    searchAfter = contacts[contacts.length - 1].searchAfter;
  }
  return out;
}

/** Set custom fields on one contact. */
export async function updateContactFields(
  contactId: string,
  customFields: Array<{ id?: string; key?: string; field_value: string }>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { token } = ghlEnv();
  const res = await fetchImpl(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({ customFields }),
  });
  if (!res.ok) throw new Error(`GHL update ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

/** Add or remove tags on one contact (the tags endpoint keeps the contact's other tags). */
export async function changeContactTags(
  contactId: string,
  tags: string[],
  op: 'add' | 'remove',
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { token } = ghlEnv();
  const res = await fetchImpl(`${GHL_BASE}/contacts/${contactId}/tags`, {
    method: op === 'add' ? 'POST' : 'DELETE',
    headers: headers(token),
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) throw new Error(`GHL tag ${op} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}
