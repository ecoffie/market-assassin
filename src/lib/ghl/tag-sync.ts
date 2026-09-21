/**
 * GHL tag sync — write a Mindy profile-status tag onto existing GHL contacts so
 * marketing (the bootcamp win-back) can target users who still haven't configured
 * a real Mindy profile.
 *
 * GHL is the SOURCE OF TRUTH for these contacts (they were pushed FROM GHL into
 * Mindy via bootcamp-batch-enroll). We are NOT creating contacts here — only
 * tagging the ones that already exist, by email.
 *
 * Profile status mirrors the dashboard's hasCustomNaics definition:
 *   - has a custom NAICS (not the 5 seeded defaults), OR keywords, OR agencies
 *     => "mindy-configured"
 *   - otherwise => "mindy-profile-incomplete"
 *
 * Uses the GHL v2 API (services.leadconnectorhq.com) with a PIT key — same auth
 * shape as the funnels lead flow (src/lib/crm.ts).
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

export const TAG_CONFIGURED = 'mindy-configured';
export const TAG_INCOMPLETE = 'mindy-profile-incomplete';

// The 5-code starter set seeded by bulk enroll. Only these = NOT a real profile.
const DEFAULT_NAICS_SET = new Set(['541512', '541611', '541330', '541990', '561210']);

export function hasCustomProfile(
  naics: string[] | null | undefined,
  keywords: string[] | null | undefined,
  agencies: string[] | null | undefined,
): boolean {
  const n = naics || [];
  const k = keywords || [];
  const a = agencies || [];
  const customNaics = n.length > 0 && !n.every((c) => DEFAULT_NAICS_SET.has(c));
  return customNaics || k.length > 0 || a.length > 0;
}

function ghlHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Version: GHL_VERSION,
  };
}

/**
 * PROBE: confirm the token works and which location it belongs to — call this
 * BEFORE any tag writes when the location is unknown. Returns location name/id
 * and a small sample of contacts so a human can eyeball that it's the right account.
 */
export async function ghlProbe(token: string, locationId: string): Promise<{
  ok: boolean;
  status: number;
  locationName?: string;
  sampleContacts?: Array<{ email?: string; tags?: string[] }>;
  error?: string;
}> {
  // Optional: location name (nice-to-have). A PIT key may have Contacts scope but
  // NOT locations.readonly — don't hard-fail on that, just skip the name.
  let locationName: string | undefined;
  try {
    const locRes = await fetch(`${GHL_BASE}/locations/${locationId}`, { headers: ghlHeaders(token) });
    if (locRes.ok) {
      const loc = await locRes.json();
      locationName = loc?.location?.name || loc?.name;
    }
  } catch { /* locations scope optional */ }

  // The real validity check: can we read contacts in this location?
  const cRes = await fetch(`${GHL_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}&limit=3`, {
    headers: ghlHeaders(token),
  });
  if (!cRes.ok) {
    return { ok: false, status: cRes.status, error: (await cRes.text()).slice(0, 300) };
  }
  const cData = await cRes.json();
  return {
    ok: true,
    status: cRes.status,
    locationName,
    sampleContacts: (cData.contacts || []).map((c: { email?: string; tags?: string[] }) => ({
      email: c.email,
      tags: c.tags,
    })),
  };
}

/**
 * Find a GHL contact id by email (within the location). Returns null if not found.
 *
 * NB: GHL's /contacts/search wants a `query` STRING for email lookup — the
 * filters:[{field:'email',operator:'eq'}] shape returns nothing (silent false
 * negatives). We query then verify an EXACT case-insensitive email match so a
 * partial/fuzzy hit never tags the wrong contact.
 */
export async function findContactIdByEmail(
  token: string,
  locationId: string,
  email: string,
): Promise<string | null> {
  const res = await fetch(`${GHL_BASE}/contacts/search`, {
    method: 'POST',
    headers: ghlHeaders(token),
    body: JSON.stringify({ locationId, pageLimit: 5, query: email }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const want = email.toLowerCase().trim();
  const match = (data?.contacts || []).find(
    (c: { id?: string; email?: string }) => (c.email || '').toLowerCase().trim() === want,
  );
  return match?.id || null;
}

/**
 * Add a tag to an existing contact WITHOUT clobbering its other tags
 * (GHL's dedicated tag endpoint is additive). Returns true on success.
 */
export async function addTagToContact(
  token: string,
  contactId: string,
  tags: string[],
): Promise<boolean> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: ghlHeaders(token),
    body: JSON.stringify({ tags }),
  });
  return res.ok;
}

/** Remove a tag from a contact (used to clear the opposite status tag). */
export async function removeTagFromContact(
  token: string,
  contactId: string,
  tags: string[],
): Promise<boolean> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
    method: 'DELETE',
    headers: ghlHeaders(token),
    body: JSON.stringify({ tags }),
  });
  return res.ok;
}
