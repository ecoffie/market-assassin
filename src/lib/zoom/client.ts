/**
 * Zoom (Server-to-Server OAuth) — registrants and attendance for a live event.
 *
 * Env: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET (a Server-to-Server OAuth app
 * in the Zoom Marketplace). Needed scopes: webinar:write:registrant / meeting:write:registrant
 * (add registrants) and report:read:list_webinar_participants / report:read:list_meeting_participants
 * (attendance report), or their classic equivalents.
 *
 * Works for a Zoom WEBINAR or a MEETING with registration turned on; `kind` picks the path.
 */

const ZOOM_API = 'https://api.zoom.us/v2';

export type ZoomEventKind = 'webinar' | 'meeting';

export function zoomConfigured(): boolean {
  return !!(process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET);
}

let cached: { token: string; expiresAt: number } | null = null;

export async function getZoomToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const accountId = process.env.ZOOM_ACCOUNT_ID || '';
  const id = process.env.ZOOM_CLIENT_ID || '';
  const secret = process.env.ZOOM_CLIENT_SECRET || '';
  if (!accountId || !id || !secret) throw new Error('Zoom not configured');
  const res = await fetchImpl(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` } },
  );
  if (!res.ok) throw new Error(`Zoom token ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  cached = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cached.token;
}

/** Test hook: forget the cached token. */
export function resetZoomTokenCache() {
  cached = null;
}

export interface ZoomRegistrant {
  email: string;
  firstName: string;
  lastName?: string;
}

/**
 * Register one person for the event and return their personal join link.
 * Zoom returns the same registrant (and link) when the email is already registered,
 * so calling this twice for one person is safe.
 */
export async function addZoomRegistrant(
  kind: ZoomEventKind,
  eventId: string,
  person: ZoomRegistrant,
  fetchImpl: typeof fetch = fetch,
): Promise<{ joinUrl: string; registrantId: string }> {
  const token = await getZoomToken(fetchImpl);
  const res = await fetchImpl(`${ZOOM_API}/${kind}s/${encodeURIComponent(eventId)}/registrants`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: person.email,
      first_name: person.firstName || 'Guest',
      ...(person.lastName ? { last_name: person.lastName } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Zoom registrant ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = await res.json();
  if (!data.join_url) throw new Error('Zoom returned no join_url');
  return { joinUrl: String(data.join_url), registrantId: String(data.registrant_id || data.id || '') };
}

export interface ZoomParticipant {
  email: string;
  /** Total seconds in the session, summed across rejoins. */
  seconds: number;
}

/**
 * Who attended, from Zoom's past-event participants report, summed per email
 * (one person who drops and rejoins appears several times in the raw report).
 * Rows without an email (phone dial-in, guests outside registration) are counted separately.
 */
export async function getZoomAttendance(
  kind: ZoomEventKind,
  eventId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ participants: ZoomParticipant[]; withoutEmail: number }> {
  const token = await getZoomToken(fetchImpl);
  const byEmail = new Map<string, number>();
  let withoutEmail = 0;
  let next = '';
  for (let page = 0; page < 50; page++) {
    const url = `${ZOOM_API}/report/${kind}s/${encodeURIComponent(eventId)}/participants?page_size=300${next ? `&next_page_token=${encodeURIComponent(next)}` : ''}`;
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Zoom report ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = await res.json();
    for (const p of data.participants || []) {
      const email = String(p.user_email || '').trim().toLowerCase();
      const secs = Number(p.duration) || 0;
      if (!email) { withoutEmail++; continue; }
      byEmail.set(email, (byEmail.get(email) || 0) + secs);
    }
    next = data.next_page_token || '';
    if (!next) break;
  }
  return { participants: [...byEmail].map(([email, seconds]) => ({ email, seconds })), withoutEmail };
}
