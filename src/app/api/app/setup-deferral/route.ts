/**
 * POST /api/app/setup-deferral
 *
 * Records that an authenticated user left profile setup. Does not create a
 * notification row, does not enable alerts, and does not mint a session.
 * Unauthenticated callers get 401 — skipping setup is not a way in.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { resolvePostSignupDestination } from '@/lib/mindy/post-signup-destination';
import { deferralPreferencePatch } from '@/lib/onboarding/setup-deferral';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const auth = requireMIAuthSession(request, typeof body.email === 'string' ? body.email : null);
    if (!auth.ok) return auth.response;
    const email = auth.session.email;
    if (!email) {
      return NextResponse.json({ success: false, error: 'Sign in required' }, { status: 401 });
    }

    const destination = resolvePostSignupDestination({
      next: typeof body.next === 'string' ? body.next : null,
      intent: typeof body.intent === 'string' ? body.intent : null,
      purchaseNext: typeof body.purchaseNext === 'string' ? body.purchaseNext : null,
    });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }
    const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: row, error: readErr } = await sb
      .from('user_profiles')
      .select('preferences')
      .eq('email', email)
      .maybeSingle();
    if (readErr) {
      return NextResponse.json({ success: false, error: readErr.message }, { status: 500 });
    }

    const existing = row?.preferences && typeof row.preferences === 'object' && !Array.isArray(row.preferences)
      ? row.preferences as Record<string, unknown>
      : {};
    const preferences = deferralPreferencePatch(existing, new Date().toISOString());

    if (!row) {
      // No profile row to stamp. Still return the destination — the client must
      // not be trapped — but say the stamp did not land so the gate can stay honest.
      return NextResponse.json({
        success: true,
        deferred: false,
        path: destination.path,
        intent: destination.intent,
        reason: 'no user_profiles row to stamp; alerts were not enabled',
      });
    }

    const { error: writeErr } = await sb
      .from('user_profiles')
      .update({ preferences })
      .eq('email', email);
    if (writeErr) {
      return NextResponse.json({ success: false, error: writeErr.message, path: destination.path }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deferred: true,
      path: destination.path,
      intent: destination.intent,
      reason: destination.reason,
    });
  } catch (error) {
    console.error('[setup-deferral]', error);
    return NextResponse.json({ success: false, error: 'Failed to leave setup' }, { status: 500 });
  }
}
