/**
 * Briefing Preferences API
 *
 * GET: Fetch user's briefing preferences
 * POST: Update user's briefing preferences (timezone, SMS, frequency)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { parseBriefingPreferenceUpdate } from '@/lib/briefings/preference-update';

interface BriefingPreferences {
  timezone: string;
  email_frequency: 'daily' | 'weekly';
  preferred_delivery_hour: number;
  sms_enabled: boolean;
  phone_number: string | null;
}

// Lazy Supabase client
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

/**
 * GET /api/briefings/preferences?email=user@example.com
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  // SECURITY: Verify user owns this email
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  // Coach Mode: show the ACTIVE CLIENT's delivery preferences, not the coach's.
  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const prefsEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;

  const { data, error } = await getSupabase()
    .from('user_notification_settings')
    .select('timezone, briefing_frequency, preferred_delivery_hour, sms_enabled, phone_number, phone_verified, sms_opted_out')
    .eq('user_email', prefsEmail)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows returned (user has no profile yet)
    console.error('[BriefingPrefs] Error fetching preferences:', error);
    return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 });
  }

  // Return defaults if no profile exists
  const preferences: BriefingPreferences = {
    timezone: data?.timezone || 'America/New_York',
    email_frequency: (data?.briefing_frequency as 'daily' | 'weekly') || 'daily',
    preferred_delivery_hour: data?.preferred_delivery_hour || 7,
    sms_enabled: data?.sms_enabled || false,
    phone_number: data?.phone_number || null,
  };

  return NextResponse.json({
    preferences,
    // Verification state drives the double opt-in UI (verified badge vs "Send code").
    phone_verified: Boolean(data?.phone_verified),
    sms_opted_out: Boolean(data?.sms_opted_out),
  });
}

/**
 * POST /api/briefings/preferences
 * Body: { email, timezone?, email_frequency?, preferred_delivery_hour? }
 *
 * SEC-3 (2026-09-27): explicit allowlist (see lib/briefings/preference-update.ts). This used to
 * upsert `{ briefings_enabled: true, ...requestBody }`, letting any authenticated caller write any
 * column on their own settings row (tier, paid/subscription state, identity, toggles) and
 * force-enabling briefings on every call. Now:
 *  - only the allowlisted fields are written, any other key is rejected by name;
 *  - SMS is not settable here (consent lives in sms/verify/* and sms/disable);
 *  - nothing is forced, and a missing row is NOT created with DB defaults (those turn briefings
 *    on) — it is reported, never a silent success.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { email, ...updates } = body as { email?: string } & Record<string, unknown>;

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  // SECURITY: Verify user owns this email
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const parsed = parseBriefingPreferenceUpdate(updates);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, rejected: parsed.rejected ?? [] }, { status: 400 });
  }

  // Coach Mode: save the ACTIVE CLIENT's delivery preferences, not the coach's.
  const { workspaceId, asClient } = await resolveActiveWorkspace(auth.email!, request);
  const prefsEmail = asClient ? clientNotificationEmail(workspaceId) : auth.email!;

  const { count, error } = await getSupabase()
    .from('user_notification_settings')
    .update({ ...parsed.patch, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('user_email', prefsEmail);

  if (error) {
    console.error('[BriefingPrefs] Error updating preferences:', error.message);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }
  if (count == null) {
    // Unknown is not success (Bug Prevention Rule #11).
    return NextResponse.json({ error: 'Update could not be confirmed' }, { status: 500 });
  }
  if (count === 0) {
    return NextResponse.json({ error: 'settings_not_initialized' }, { status: 409 });
  }

  const { data, error: readErr } = await getSupabase()
    .from('user_notification_settings')
    .select('timezone, briefing_frequency, preferred_delivery_hour, sms_enabled, phone_number')
    .eq('user_email', prefsEmail)
    .single();
  if (readErr || !data) {
    return NextResponse.json({ error: 'Failed to read preferences' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    preferences: {
      timezone: data.timezone,
      email_frequency: data.briefing_frequency,
      preferred_delivery_hour: data.preferred_delivery_hour,
      sms_enabled: data.sms_enabled,
      phone_number: data.phone_number,
    },
  });
}
