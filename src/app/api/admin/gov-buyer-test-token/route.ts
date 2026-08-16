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

    // UPSERT, never check-then-insert. A database trigger creates the
    // user_profiles row automatically (defaulting user_type to 'seller') the
    // moment an auth user is created, so a read-then-insert ALWAYS loses the
    // race: the check sees nothing, the insert then dies on
    // user_profiles_user_id_key. That is what this route did, and it is why
    // provisioning still failed after the FK fix.
    //
    // Sequence that actually works:
    //   1. find or create the auth user (user_id has a REAL FK to auth.users)
    //   2. upsert the profile on user_id — wins whether the trigger fired or not
    let authUserId: string | null = null;

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

    // onConflict user_id: the trigger's row and ours are the same row.
    const { error: upsertErr } = await sb
      .from('user_profiles')
      .upsert({ user_id: authUserId, email: normEmail, user_type: 'gov_buyer' }, { onConflict: 'user_id' });
    if (upsertErr) {
      return NextResponse.json({ error: `provision failed: ${upsertErr.message}` }, { status: 500 });
    }

    // Read back — a silent no-op upsert would otherwise report success while
    // the caller still gets 403 from requireGovBuyer.
    const { data: check } = await sb
      .from('user_profiles')
      .select('user_type')
      .eq('user_id', authUserId)
      .maybeSingle();
    if (check?.user_type !== 'gov_buyer') {
      return NextResponse.json(
        { error: `provision failed: user_type is "${check?.user_type ?? 'missing'}" after upsert, expected gov_buyer` },
        { status: 500 },
      );
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
