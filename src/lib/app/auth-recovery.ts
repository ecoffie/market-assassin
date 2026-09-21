/**
 * Policy for the /app global fetch-recovery wrapper: which 401s should trigger a
 * silent MI-token refresh + retry, and which requests are already-retried.
 *
 * Extracted from app/page.tsx so it is unit-testable in isolation — a bug here
 * is exactly the "Invalid two-factor session" class: too narrow a prefix list
 * lets recoverable 401s bounce users to sign-in; including /api/auth/ would
 * recurse the refresh call on its own 401. See src/lib/app/auth-recovery.unit.test.ts.
 */

// Auth endpoints must NEVER trigger token-refresh recovery — refreshing on a
// 401 from the refresh/login call itself would recurse.
export const AUTH_RECOVERY_EXCLUDE = ['/api/auth/'];

// The MI-token-gated route prefixes. A 401 from any of these is recoverable:
// the token is likely expired/near-expiry and a refresh will restore access.
// Kept broad on purpose — /api/access/check is the FIRST call on load and
// /api/pipeline, /api/teaming, /api/mindy/*, /api/alerts/* fire early/often.
export const GATED_MINDY_API_PREFIXES = [
  '/api/app/',
  '/api/access/',
  '/api/pipeline',
  '/api/teaming',
  '/api/pain-points',
  '/api/mindy/',
  '/api/alerts/',
];

/** Extract the path from a full or relative URL (defensive on malformed input). */
function toPath(url: string): string {
  if (!url.startsWith('http')) return url;
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** True if a 401 from this URL should attempt silent token-refresh + retry. */
export function isGatedMindyApi(url: string): boolean {
  const path = toPath(url);
  if (AUTH_RECOVERY_EXCLUDE.some((p) => path.includes(p))) return false;
  return GATED_MINDY_API_PREFIXES.some((p) => path.includes(p));
}

/** A request already replayed after a refresh — don't recover a second time. */
export function skipAuthRecovery(init: RequestInit | undefined): boolean {
  return !!(init as (RequestInit & { __miAuthRetry?: boolean }) | undefined)?.__miAuthRetry;
}
