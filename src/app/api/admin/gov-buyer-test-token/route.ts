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
import { getOrCreateProfile } from '@/lib/supabase/user-profiles';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

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
    // Use the existing helper to guarantee the row exists (it handles
    // license_key + default access flags + email normalization) — the
    // codebase does select-then-insert here, NOT upsert(onConflict:email),
    // so we don't assume a unique constraint that may not exist.
    const profile = await getOrCreateProfile(email);
    if (!profile) {
      return NextResponse.json(
        { error: 'provision failed: could not get/create profile' },
        { status: 500 },
      );
    }
    // Flip user_type by email (the column added in
    // 20260604_user_type_gov_buyer.sql).
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { error } = await sb
      .from('user_profiles')
      .update({ user_type: 'gov_buyer' })
      .eq('email', email.toLowerCase().trim());
    if (error) {
      return NextResponse.json(
        { error: `provision failed: ${error.message}` },
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
