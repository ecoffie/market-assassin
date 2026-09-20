/**
 * Fetch a SAM.gov notice's full DESCRIPTION TEXT.
 *
 * The SAM v2 /search (list) endpoint returns `description` as a LINK
 * (https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=...), NOT the
 * body text. So every cached sam_opportunities.description was an unusable URL (or
 * null) — meaning body search ("M7 in the body") matched nothing. This resolves the
 * link to the actual text. Shared by the backfill runner + the nightly sync so both
 * store real body text.
 *
 * 429 FAIL-OVER (issue-log #12, 2026-09-20): getRotatedSAMKey() picks ONE key by
 * day-of-year. When that key is quota-exhausted, a single-key noticedesc call
 * returns empty forever even though another key still has quota — the same class
 * as the entity UEI outage. Try each distinct key ONCE; stop on success or a
 * non-throttle error. Never invent body text; never retry indefinitely.
 */

import { getAllDistinctSAMKeys, getRotatedSAMKey } from './utils';

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

function parseNoticedescStatus(err: unknown): number | undefined {
  const msg = err instanceof Error ? err.message : String(err || '');
  const m = /^noticedesc (\d{3})\b/.exec(msg);
  return m ? Number(m[1]) : undefined;
}

/** A key is unusable if throttled (429) or rejected (401/403) — same rule as entity. */
export function isNoticedescKeyUnusable(status?: number): boolean {
  return status === 429 || status === 401 || status === 403;
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

  // Strip NUL bytes — Postgres rejects them in text columns.
  const text = htmlToText(String(raw)).replace(/\u0000/g, '');
  return text.slice(0, 50000); // generous cap; bodies are the search corpus now
}

export type NoticedescFetchResult = {
  text: string;
  /** HTTP status of the last failure, when text is empty. */
  lastStatus?: number;
  /** True when every distinct key was 429/401/403. */
  allKeysUnusable: boolean;
  /** Keys attempted (for diagnostics; never log the key material). */
  keysTried: number;
};

/**
 * Bounded multi-key noticedesc resolve. Starts with the rotated day key, then
 * walks the remaining distinct pool once each on unusable statuses only.
 */
export async function fetchNoticeDescriptionWithFailover(
  linkOrNoticeId: string,
  timeoutMs = 30000,
): Promise<NoticedescFetchResult> {
  const rotated = getRotatedSAMKey();
  const pool = getAllDistinctSAMKeys();
  const ordered = rotated
    ? [rotated, ...pool.filter((k) => k !== rotated)]
    : pool;

  if (ordered.length === 0) {
    return { text: '', allKeysUnusable: false, keysTried: 0 };
  }

  let lastStatus: number | undefined;
  let sawUnusable = false;
  let keysTried = 0;

  for (const key of ordered) {
    keysTried += 1;
    try {
      const text = await fetchNoticeDescription(linkOrNoticeId, key, timeoutMs);
      return { text, allKeysUnusable: false, keysTried };
    } catch (err) {
      const status = parseNoticedescStatus(err);
      lastStatus = status;
      if (!isNoticedescKeyUnusable(status)) {
        // Ordinary error (4xx validation, 5xx, network) — do not burn every key.
        console.error('[noticedesc] non-throttle failure; stopping failover', err);
        return { text: '', lastStatus, allKeysUnusable: false, keysTried };
      }
      sawUnusable = true;
      console.warn(
        `[noticedesc] key unusable (${status}) — failing over (${keysTried}/${ordered.length})`,
      );
    }
  }

  return {
    text: '',
    lastStatus,
    allKeysUnusable: sawUnusable && keysTried === ordered.length,
    keysTried,
  };
}

/** Honest disclosure when noticedesc could not be retrieved (do not invent body). */
export function noticedescRetrievalLimitation(result: NoticedescFetchResult): string | null {
  if (result.text.trim()) return null;
  if (result.keysTried === 0) {
    return (
      'Notice description text was not in the local cache and no SAM API key is configured, ' +
      'so the synopsis body could not be retrieved.'
    );
  }
  if (result.allKeysUnusable) {
    const st = result.lastStatus ?? 429;
    return (
      `SAM.gov noticedesc returned ${st} on every configured API key (${result.keysTried} tried). ` +
      'The solicitation identity resolved, but the synopsis body is unavailable until quota recovers ' +
      'or a prior cached description exists. Absence of description text does not mean the notice has no scope.'
    );
  }
  if (result.lastStatus) {
    return (
      `SAM.gov noticedesc returned ${result.lastStatus}; synopsis body was not retrieved. ` +
      'Absence of description text does not mean the notice has no scope.'
    );
  }
  return null;
}
