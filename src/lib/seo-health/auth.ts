/**
 * Header-only cron auth for the SEO health routes: the dispatcher's
 * `Authorization: Bearer CRON_SECRET`, or Vercel's `x-vercel-cron: 1`.
 *
 * Deliberately NO `?password=` query parameter: a secret in a URL leaks into access logs,
 * analytics, browser history and Referer headers.
 */
export function cronHeaderAuthorized(headers: Headers, env: Record<string, string | undefined> = process.env): boolean {
  if (headers.get('x-vercel-cron') === '1') return true;
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const auth = headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}
