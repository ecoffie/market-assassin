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
 *
 * Disclosure must cover every empty-body path: HTTP errors, mixed credential/quota
 * outcomes, network/timeout (no status), and HTTP 200 with empty text.
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

function classifyNetworkFailure(err: unknown): 'timeout' | 'network' | 'unknown' {
  const name = err instanceof Error ? err.name : '';
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|timed out|aborted/i.test(msg)) {
    return 'timeout';
  }
  if (/fetch failed|network|econnreset|enotfound|econnrefused/i.test(msg)) {
    return 'network';
  }
  return 'unknown';
}

/** A key is unusable if throttled (429) or rejected (401/403) — same rule as entity. */
export function isNoticedescKeyUnusable(status?: number): boolean {
  return status === 429 || status === 401 || status === 403;
}

export type NoticedescKeyOutcome =
  | { kind: 'ok'; chars: number }
  | { kind: 'empty' }
  | { kind: 'http'; status: number }
  | { kind: 'network'; reason: 'timeout' | 'network' | 'unknown'; message: string };

export type NoticedescFetchDeps = {
  fetchFn?: typeof fetch;
  getRotatedKey?: () => string | null | undefined;
  getAllKeys?: () => string[];
};

export type NoticedescFetchResult = {
  text: string;
  /** Per-key attempt outcomes (never includes key material). */
  outcomes: NoticedescKeyOutcome[];
  /** Keys attempted. */
  keysTried: number;
  /** True when every distinct key was 429/401/403. */
  allKeysUnusable: boolean;
  /** HTTP 200 with empty/whitespace body. */
  emptySuccess: boolean;
};

