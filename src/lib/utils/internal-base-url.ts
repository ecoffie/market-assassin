/**
 * Same-origin base URL for server→server fetches to our OWN API routes.
 *
 * Bug this prevents (June 10, 2026, getmindy migration): routes used
 * `process.env.NEXT_PUBLIC_BASE_URL` first, which pointed at an OLD domain
 * (mi.govcongiants.com / tools.govcongiants.org). Those now 308-REDIRECT to
 * getmindy.ai — and a server-side `fetch` drops the POST body across a cross-origin
 * redirect → the internal route received an empty body → returned no data (e.g.
 * Market Research "No matching agencies found" even though USASpending had the data).
 *
 * Fix: ALWAYS derive the host from the incoming request (guaranteed same-origin and
 * migration-proof). Only fall back to the env var / localhost when there's no request
 * host (e.g. a cron with no inbound request).
 */
export function internalBaseUrl(request: { headers: { get(name: string): string | null } }): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}
