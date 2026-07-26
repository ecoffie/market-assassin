import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUserAuth } from '@/lib/api-auth';

/**
 * GET /api/app/me — the signed-in user's display identity for app chrome.
 *
 * Returns { email, name, picture } for the authenticated caller so the
 * Opportunity Map account avatar (and any other logged-in chrome) can show the
 * user's Google profile photo top-right, Zillow-style. The photo is the one
 * genuinely-missing piece: it rides on the OAuth (Google) identity as
 * `user_metadata.picture` / `avatar_url` on the Supabase auth user.
 *
 * Auth reuses the EXISTING pattern — `requireUserAuth` accepts the MI 2FA
 * session token (x-mi-auth-token header, the same `mi_beta_auth_token` the map
 * reads from localStorage), a Supabase session, or a signed email token. No new
 * auth path is invented. A logged-out request gets 401 and the client falls back
 * to a "Sign in" avatar.
 *
 * `picture` is null when the user has no Google photo (e.g. email/password
 * signup) — the client degrades to initials. Never throws on a missing photo.
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
        const meta = (match.user_metadata || {}) as Record<string, unknown>;
        const picture =
          (typeof meta.picture === 'string' && meta.picture) ||
          (typeof meta.avatar_url === 'string' && meta.avatar_url) ||
          null;
        const name =
          (typeof meta.full_name === 'string' && meta.full_name) ||
          (typeof meta.name === 'string' && meta.name) ||
          null;
        value = { name, picture };
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

export async function GET(request: NextRequest) {
  const auth = await requireUserAuth(request);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const profile = await resolveProfile(auth.email);

  return NextResponse.json(
    { email: auth.email, name: profile.name, picture: profile.picture },
    { headers: { 'cache-control': 'no-store' } }
  );
}
