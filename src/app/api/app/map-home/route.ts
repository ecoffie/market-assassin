/**
 * GET /api/app/map-home?email=<user> — the signed-in user's home state for the Opportunity
 * Map's default view (Zillow opens to YOUR city/state, not the globe).
 *
 * Returns just the 2-letter state so the map can setView to its centroid on boot. Authed via
 * verifyUserOwnsEmail (accepts the MI 2FA token header, so MI-token /app users resolve — the
 * heavier /api/app/profile requires a Supabase Bearer session that MI-token users don't carry).
 * Read-only. A miss (no profile / no state) returns state:null → the map falls back to CONUS.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });

  // SECURITY (2026-08-23): requireStrongAuth SKIPS the two weak paths — the spoofable
  // plaintext `ma_access_email` cookie, and the token-less staff-domain claim ("Method 4",
  // which trusts ANY staff email with no credential at all).
  //
  // MEASURED ON PROD before this fix: GET ?email=<a real staff address> with NO cookie and NO
  // token returned {"success":true,"state":"AL"}, while an unknown address correctly returned
  // Unauthorized. So knowing an email was sufficient to (a) read that user's home state and
  // (b) CONFIRM THE ACCOUNT EXISTS — an account-enumeration oracle.
  //
  // The MI 2FA token path (Method 2.5) is preserved, so genuinely signed-in /app users are
  // unaffected; only the credential-less paths are refused.
  const auth = await verifyUserOwnsEmail(request, email, { requireStrongAuth: true });
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await db.from('user_notification_settings')
    .select('location_state, location_states')
    .eq('user_email', auth.email).limit(1).maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const states = Array.isArray(data?.location_states) ? data!.location_states : [];
  const state = String(data?.location_state || states[0] || '').toUpperCase().slice(0, 2) || null;
  return NextResponse.json({ success: true, state });
}