function buildNoticedescUrl(linkOrNoticeId: string, apiKey: string): string {
  if (isDescriptionLink(linkOrNoticeId)) {
    return linkOrNoticeId.includes('api_key=')
      ? linkOrNoticeId
      : `${linkOrNoticeId}${linkOrNoticeId.includes('?') ? '&' : '?'}api_key=${apiKey}`;
  }
  return `${NOTICEDESC_BASE}?noticeid=${encodeURIComponent(linkOrNoticeId)}&api_key=${apiKey}`;
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
  deps: NoticedescFetchDeps = {},
): Promise<string> {
  const fetchFn = deps.fetchFn ?? fetch;
  const url = buildNoticedescUrl(linkOrNoticeId, apiKey);

  const res = await fetchFn(url, {
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

/**
 * Bounded multi-key noticedesc resolve. Starts with the rotated day key, then
 * walks the remaining distinct pool once each on unusable statuses only.
 */
export async function fetchNoticeDescriptionWithFailover(
  linkOrNoticeId: string,
  timeoutMs = 30000,
  deps: NoticedescFetchDeps = {},
): Promise<NoticedescFetchResult> {
  const getRotated = deps.getRotatedKey ?? getRotatedSAMKey;
  const getAll = deps.getAllKeys ?? getAllDistinctSAMKeys;
  const rotated = getRotated() || null;
  const pool = getAll();
  const ordered = rotated
    ? [rotated, ...pool.filter((k) => k !== rotated)]
    : pool;

  if (ordered.length === 0) {
    return {
      text: '',
      outcomes: [],
      allKeysUnusable: false,
      emptySuccess: false,
      keysTried: 0,
    };
  }

  const outcomes: NoticedescKeyOutcome[] = [];
  let keysTried = 0;

  for (const key of ordered) {
    keysTried += 1;
    try {
      const text = await fetchNoticeDescription(linkOrNoticeId, key, timeoutMs, deps);
      if (!text.trim()) {
        // Same notice body for every key — do not burn the pool on empty 200.
        outcomes.push({ kind: 'empty' });
        return {
          text: '',
          outcomes,
          keysTried,
          allKeysUnusable: false,
          emptySuccess: true,
        };
      }
      outcomes.push({ kind: 'ok', chars: text.length });
      return {
        text,
        outcomes,
        keysTried,
        allKeysUnusable: false,
        emptySuccess: false,
      };
    } catch (err) {
      const status = parseNoticedescStatus(err);
      if (status !== undefined) {
        outcomes.push({ kind: 'http', status });
        if (!isNoticedescKeyUnusable(status)) {
          console.error('[noticedesc] non-throttle failure; stopping failover', err);
          return {
            text: '',
            outcomes,
            keysTried,
            allKeysUnusable: false,
            emptySuccess: false,
          };
        }
        console.warn(
          `[noticedesc] key unusable (${status}) — failing over (${keysTried}/${ordered.length})`,
        );
        continue;
      }
      const reason = classifyNetworkFailure(err);
      const message = err instanceof Error ? err.message : String(err || 'unknown error');
      outcomes.push({ kind: 'network', reason, message: message.slice(0, 200) });
      console.error('[noticedesc] network/timeout failure; stopping failover', err);
      return {
        text: '',
        outcomes,
        keysTried,
        allKeysUnusable: false,
        emptySuccess: false,
      };
    }
  }

  const allKeysUnusable =
    outcomes.length > 0 &&
    outcomes.every((o) => o.kind === 'http' && isNoticedescKeyUnusable(o.status));

  return {
    text: '',
    outcomes,
    keysTried,
    allKeysUnusable,
    emptySuccess: false,
  };
}

function describeHttpStatus(status: number): string {
  if (status === 429) return '429 (quota)';
  if (status === 401 || status === 403) return `${status} (credentials)`;
  return String(status);
}

function summarizeOutcomes(outcomes: NoticedescKeyOutcome[]): string {
  return outcomes
    .map((o, i) => {
      const n = i + 1;
      if (o.kind === 'http') return `key ${n} → ${describeHttpStatus(o.status)}`;
      if (o.kind === 'network') return `key ${n} → ${o.reason}`;
      if (o.kind === 'empty') return `key ${n} → empty body`;
      return `key ${n} → ok (${o.chars} chars)`;
    })
    .join('; ');
}

/** Honest disclosure when noticedesc could not be retrieved (do not invent body). */
export function noticedescRetrievalLimitation(result: NoticedescFetchResult): string | null {
  if (result.text.trim()) return null;

  const tail =
    'Absence of description text does not mean the notice has no scope.';

  if (result.keysTried === 0) {
    return (
      'Notice description text was not in the local cache and no SAM API key is configured, ' +
      `so the synopsis body could not be retrieved. ${tail}`
    );
  }

  if (result.emptySuccess) {
    return (
      'SAM.gov noticedesc returned HTTP 200 with an empty synopsis body. ' +
      `The solicitation identity resolved, but no description text was available. ${tail}`
    );
  }

  const summary = summarizeOutcomes(result.outcomes);
  const network = result.outcomes.find((o) => o.kind === 'network');
  if (network) {
    const why =
      network.reason === 'timeout'
        ? 'a timeout'
        : network.reason === 'network'
          ? 'a network error'
          : 'an upstream error without an HTTP status';
    return (
      `SAM.gov noticedesc failed with ${why} after ${result.keysTried} key attempt(s)` +
      (summary ? ` (${summary})` : '') +
      `. Synopsis body was not retrieved. ${tail}`
    );
  }

  if (result.allKeysUnusable) {
    const statuses = result.outcomes
      .filter((o): o is Extract<NoticedescKeyOutcome, { kind: 'http' }> => o.kind === 'http')
      .map((o) => o.status);
    const hasCred = statuses.some((s) => s === 401 || s === 403);
    const hasQuota = statuses.some((s) => s === 429);
    const mixed = hasCred && hasQuota;
    const head = mixed
      ? `SAM.gov noticedesc failed on every configured API key (${result.keysTried} tried) with mixed credential and quota errors`
      : hasCred && !hasQuota
        ? `SAM.gov noticedesc rejected every configured API key (${result.keysTried} tried) — credentials`
        : `SAM.gov noticedesc rate-limited every configured API key (${result.keysTried} tried) — quota`;
    return (
      `${head}: ${summary}. ` +
      'The solicitation identity resolved, but the synopsis body is unavailable until a usable key ' +
      `or a prior cached description exists. ${tail}`
    );
  }

  const http = [...result.outcomes].reverse().find((o) => o.kind === 'http');
  if (http && http.kind === 'http') {
    return (
      `SAM.gov noticedesc returned ${describeHttpStatus(http.status)}` +
      (summary ? ` (${summary})` : '') +
      `; synopsis body was not retrieved. ${tail}`
    );
  }

  // Fallback — never return null after keys were tried with an empty body.
  return (
    `SAM.gov noticedesc did not return synopsis text after ${result.keysTried} key attempt(s)` +
    (summary ? ` (${summary})` : '') +
    `. ${tail}`
  );
}
