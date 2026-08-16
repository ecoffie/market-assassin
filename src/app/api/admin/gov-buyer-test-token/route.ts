/**
 * Admin-only: mint a gov_buyer MI session token for dry-run testing.
 *
 * GET /api/admin/gov-buyer-test-token?password=...&email=tester@agency.gov[&provision=true]
 *
 * Lets the dry-run script (tests/test-gov-buyer.sh) exercise the gated
 * /api/gov-buyer/market-research route without a real Supabase login.
 * Gated by ADMIN_PASSWORD — do NOT use as a user-facing auth path.
 *
 * provision=true also flips the user's user_profiles.user_type to
 * 'gov_buyer' so the requireGovBuyer check passes for the test email.
 *
 * PRD: docs/PRD-gov-buyer-market-research.md §5
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  if (sp.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = sp.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }

  let provisioned = false;
  if (sp.get('provision') === 'true') {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const normEmail = email.toLowerCase().trim();

    // Does a profile already exist for this email?
    const { data: existing } = await sb
      .from('user_profiles')
      .select('user_id')
      .eq('email', normEmail)
      .maybeSingle();

    if (existing) {
      // Just flip the type.
      const { error } = await sb
        .from('user_profiles')
        .update({ user_type: 'gov_buyer' })
        .eq('email', normEmail);
      if (error) {
        return NextResponse.json({ error: `provision failed: ${error.message}` }, { status: 500 });
      }
    } else {
      // user_profiles.user_id has a REAL foreign key to auth.users(id) —
      //   user_profiles_user_id_fkey → REFERENCES auth.users(id) ON DELETE CASCADE
      // so a synthetic crypto.randomUUID() can never satisfy it. This route
      // did exactly that and failed 100% of the time with
      // "violates foreign key constraint user_profiles_user_id_fkey".
      //
      // Consequence, measured 2026-08-16: ZERO gov_buyer profiles existed in
      // production, so /api/gov-buyer/market-research and its .docx memo
      // export returned 403 for everyone — including the Gold Coast demo.
      //
      // Fix: mint a real auth user first (admin API, email pre-confirmed), then
      // hang the profile off its id. Idempotent — an existing auth user is
      // reused rather than re-created.
      let authUserId: string | null = null;

      // Reuse an existing auth user with this email if there is one.
      const { data: page } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      authUserId = page?.users?.find((u) => (u.email || '').toLowerCase() === normEmail)?.id ?? null;

      if (!authUserId) {
        const { data: created, error: authErr } = await sb.auth.admin.createUser({
          email: normEmail,
          email_confirm: true,
          user_metadata: { provisioned_by: 'gov-buyer-test-token', test_account: true },
        });
        if (authErr || !created?.user?.id) {
          return NextResponse.json(
            { error: `provision failed: could not create auth user — ${authErr?.message ?? 'no id returned'}` },
            { status: 500 },
          );
        }
        authUserId = created.user.id;
      }

      const { error } = await sb
        .from('user_profiles')
        .insert({ user_id: authUserId, email: normEmail, user_type: 'gov_buyer' });
      if (error) {
        return NextResponse.json({ error: `provision failed: ${error.message}` }, { status: 500 });
      }
    }
    provisioned = true;
  }

  return NextResponse.json({
    success: true,
    email,
    provisioned,
    sessionToken: createMIAuthSessionToken(email),
    note: 'Pass this in the x-mi-auth-token header to /api/gov-buyer/market-research',
  });
}
