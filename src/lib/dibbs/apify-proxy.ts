/**
 * Apify RESIDENTIAL proxy settings for the DIBBS daily-file fetcher.
 *
 * WHY: DLA's F5 WAF blocks Vercel's egress on most days (2026-09-08 → 10-07: the free direct
 * fetcher won 8 of 33 days), so the daily cron fell back to the paid store actor at
 * $0.01434/row — $415.80 of the $415.81 Apify bill for that cycle. The actor gets through the
 * WAF with Apify's residential proxy; the same proxy in front of OUR browser fetched the
 * complete file 6/6 times for ~$0.005/file (tasks/dibbs-proxy-spike-2026-10-10.md).
 *
 * CREDENTIALS: reuses the APIFY_TOKEN already authorized in every environment — no new
 * secret. The proxy password is read from `GET /v2/users/me` (`data.proxy.password`), held in
 * module memory only, and NEVER logged, thrown, or returned to a caller that serializes it.
 * The token travels in an Authorization header, not the URL, so it cannot land in a URL log.
 * APIFY_PROXY_PASSWORD, if an operator sets one, takes precedence and skips the lookup.
 */

export const APIFY_PROXY_SERVER = 'http://proxy.apify.com:8000';

/** Feature flag. Anything other than the literal 'primary' is OFF (today's behaviour). */
export function dibbsProxyMode(): 'primary' | 'off' {
  return process.env.DIBBS_PROXY_MODE === 'primary' ? 'primary' : 'off';
}

let cachedPassword: string | null = null;

/** Resolve the proxy password. Errors never include the token or the password. */
export async function getApifyProxyPassword(): Promise<string> {
  if (process.env.APIFY_PROXY_PASSWORD) return process.env.APIFY_PROXY_PASSWORD;
  if (cachedPassword) return cachedPassword;
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN not set — cannot resolve the Apify proxy password');
  const res = await fetch('https://api.apify.com/v2/users/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Apify account lookup failed (HTTP ${res.status}) — proxy password unavailable`);
  const body = (await res.json()) as { data?: { proxy?: { password?: string } } };
  const pw = body?.data?.proxy?.password;
  if (!pw) throw new Error('Apify account has no proxy password — residential proxy unavailable');
  cachedPassword = pw;
  return pw;
}

/**
 * Proxy username. A fresh `session-` per attempt gives a fresh residential exit IP, so a
 * retry is not stuck behind an IP the WAF just refused. Session ids must be [\w.~]{1,50}.
 */
export function apifyProxyUsername(sessionId: string): string {
  const session = sessionId.replace(/[^\w.~]/g, '').slice(0, 50) || 'dibbs';
  return `groups-RESIDENTIAL,country-US,session-${session}`;
}

/** Test hook — never call from production code. */
export function __resetProxyPasswordCacheForTests() {
  cachedPassword = null;
}
