/**
 * Lead attribution helpers — capture WHERE a free signup / lead-magnet capture
 * came from (YouTube, etc.) and push the contact into GHL for nurture.
 *
 * Two entry points feed this:
 *   - the free-signup route (/api/auth/mi-signup) → records signup_attribution
 *   - the lead-magnet capture route (/api/capture-lead) → stamps leads.utm_* + GHL push
 *
 * The client sends an `attribution` object read from the gca_attr cookie /
 * gca_attribution localStorage that AttributionTracker already maintains. This
 * module normalizes it and does the GHL upsert. GHL is the list home (Eric's
 * call) — captures land in the alumni location for the existing nurture rails.
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

export interface LeadAttribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  referrer?: string;
}

/**
 * Normalize whatever the client forwarded (a raw gca_attr AttributionState, or a
 * flat {utm_*} object) into a flat LeadAttribution. Safe on undefined/garbage.
 */
export function normalizeAttribution(raw: unknown): LeadAttribution {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  // gca_attr shape: { first_touch, last_touch, visit_count }. Prefer last_touch
  // (the click that converted); fall back to first_touch, then the flat object.
  const touch =
    (obj.last_touch as Record<string, unknown>) ||
    (obj.first_touch as Record<string, unknown>) ||
    obj;
  const pick = (k: string) => {
    const v = touch[k];
    return typeof v === 'string' && v ? v.slice(0, 250) : undefined;
  };
  return {
    utm_source: pick('utm_source'),
    utm_medium: pick('utm_medium'),
    utm_campaign: pick('utm_campaign'),
    utm_content: pick('utm_content'),
    referrer: pick('referrer'),
  };
}

/** True when this lead came from the YouTube funnel (any UTM source of youtube). */
export function isYouTubeSource(attr: LeadAttribution): boolean {
  return (attr.utm_source || '').toLowerCase() === 'youtube';
}

/**
 * Upsert a contact into GHL with source tags. Creates if new, updates tags if
 * existing (GHL's POST /contacts/ upserts by email within a location). Non-fatal:
 * returns {ok:false} instead of throwing so a GHL hiccup never blocks the capture.
 */
export async function pushLeadToGhl(params: {
  email: string;
  name?: string | null;
  company?: string | null;
  attr: LeadAttribution;
  /** extra tags beyond the auto source/campaign tags (e.g. the resource id) */
  tags?: string[];
}): Promise<{ ok: boolean; contactId?: string; error?: string }> {
  const token = (process.env.GHL_API_KEY || '').trim();
  const locationId = (process.env.GHL_LOCATION_ID || '').trim();
  if (!token || !locationId) {
    return { ok: false, error: 'GHL not configured' };
  }

  const { email, name, company, attr } = params;
  const src = (attr.utm_source || 'direct').toLowerCase();
  const tags = new Set<string>(params.tags || []);
  tags.add(`source-${src}`);
  if (src === 'youtube') tags.add('youtube-lead');
  if (attr.utm_campaign) tags.add(`campaign-${attr.utm_campaign}`.slice(0, 60));

  // Split a "First Last" into GHL's first/last fields when we have a name.
  const [firstName, ...rest] = (name || '').trim().split(/\s+/);
  const lastName = rest.join(' ') || undefined;

  try {
    const res = await fetch(`${GHL_BASE}/contacts/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Version: GHL_VERSION,
      },
      body: JSON.stringify({
        locationId,
        email: email.toLowerCase(),
        firstName: firstName || undefined,
        lastName,
        companyName: company || undefined,
        tags: [...tags],
        source: src === 'youtube' ? 'YouTube' : attr.utm_source || 'Mindy',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `GHL ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, contactId: data?.contact?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'GHL push failed' };
  }
}
