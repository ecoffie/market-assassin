/**
 * Auth for the SEO health routes: `Authorization: Bearer CRON_SECRET` and nothing else.
 *
 * These routes are scheduled through `cron_jobs`; the dispatcher always sends that bearer.
 * Deliberately NOT accepted:
 *   - `x-vercel-cron: 1`: any caller can set that header, so it proves nothing
 *   - `?password=`: a secret in a URL leaks into access logs, analytics and Referer headers
 * With CRON_SECRET unset, nothing is authorized (fail closed).
 */
export function cronBearerAuthorized(headers: Headers, env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  return (headers.get('authorization') ?? '') === `Bearer ${secret}`;
}
