/**
 * EMAIL MIGRATION GUARD — no customer email may send a user to a legacy surface.
 *
 * THE RULE: `/app` and `/briefings` are legacy surfaces being retired. The Map is the
 * product. No active customer email may intentionally link to either.
 *
 * WHY THIS INSPECTS THE RENDERED PAYLOAD, NOT THE TEMPLATE:
 * Reported 2026-08-25 — a daily briefing's footer sent users to `/briefings`. Reading the
 * template source proved nothing: the source looked reasonable, and the real destination
 * came from a SHARED CONSTANT resolved at import time, three files away.
 *
 * The artifact that matters is the HTML handed to the email provider, so the contract is
 *     rendered CTA -> tracking redirect -> configured Map -> correct filter state
 * not "the template source looks right". This runs on the final payload inside sendEmail(),
 * which every send path goes through — a NEW sender inherits the check rather than having
 * to remember it.
 *
 * It also unwraps `/api/track?...&url=<encoded>` before checking: a tracked link hides its
 * destination in a query parameter, so scanning the visible href would pass a link that
 * lands squarely on a legacy surface.
 */

/** Surfaces no customer email may intentionally target. */
const LEGACY_PATHS = /^\/(app|briefings)(\/|\?|#|$)/;

/**
 * Documented compatibility exceptions. Each carries a REASON — an undocumented exception
 * list is just a quiet way to reintroduce the bug.
 */
const ALLOWED: Array<{ match: RegExp; reason: string }> = [
  { match: /^\/app\/(reset-password|set-password|verify|signup|sign-in)\b/, reason: 'credential flow — no Map-native equivalent yet' },
];

export interface LegacyLinkFinding {
  url: string;
  path: string;
  /** True when the legacy path was hidden inside a tracking redirect. */
  viaTracking: boolean;
}

/** Pull the real destination out of a tracking wrapper, recursively. */
function unwrap(raw: string, depth = 0): { url: string; viaTracking: boolean } {
  if (depth > 3) return { url: raw, viaTracking: depth > 0 };
  try {
    const u = new URL(raw, 'https://getmindy.ai');
    if (/\/api\/track$/.test(u.pathname)) {
      const inner = u.searchParams.get('url');
      if (inner) return { url: unwrap(inner, depth + 1).url, viaTracking: true };
    }
    return { url: raw, viaTracking: depth > 0 };
  } catch {
    return { url: raw, viaTracking: depth > 0 };
  }
}

/**
 * Scan a rendered payload for links to legacy surfaces. Checks BOTH the HTML and the
 * plain-text part — a text-only footer is still a live link in every mail client.
 */
export function findLegacyDestinations(html?: string, text?: string): LegacyLinkFinding[] {
  const out: LegacyLinkFinding[] = [];
  const seen = new Set<string>();
  const candidates: string[] = [];

  if (html) for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) candidates.push(m[1]);
  if (text) for (const m of text.matchAll(/https?:\/\/[^\s<>"')]+/gi)) candidates.push(m[0]);

  for (const raw of candidates) {
    const { url, viaTracking } = unwrap(raw);
    let path: string;
    try {
      path = new URL(url, 'https://getmindy.ai').pathname;
    } catch {
      continue;   // mailto:, {{merge_tag}} — not a navigation target
    }
    if (!LEGACY_PATHS.test(path)) continue;
    if (ALLOWED.some((a) => a.match.test(path))) continue;
    const key = `${path}|${viaTracking}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, path, viaTracking });
  }
  return out;
}

/**
 * Assert a payload is clean. Throws outside production so a broken template fails loudly
 * in dev and CI; in production it LOGS and lets the mail go — a legacy link is a bad
 * landing, but silently dropping a customer's daily alert is worse.
 */
export function assertNoLegacyDestinations(
  payload: { html?: string; text?: string; subject?: string; emailType?: string },
): LegacyLinkFinding[] {
  const findings = findLegacyDestinations(payload.html, payload.text);
  if (!findings.length) return findings;

  const detail = findings
    .map((f) => `${f.path}${f.viaTracking ? ' (inside /api/track)' : ''} -> ${f.url.slice(0, 120)}`)
    .join('; ');
  const message =
    `[email-migration] ${findings.length} legacy destination(s) in "${payload.emailType || payload.subject || 'email'}": ${detail}. `
    + 'No customer email may link to /app or /briefings — see src/lib/email/legacy-destination-guard.ts';

  if (process.env.NODE_ENV !== 'production') throw new Error(message);
  console.error(message);
  return findings;
}
