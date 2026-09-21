/**
 * Maps-native sign-out. Bucket A item 5.
 *
 * WHY THIS EXISTS: the Maps account menu ended every session with
 * `location.href = "/app?signout=1"` — it cleared localStorage locally, then handed the user
 * to the legacy app. Two problems:
 *
 *   1. `signout=1` IS CONSUMED BY NOTHING. Grepped the whole tree: no reader anywhere. The
 *      redirect accomplished nothing except leaving the Maps product, so the last action of
 *      every Maps session was an escape into the thing we are replacing.
 *   2. Clearing localStorage is not a complete sign-out. `ma_access_email` is an HTTP cookie
 *      set server-side (api/verify-ma-access), so it survived. `verifyUserOwnsEmail` still
 *      accepts that cookie as an identity, which means the "signed-out" browser kept a
 *      credential the server would honour.
 *
 * WHAT THIS DOES: expires the server-set auth cookies. The client clears its own localStorage
 * keys before calling — the two halves together are the full teardown.
 *
 * ⚠️ SCOPE: session teardown ONLY. This changes no session semantics, no auth policy, and no
 * account UI. It is the same sign-out, minus the detour through /app.
 *
 * IDEMPOTENT BY DESIGN: signing out when already signed out (or with an expired session) must
 * be harmless — it expires cookies that may not exist and returns 200 either way. A sign-out
 * that can fail is worse than useless, because the user has already decided to leave.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Server-set auth cookies that must not survive a sign-out. */
const AUTH_COOKIES = ['ma_access_email'];

function clearAll(): NextResponse {
  const res = NextResponse.json({ success: true });
  for (const name of AUTH_COOKIES) {
    // maxAge 0 + an empty value expires it in every browser, including when the cookie is
    // absent (a no-op rather than an error — see the idempotence note above).
    res.cookies.set(name, '', {
      maxAge: 0,
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
  }
  return res;
}

export async function POST() {
  return clearAll();
}

/**
 * GET is accepted too so a plain link can sign out if scripting fails. It performs the same
 * teardown; the caller decides where to land (the Maps home constant), so this never redirects
 * into /app.
 */
export async function GET() {
  return clearAll();
}
