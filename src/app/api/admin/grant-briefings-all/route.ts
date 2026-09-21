/**
 * Admin: Grant briefings access to ALL users with profiles
 *
 * GET /api/admin/grant-briefings-all?password=...&mode=preview
 * GET /api/admin/grant-briefings-all?password=...&mode=execute
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchAllPaged } from '@/lib/supabase/paged-read';
import { enableBriefingsDelivery } from '@/lib/supabase/briefings-entitlement';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const mode = searchParams.get('mode') || 'preview';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

  // Get ALL user profiles
  // INT-011 (truncation BEFORE the grant): this reads every profile, filters to those WITHOUT
  // briefings access, and grants. Measured 2026-08-23: 2,185 profiles — an unpaginated read saw
  // ~1,000, so roughly 1,185 users could never be granted on ANY run, however often it fired.
  let profiles: { email: string; access_briefings: boolean }[];
  try {
    profiles = await fetchAllPaged<{ email: string; access_briefings: boolean }>(() => getSupabase()
      .from('user_profiles')
      .select('email, access_briefings')
      .order('email', { ascending: true }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  const withoutBriefings = profiles?.filter((p: { access_briefings: boolean }) => !p.access_briefings) || [];
  const withBriefings = profiles?.filter((p: { access_briefings: boolean }) => p.access_briefings) || [];

  if (mode === 'preview') {
    return NextResponse.json({
      mode: 'preview',
      total_profiles: profiles?.length || 0,
      already_have_access: withBriefings.length,
      need_access: withoutBriefings.length,
      will_grant_to: withoutBriefings.map((p: { email: string }) => p.email),
      instructions: 'Add ?mode=execute to grant access to all',
    });
  }

  // Execute mode
  const results = { success: [] as string[], failed: [] as string[] };

  for (const profile of withoutBriefings) {
    try {
      // Update Supabase
      await getSupabase()
        .from('user_profiles')
        .update({ access_briefings: true })
        .eq('email', profile.email);

      // Entitlement lives in user_profiles; DELIVERY is gated separately by
      // user_notification_settings.briefings_enabled, which precompute-briefings
      // filters on. Granting one without the other = entitled but never sent.
      await enableBriefingsDelivery(getSupabase(), profile.email);

      // Set KV access
      await kv.set(`briefings:${profile.email.toLowerCase()}`, 'true');

      results.success.push(profile.email);
    } catch (err) {
      results.failed.push(profile.email);
    }
  }

  return NextResponse.json({
    mode: 'execute',
    granted: results.success.length,
    failed: results.failed.length,
    success: results.success,
    failed_emails: results.failed,
    total_with_access: withBriefings.length + results.success.length,
  });
}
