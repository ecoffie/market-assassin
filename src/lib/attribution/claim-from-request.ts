/**
 * Anonymous → account attribution at the moment of VERIFIED authentication.
 *
 * Mirrors qualifyReferralFromRequest (src/lib/mcp/referrals.ts): the same verified-auth route
 * handlers that already credit a `mindy_ref` cookie read two first-party cookies the Map writes —
 *
 *   mindy_anon  the browser's `anon:<uuid>` (a mirror of localStorage mindy_anon_id)
 *   gca_attr    the first/last-touch attribution object (same shape AttributionTracker writes)
 *
 * — and associate that browser's acquisition history with the account. Calling it from the
 * token-minting routes (mi-session: Google, Microsoft, magic link, /app bootstrap · mi-login:
 * password · mindy-complete-signup: the email setup-password path, which mints no token) is what
 * makes it work for EVERY auth class instead of only the email form.
 *
 * Never blocks or throws into a sign-in. Scheduled with after() so the claim finishes on the
 * platform after the response is sent (a bare `void` promise can be frozen with the function).
 */
import { after } from 'next/server';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { claimAnonAttribution, isAnonId } from './share-attribution';

export const ANON_COOKIE = 'mindy_anon';
export const ATTR_COOKIE = 'gca_attr';

type CookieReader = { cookies: { get(name: string): { value?: string } | undefined } };

export function readAnonCookie(request: CookieReader): string | null {
  try {
    const raw = request.cookies.get(ANON_COOKIE)?.value;
    if (!raw) return null;
    const v = decodeURIComponent(raw).trim().toLowerCase();
    return isAnonId(v) ? v : null;
  } catch { return null; }
}

export function readFirstTouchCookie(request: CookieReader): unknown {
  try {
    const raw = request.cookies.get(ATTR_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(decodeURIComponent(raw)) as { first_touch?: unknown };
    return parsed?.first_touch ?? null;
  } catch { return null; }
}

export async function claimAttributionFromRequest(
  request: CookieReader,
  verifiedEmail: string,
  accountCreatedAt: string | null,
): Promise<void> {
  const anonId = readAnonCookie(request);
  if (!anonId) return;
  await runClaim(anonId, readFirstTouchCookie(request), verifiedEmail, accountCreatedAt);
}

async function runClaim(anonId: string, firstTouch: unknown, verifiedEmail: string, accountCreatedAt: string | null): Promise<void> {
  try {
    const r = await claimAnonAttribution(getWriteClient(), {
      anonId, verifiedEmail, accountCreatedAt, clientFirstTouch: firstTouch,
    });
    if (!r.ok) console.error('[share-attribution] claim failed:', r.error);
  } catch (err) {
    console.error('[share-attribution] claim errored (non-fatal):', err);
  }
}

/**
 * Fire the claim after the response. Cookies are read NOW (the request object is not guaranteed
 * after the response); falls back to a detached promise outside a request scope.
 */
export function scheduleAttributionClaim(request: CookieReader, verifiedEmail: string, accountCreatedAt: string | null): void {
  const anonId = readAnonCookie(request);
  if (!anonId) return;
  const firstTouch = readFirstTouchCookie(request);
  const task = () => runClaim(anonId, firstTouch, verifiedEmail, accountCreatedAt);
  try { after(task); } catch { void task(); }
}
