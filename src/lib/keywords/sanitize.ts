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

/**
 * Cap on the stored array — the ONE limit every keyword writer enforces.
 *
 * This was 40 in two writers and 30 in two others, and every one of them
 * enforced it with a silent `.slice()`. A customer (2026-09-24) entered 53
 * keywords in Settings; the last 13 were discarded with a success response and
 * he believed all 53 were live. Over-limit saves are now REJECTED, never
 * truncated — see keywordLimitError(). 60 admits the largest real list we have
 * on record with headroom; daily alerts match keywords in memory against the
 * saved NAICS market, so the count does not grow the SQL query.
 */
export const KEYWORD_MAX_COUNT = 60;

/** The message every writer returns when a save is over the limit. Nothing is written. */
export function keywordLimitError(submitted: number, max: number = KEYWORD_MAX_COUNT): string {
  return `You entered ${submitted} keywords; the limit is ${max}. Nothing was saved — remove ${submitted - max} and save again.`;
}

/**
 * The limit message for an ADDITIVE save ("add these keywords to my profile"). The user
 * did not enter the whole list, so "you entered 61, remove 1" misdescribes what they did.
 * Say what is saved, what was being added, and that nothing changed.
 */
export function keywordAddLimitError(saved: number, adding: number, max: number = KEYWORD_MAX_COUNT): string {
  const room = Math.max(0, max - saved);
  const tail = room === 0
    ? 'Remove a saved keyword in Settings first.'
    : `Only ${room} more ${room === 1 ? 'fits' : 'fit'} — remove some saved keywords in Settings, or add fewer.`;
  return `You have ${saved} saved keywords; adding ${adding} would make ${saved + adding}, over the limit of ${max}. Nothing was saved. ${tail}`;
}

/** An entry that cannot be stored as a keyword, with the reason shown to the user. */
export interface UnusableKeyword {
  value: string;
  reason: 'too_long' | 'naics_code';
}

/**
 * THE shared normalizer for every user-input keyword writer (Settings, onboarding,
 * add-keywords, admin). One input must behave the same on every surface:
 *   - split on real separators (comma, semicolon, newline, tab, pipe, bullet) — never space;
 *   - trim; drop empties;
 *   - de-duplicate CASE-INSENSITIVELY, keeping the first spelling ("FedRAMP" stays "FedRAMP";
 *     matching is case-insensitive downstream, so case is display only);
 *   - anything that cannot be a keyword is REPORTED in `unusable`, never dropped silently:
 *     an entry still over KEYWORD_MAX_LEN after splitting, or a bare NAICS code typed into
 *     the keyword box.
 * Writers reject the save when `unusable` is non-empty or the count exceeds the limit.
 */
export function normalizeKeywordInput(incoming: unknown): { keywords: string[]; unusable: UnusableKeyword[] } {
  const list = Array.isArray(incoming) ? incoming : [];
  const keywords: string[] = [];
  const unusable: UnusableKeyword[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    for (const part of raw.split(SEPARATORS)) {
      const k = part.trim().replace(/\s+/g, ' ');
      if (!k) continue;
      if (/^\d{2,6}$/.test(k)) { unusable.push({ value: k, reason: 'naics_code' }); continue; }
      if (k.length > KEYWORD_MAX_LEN) { unusable.push({ value: k.slice(0, 120), reason: 'too_long' }); continue; }
      const key = k.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      keywords.push(k);
    }
  }
  return { keywords, unusable };
}

/** The rejection message for unusable entries. Nothing is written. */
export function keywordUnusableError(unusable: UnusableKeyword[]): string {
  const show = unusable.slice(0, 3).map((u) =>
    u.reason === 'naics_code'
      ? `"${u.value}" looks like a NAICS code — add it under NAICS codes`
      : `"${u.value.slice(0, 40)}…" is longer than ${KEYWORD_MAX_LEN} characters — separate keywords with commas`,
  );
  const more = unusable.length > 3 ? ` (+${unusable.length - 3} more)` : '';
  return `Nothing was saved: ${show.join('; ')}${more}.`;
}

/**
 * Validate a user-input keyword list for a REPLACING save. Returns the list to store, or
 * the error to return with nothing written.
 */
export function validateKeywordSave(incoming: unknown):
  | { ok: true; keywords: string[] }
  | { ok: false; code: 'keyword_unusable' | 'keyword_limit'; error: string; submitted: number } {
  const { keywords, unusable } = normalizeKeywordInput(incoming);
  if (unusable.length > 0) {
    return { ok: false, code: 'keyword_unusable', error: keywordUnusableError(unusable), submitted: keywords.length + unusable.length };
  }
  if (keywords.length > KEYWORD_MAX_COUNT) {
    return { ok: false, code: 'keyword_limit', error: keywordLimitError(keywords.length), submitted: keywords.length };
  }
  return { ok: true, keywords };
}

/**
 * Split on every separator a human might paste: comma, newline, semicolon,
 * tab, pipe, and bullet characters. Deliberately NOT space — multi-word
 * keywords are legitimate ("base operations support") and splitting on spaces
 * would shred them.
 */
const SEPARATORS = /[,;\n\r\t|•·]+/;


/**
 * The ONE exception to "reject, never truncate": auto-DERIVED keywords (vault prefill)
 * are not user input, so they fill only the room left under the limit instead of
 * failing the prefill. Existing keywords are never trimmed or reordered, and the
 * derived terms that did not fit are returned so the caller can report them.
 */
export function mergeDerivedKeywords(
  existing: string[],
  derived: string[],
  max: number = KEYWORD_MAX_COUNT,
): { merged: string[]; added: string[]; skipped: string[] } {
  const have = new Set(existing.map((k) => k.toLowerCase()));
  const fresh: string[] = [];
  for (const d of derived) {
    const key = d.toLowerCase();
    if (have.has(key)) continue;
    have.add(key);
    fresh.push(d);
  }
  const room = Math.max(0, max - existing.length);
  const added = fresh.slice(0, room);
  return { merged: [...existing, ...added], added, skipped: fresh.slice(room) };
}
