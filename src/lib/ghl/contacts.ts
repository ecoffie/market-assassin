/**
 * GHL contact upsert — pushes contacts into a GoHighLevel LOCATION using a token
 * supplied by the caller (the user's OWN Private Integration Token, resolved from
 * user_crm_connections). Distinct from src/lib/ghl/sms.ts, which uses Mindy's own
 * agency token for outbound SMS — here the token + location belong to the USER.
 *
 * Uses GHL v2 `POST /contacts/upsert` (dedupes by email/phone within the location),
 * one call per contact so a single bad row can't sink the batch. The token needs
 * the `contacts.write` scope.
 */
import { normalizePhoneNumber } from '@/lib/ghl/sms';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

export interface CrmContactInput {
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  tags?: string[];
}

export interface CrmUpsertRow {
  input: CrmContactInput;
  status: 'created' | 'updated' | 'failed';
  contact_id?: string;
  error?: string;
}

export interface CrmUpsertResult {
  rows: CrmUpsertRow[];
  created: number;
  updated: number;
  failed: number;
  degraded: boolean; // an upstream GHL error occurred (distinct from a validation skip)
}

function ghlHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Version: GHL_VERSION };
}

/**
 * Upsert a batch of contacts into a GHL location. Each contact needs at least an
 * email or a phone. `extraTags` (e.g. a campaign/source tag) are merged onto every row.
 */
export async function upsertContactsBatch(
  token: string,
  locationId: string,
  contacts: CrmContactInput[],
  extraTags: string[] = [],
): Promise<CrmUpsertResult> {
  const rows: CrmUpsertRow[] = [];
  let degraded = false;

  for (const c of contacts) {
    const phone = c.phone ? normalizePhoneNumber(c.phone) : null;
    if (!c.email && !phone) {
      rows.push({ input: c, status: 'failed', error: 'contact needs an email or a valid phone' });
      continue;
    }
    const tags = Array.from(new Set([...(c.tags || []), ...extraTags].filter(Boolean)));
    const body: Record<string, unknown> = {
      locationId,
      ...(c.email ? { email: c.email } : {}),
      ...(phone ? { phone } : {}),
      ...(c.first_name ? { firstName: c.first_name } : {}),
      ...(c.last_name ? { lastName: c.last_name } : {}),
      ...(c.name && !c.first_name && !c.last_name ? { name: c.name } : {}),
      ...(c.company ? { companyName: c.company } : {}),
      ...(tags.length ? { tags } : {}),
    };
    try {
      const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
        method: 'POST',
        headers: ghlHeaders(token),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        degraded = true;
        const detail = await res.text().catch(() => '');
        rows.push({ input: c, status: 'failed', error: `GHL ${res.status}${detail ? `: ${detail.slice(0, 140)}` : ''}` });
        continue;
      }
      const data = (await res.json()) as { contact?: { id?: string }; new?: boolean };
      rows.push({ input: c, status: data.new ? 'created' : 'updated', contact_id: data.contact?.id });
    } catch (err) {
      degraded = true;
      rows.push({ input: c, status: 'failed', error: err instanceof Error ? err.message : 'request failed' });
    }
  }

  return {
    rows,
    created: rows.filter((r) => r.status === 'created').length,
    updated: rows.filter((r) => r.status === 'updated').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    degraded,
  };
}

/**
 * Validate a token + location by reading a couple of contacts (contacts.read).
 * Used by the connect flow so the user gets an immediate ok/failure.
 */
export async function verifyGhlConnection(token: string, locationId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}&limit=1`, {
      headers: ghlHeaders(token),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `GHL ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'request failed' };
  }
}
