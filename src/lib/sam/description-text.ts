/**
 * Convert SAM.gov noticedesc HTML into readable plain text.
 *
 * SAM's noticedesc endpoint returns HTML markup (<p>, <ul>, <li>,
 * <strong>, &nbsp;, etc.). We store text in sam_opportunities.
 * description as plain text and render with whitespace-pre-wrap, so
 * raw HTML leaks into the UI as visible tags. This helper produces
 * a clean text representation that:
 *
 *   - turns <li> entries into "• " bullets
 *   - inserts double newlines between block elements (<p>, <div>)
 *   - decodes common HTML entities (&nbsp;, &amp;, &lt;, &gt;, &quot;, &#39;)
 *   - strips all remaining tags
 *   - collapses excessive whitespace
 *
 * Used by both the lazy-fetch endpoint (/api/sam-description) and
 * the nightly backfill cron so existing rows and freshly-resolved
 * rows have the same shape.
 */

export function samHtmlToText(input: string): string {
  if (!input) return '';

  let s = input;

  // Normalize newlines so block-level handling is consistent.
  s = s.replace(/\r\n?/g, '\n');

  // Block-level tags get a double newline so paragraphs stay separated.
  // Do this before stripping so we preserve the breaks.
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n\n')
    .replace(/<\/(tr|table)>/gi, '\n')
    .replace(/<\/(ul|ol)>/gi, '\n');

  // Each <li> becomes a bullet on its own line. Closing </li> just adds
  // a newline — opening <li> is what we replace with the bullet.
  s = s
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '');

  // Strip everything else.
  s = s.replace(/<[^>]+>/g, '');

  // Decode common HTML entities. SAM tends to emit &nbsp; and &amp;
  // most often; the others are defensive.
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    // Numeric entities: &#160; (nbsp), &#8211; (en dash), etc. — best effort.
    .replace(/&#(\d+);/g, (_, code) => {
      const n = parseInt(code, 10);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
      const n = parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    });

  // Collapse runs of spaces/tabs to one. Don't touch newlines.
  s = s.replace(/[ \t]+/g, ' ');
  // Collapse 3+ newlines down to 2 (one blank line between paragraphs).
  s = s.replace(/\n{3,}/g, '\n\n');
  // Trim each line so leading bullet-line spacing reads cleanly.
  s = s.split('\n').map((line) => line.replace(/[ \t]+$/g, '').replace(/^ /, '')).join('\n');

  return s.trim();
}

/**
 * Heuristic: did the value SAM returned look like HTML (so it needs
 * cleaning) or was it already plain text (don't double-process).
 */
export function looksLikeHtml(input: string): boolean {
  if (!input) return false;
  // Anything with a closing-tag pattern or common entities is HTML.
  return /<\/?[a-z][a-z0-9]*\b[^>]*>|&[a-z]+;|&#\d+;/i.test(input);
}

/**
 * Many sam_opportunities rows store the description column as a SAM API URL
 * pointer (https://api.sam.gov/.../noticedesc?noticeid=...) rather than the
 * resolved text — the real scope lives behind that endpoint. This detects the
 * pointer so callers know to resolve it.
 */
export function isSamDescriptionUrl(value?: string | null): boolean {
  const v = (value || '').trim();
  return /^https?:\/\//i.test(v) && /noticedesc|opportunities\/v\d/i.test(v);
}

/**
 * Resolve a SAM noticedesc URL to clean plain text on-demand. Returns null on
 * any failure (network, non-OK, empty) so callers can fall back gracefully.
 * Shared by the backfill cron and the Proposal Assist wizard so a pursuit with
 * no attachments can still brief from the SAM description even before the
 * nightly backfill has resolved it.
 */
export async function resolveSamDescriptionUrl(
  url: string,
  apiKey: string,
  maxChars = 30_000,
): Promise<string | null> {
  let upstream: URL;
  try {
    upstream = new URL(url);
    if (!upstream.searchParams.has('api_key') && apiKey) {
      upstream.searchParams.set('api_key', apiKey);
    }
  } catch {
    return null;
  }

  let res: Response;
  try {
    res = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await res.json().catch(() => null);
    if (payload && typeof payload === 'object') {
      const p = payload as { description?: unknown; body?: unknown; text?: unknown };
      const text =
        typeof p.description === 'string' ? p.description
        : typeof p.body === 'string' ? p.body
        : typeof p.text === 'string' ? p.text
        : null;
      if (text) return samHtmlToText(text).slice(0, maxChars);
    }
  }
  const text = await res.text().catch(() => '');
  return text ? samHtmlToText(text).slice(0, maxChars) : null;
}
