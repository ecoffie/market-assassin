/**
 * Universal first-party Mindy session cookie.
 *
 * Identity on getmindy.ai used to live ONLY in `localStorage.mi_beta_auth_token`,
 * copied into `x-mi-auth-token` by client JS. Server-rendered surfaces (/mcp,
 * /mcp/setup) therefore prerendered signed-out even when the browser already
 * held a valid 30-day MI HMAC token. Maps-only password login never wrote a
 * cookie, so /mcp could not see the session without JS hydration.
 *
 * This module is NOT a second auth system. It stores the SAME HMAC token
 * (`createMIAuthSessionToken` / `createTwoFactorSessionToken`) as an HttpOnly
 * first-party cookie so the server can resolve "who are you?" on the first
 * HTML paint.
 *
 * Cookie: `mi_auth`
 *   HttpOnly · Secure (prod) · Path=/ · SameSite=Lax · host-only (no Domain)
 *   maxAge aligned with SESSION_TTL_MS (30 days)
 *
 * Read order (see getTwoFactorTokenFromRequest):
 *   1. x-mi-auth-token
 *   2. x-mi-2fa-token
 *   3. Authorization: Bearer
 *   4. mi_auth cookie
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { MI_AUTH_COOKIE, SESSION_TTL_MS } from '@/lib/mindy/mi-auth-constants';
import { verifyTwoFactorSessionToken } from '@/lib/two-factor-session';

export { MI_AUTH_COOKIE };

/** Cookie lifetime in seconds — same 30-day TTL as the HMAC payload. */
export const MI_AUTH_COOKIE_MAX_AGE_S = Math.floor(SESSION_TTL_MS / 1000);

export function miAuthCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  path: '/';
  sameSite: 'lax';
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    sameSite: 'lax',
    maxAge: MI_AUTH_COOKIE_MAX_AGE_S,
    // host-only: do not set `domain`
  };
}

export function attachMIAuthCookie(res: NextResponse, token: string): NextResponse {
  if (token) res.cookies.set(MI_AUTH_COOKIE, token, miAuthCookieOptions());
  return res;
}

export function clearMIAuthCookie(res: NextResponse): NextResponse {
  res.cookies.set(MI_AUTH_COOKIE, '', { ...miAuthCookieOptions(), maxAge: 0 });
  return res;
}

/** JSON response that also Sets-Cookie when a session token was minted. */
export function jsonWithMIAuth(
  body: Record<string, unknown>,
  init?: { status?: number },
): NextResponse {
  const res = NextResponse.json(body, init);
  const token = typeof body.sessionToken === 'string' ? body.sessionToken : '';
  if (token) attachMIAuthCookie(res, token);
  return res;
}

export type MindyCookieSession =
  | { signedIn: true; email: string }
  | { signedIn: false; email: null };

/**
 * Server-component / Route Handler read of the universal cookie.
 * Missing secret or a bad cookie → signed out (never throw into HTML).
 */
export async function getMindySessionFromCookies(): Promise<MindyCookieSession> {
  try {
    const store = await cookies();
    const token = store.get(MI_AUTH_COOKIE)?.value;
    const result = verifyTwoFactorSessionToken(token);
    if (result.valid && result.email) {
      return { signedIn: true, email: result.email };
    }
  } catch {
    /* cookies() unavailable or signing secret missing — treat as signed out */
  }
  return { signedIn: false, email: null };
}
