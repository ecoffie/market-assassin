/**
 * EMAIL MIGRATION GUARD — no customer email may send a user to a RETIRED surface.
 *
 * THE RULE (reconciled 2026-09-23): the current Mindy workspace is `/app` (Eric's explicit
 * decision on PR #1671), so `/app` is a valid email destination again. What stays banned is
 * the set of surfaces that are actually retired — each listed below WITH ITS REASON, because
 * an unexplained entry is how a rule decays into superstition:
 *   /briefings*              the pre-/app Unified-MI dashboard (2026-08-25 incident)
 *   /bd-assist               BD Assist, folded into /app's pipeline panel
 *   /market-assassin         retired Market Assassin sales page
 *   /market-assassin-locked  retired Market Assassin access gate
 *   /federal-market-assassin retired standalone tool — Market Research lives in /app now
 *   /app/onboarding          the retired profile builder (post-signup-destination.ts)
 *
 * History: from 2026-08-25 to 2026-09-23 this guard banned ALL of `/app` ("the Map is the
 * product"). That is superseded for paid welcome/access CTAs, which now go straight to
 * /app sign-in instead of a pricing-page detour. The CREDENTIAL-FLOW protection is kept in
 * two places: credential routes stay explicitly allowed below (even under a retired prefix),
 * and `MINDY_APP_URL` (email-branding.ts) still refuses to default GENERAL alert CTAs to the
 * credential-gated /app, because beta/free recipients who never set a password would be
 * stranded at a sign-in wall — the regression that guard was written for.
 *
 * WHY THIS INSPECTS THE RENDERED PAYLOAD, NOT THE TEMPLATE:
 * Reported 2026-08-25 — a daily briefing's footer sent users to `/briefings`. Reading the
 * template source proved nothing: the source looked reasonable, and the real destination
 * came from a SHARED CONSTANT resolved at import time, three files away.
 *
 * The artifact that matters is the HTML handed to the email provider, so the contract is
 *     rendered CTA -> tracking redirect -> real destination
 * not "the template source looks right". This runs on the final payload inside sendEmail(),
 * which every send path goes through — a NEW sender inherits the check rather than having
 * to remember it.
 *
 * It also unwraps `/api/track?...&url=<encoded>` before checking: a tracked link hides its
 * destination in a query parameter, so scanning the visible href would pass a link that
 * lands squarely on a retired surface.
 */

/** Surfaces no customer email may target, each with the reason it is retired. */
const RETIRED: Array<{ match: RegExp; reason: string }> = [
  { match: /^\/briefings(\/|\?|#|$)/i, reason: 'pre-/app Unified-MI dashboard' },
  { match: /^\/bd-assist(\/|\?|#|$)/i, reason: 'BD Assist — now /app?panel=pipeline' },
  { match: /^\/market-assassin(\/|\?|#|$)/i, reason: 'retired Market Assassin sales page' },
  { match: /^\/market-assassin-locked(\/|\?|#|$)/i, reason: 'retired Market Assassin access gate' },
  { match: /^\/federal-market-assassin(\/|\?|#|$)/i, reason: 'retired standalone tool — /app?panel=research' },
  { match: /^\/app\/onboarding(\/|\?|#|$)/i, reason: 'retired profile builder' },
];

/**
 * Credential flows are ALWAYS linkable — a reset/setup/sign-in link must never be blocked,
 * even if a future retired prefix would otherwise cover it.
 */
const CREDENTIAL_FLOWS = /^\/app\/(reset-password|set-password|setup-password|setup-account|forgot-password|verify|signup|sign-in|auth\/callback)\b/i;

export interface LegacyLinkFinding {
  url: string;
  path: string;
  /** Why this surface is retired. */
  reason: string;
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
    if (CREDENTIAL_FLOWS.test(path)) continue;
    const retired = RETIRED.find((r) => r.match.test(path));
    if (!retired) continue;
    const key = `${path}|${viaTracking}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, path, viaTracking, reason: retired.reason });
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
    .map((f) => `${f.path}${f.viaTracking ? ' (inside /api/track)' : ''} [${f.reason}] -> ${f.url.slice(0, 120)}`)
    .join('; ');
  const message =
    `[email-migration] ${findings.length} legacy destination(s) in "${payload.emailType || payload.subject || 'email'}": ${detail}. `
    + 'No customer email may link to a retired surface — see src/lib/email/legacy-destination-guard.ts';

  if (process.env.NODE_ENV !== 'production') throw new Error(message);
  console.error(message);
  return findings;
}
