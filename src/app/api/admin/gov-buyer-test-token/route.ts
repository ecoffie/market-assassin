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
      // Create a minimal row. user_profiles.user_id is NOT NULL (it's the
      // Supabase Auth UUID); a test email has no auth user, so we supply a
      // synthetic UUID. TEST-ONLY provisioning — real gov buyers get a row
      // via the normal signup/auth flow, then an admin sets user_type.
      const { error } = await sb
        .from('user_profiles')
        .insert({ user_id: crypto.randomUUID(), email: normEmail, user_type: 'gov_buyer' });
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
