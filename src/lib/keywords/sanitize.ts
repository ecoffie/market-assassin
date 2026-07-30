/**
 * Keyword sanitizing — the server-side guard against "paste blobs".
 *
 * THE BUG THIS CLOSES
 * The Settings keyword field says "Comma-separated", and parseList() split on
 * commas ONLY. Users paste capability lists that are newline- or space-separated,
 * so the entire paste survived as ONE keyword. Nothing downstream checked the
 * length of an individual keyword — /api/app/keywords/add and /api/app/profile
 * both validate the ARRAY (dedupe, cap at 40) but never the STRING.
 *
 * Result (audited 2026-07-30): 17 malformed keywords across 10 accounts,
 * including a single 1,604-character entry holding ~80 terms. Matching against
 * one giant string barely works — that customer saw "3 matches found" and
 * reported the tool as broken. The damage is silent: nobody can tell their
 * targeting is degraded.
 *
 * Fixing parseList() alone is NOT enough — that is the UI. Any caller of the
 * API (Sport mode, auto-setup, a future client) can still post a blob. This
 * runs at the write boundary so no path can store one.
 */

/**
 * Longest plausible single keyword. Real ones are short ("cybersecurity",
 * "base operations support"). Anything longer is a pasted list or a sentence.
 */
export const KEYWORD_MAX_LEN = 60;

/** Cap on the stored array (matches the existing keywords/add behaviour). */
export const KEYWORD_MAX_COUNT = 40;

/**
 * Split on every separator a human might paste: comma, newline, semicolon,
 * tab, pipe, and bullet characters. Deliberately NOT space — multi-word
 * keywords are legitimate ("base operations support") and splitting on spaces
 * would shred them.
 */
const SEPARATORS = /[,;\n\r\t|•·]+/;

/**
 * Normalize one raw input into zero or more clean keywords.
 *
 * - splits on real separators
 * - trims, lowercases, drops empties
 * - drops anything still over KEYWORD_MAX_LEN after splitting (a space-joined
 *   paragraph with no separators at all — unsplittable without guessing, and
 *   guessing would fabricate the user's targeting)
 */
export function sanitizeKeyword(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(SEPARATORS)
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0 && k.length <= KEYWORD_MAX_LEN);
}

/**
 * Sanitize a whole incoming keyword array: split blobs, dedupe, cap.
 * Returns both the clean list and what was dropped, so callers can log or
 * surface it instead of silently discarding a user's input.
 */
export function sanitizeKeywords(
  incoming: unknown,
  opts: { max?: number } = {},
): { keywords: string[]; dropped: string[] } {
  const max = opts.max ?? KEYWORD_MAX_COUNT;
  const list = Array.isArray(incoming) ? incoming : [];
  const dropped: string[] = [];
  const out: string[] = [];

  for (const raw of list) {
    const parts = sanitizeKeyword(raw);
    if (parts.length === 0 && typeof raw === 'string' && raw.trim()) {
      // Non-empty input that produced nothing usable — an unsplittable blob.
      dropped.push(raw.trim().slice(0, 120));
      continue;
    }
    out.push(...parts);
  }

  const deduped = Array.from(new Set(out)).slice(0, max);
  return { keywords: deduped, dropped };
}
