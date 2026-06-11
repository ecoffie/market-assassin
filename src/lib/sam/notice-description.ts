/**
 * Fetch a SAM.gov notice's full DESCRIPTION TEXT.
 *
 * The SAM v2 /search (list) endpoint returns `description` as a LINK
 * (https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=...), NOT the
 * body text. So every cached sam_opportunities.description was an unusable URL (or
 * null) — meaning body search ("M7 in the body") matched nothing. This resolves the
 * link to the actual text. Shared by the backfill runner + the nightly sync so both
 * store real body text.
 */

const NOTICEDESC_BASE = 'https://api.sam.gov/prod/opportunities/v1/noticedesc';

/** True if a stored description value is actually the unfetched LINK, not text. */
export function isDescriptionLink(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\/.*noticedesc/i.test(value);
}

/** Strip HTML tags + collapse whitespace; SAM descriptions come back as HTML. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Resolve a notice's description to plain text.
 * @param linkOrNoticeId either the full noticedesc URL (from raw_data.description)
 *                       or a bare notice_id (we build the URL).
 * @returns the description text, or '' if unavailable. Postgres rejects NUL bytes
 *          in text columns, so we strip them.
 */
export async function fetchNoticeDescription(
  linkOrNoticeId: string,
  apiKey: string,
  timeoutMs = 30000,
): Promise<string> {
  let url: string;
  if (isDescriptionLink(linkOrNoticeId)) {
    url = linkOrNoticeId.includes('api_key=')
      ? linkOrNoticeId
      : `${linkOrNoticeId}${linkOrNoticeId.includes('?') ? '&' : '?'}api_key=${apiKey}`;
  } else {
    url = `${NOTICEDESC_BASE}?noticeid=${encodeURIComponent(linkOrNoticeId)}&api_key=${apiKey}`;
  }

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`noticedesc ${res.status}`);
  }

  // SAM returns either { description: "<html>" } or raw text depending on notice.
  const ctype = res.headers.get('content-type') || '';
  let raw = '';
  if (ctype.includes('application/json')) {
    const data = await res.json().catch(() => null);
    raw = (data && (data.description || data.body || data.text)) || '';
  } else {
    raw = await res.text();
  }

  // Strip NUL bytes () — Postgres rejects them in text columns.
  const text = htmlToText(String(raw)).replace(/\u0000/g, "");
  return text.slice(0, 50000); // generous cap; bodies are the search corpus now
}
