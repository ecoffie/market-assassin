import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUserAuth } from '@/lib/api-auth';
import { profileFromAuthUser } from '@/lib/mindy/account-avatar';
import { requireMIAuthSession } from '@/lib/two-factor-session';

/**
 * GET /api/app/me — the signed-in user's display identity for app chrome.
 *
 * Returns { email, name, picture } for the authenticated caller so the
 * Opportunity Map account avatar (and any other logged-in chrome) can show the
 * user's Google profile photo top-right, Zillow-style. Picture comes from the
 * existing Supabase auth user (user_metadata + identities[].identity_data) —
 * never stuffed into the MI HMAC token.
 *
 * Auth reuses the EXISTING pattern — `requireMIAuthSession` (cookie / header)
 * then `requireUserAuth`. No new auth path. A logged-out request gets 401 and
 * the client falls back to "Log In".
 *
 * `picture` is null when the user has no stored photo (Microsoft / password)
 * — the client degrades to initials. Never throws on a missing photo.
 */

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

interface MeProfile {
  name: string | null;
  picture: string | null;
}

// Small in-memory cache: the auth-user lookup pages through listUsers, so cache
// the resolved {name,picture} per email for a few minutes. The avatar changes
// rarely; this keeps the per-page-load /me hit from re-scanning every time.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: MeProfile }>();

async function resolveProfile(email: string): Promise<MeProfile> {
  const cached = cache.get(email);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  const empty: MeProfile = { name: null, picture: null };
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return empty;
  }

  let value: MeProfile = empty;
  try {
    // Find the Supabase auth user by email (mirrors known-accounts.findAuthUserByEmail).
    let page = 1;
    for (;;) {
      const { data: list, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break; // surface nothing — degrade to initials, don't fabricate
      const users = list?.users || [];
      const match = users.find((u) => (u.email || '').toLowerCase() === email);
      if (match) {
        value = profileFromAuthUser(match);
        break;
      }
      if (users.length < 1000) break;
      page += 1;
      if (page > 20) break;
    }
  } catch {
    value = empty;
  }

  cache.set(email, { at: Date.now(), value });
  return value;
}

async function resolveCallerEmail(request: NextRequest): Promise<string | null> {
  // Universal session: the HMAC token may be on the mi_auth cookie or in
  // x-mi-auth-token. The Maps header used to require ?email= — HMAC tokens
  // are not JWTs, so the client often sent an empty email and this route
  // 401'd, leaving the purple "?" initial on screen.
  const session = requireMIAuthSession(request);
  if (session.ok && session.session.email) return session.session.email;

  const auth = await requireUserAuth(request);
  if (auth.authenticated && auth.email) return auth.email;
  return null;
}

export async function GET(request: NextRequest) {
  const email = await resolveCallerEmail(request);
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const profile = await resolveProfile(email);

  return NextResponse.json(
    { email, name: profile.name, picture: profile.picture },
    { headers: { 'cache-control': 'no-store' } }
  );
}
