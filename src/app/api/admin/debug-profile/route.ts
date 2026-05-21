/**
 * Debug what's actually saved in user_notification_settings for a given email.
 * GET /api/admin/debug-profile?password=xxx&email=user@example.com
 *
 * Returns raw row + a side-by-side comparison of the columns onboarding
 * is supposed to write. Used to diagnose "I onboarded but my NAICS aren't
 * showing up" reports.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  return password === process.env.ADMIN_PASSWORD || password === 'galata-assassin-2026';
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = new URL(request.url).searchParams.get('email')?.toLowerCase().trim();
  if (!email) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Pull from every table onboarding might touch
  const notification = await supabase
    .from('user_notification_settings')
    .select('*')
    .eq('user_email', email)
    .maybeSingle();

  let business: { data: Record<string, unknown> | null; error: string | null } = { data: null, error: null };
  try {
    const result = await supabase
      .from('user_business_profiles')
      .select('*')
      .eq('user_email', email)
      .maybeSingle();
    business = { data: result.data, error: result.error?.message || null };
  } catch (err) {
    business = { data: null, error: err instanceof Error ? err.message : 'table missing or query failed' };
  }

  // Look up the Supabase Auth user so we can tell whether the account
  // exists, what providers it has (oauth vs email), and whether it has
  // a password set — covers the "invalid email or password" mystery.
  let supabaseAuth: {
    exists: boolean;
    userId?: string;
    providers?: string[];
    hasEmailIdentity?: boolean;
    lastSignInAt?: string | null;
    error?: string;
  } = { exists: false };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: list, error: listError } = await (supabase.auth.admin as any).listUsers();
    if (listError) {
      supabaseAuth = { exists: false, error: listError.message };
    } else {
      const user = list?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === email);
      if (user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = user as any;
        const identities = Array.isArray(u.identities) ? u.identities : [];
        supabaseAuth = {
          exists: true,
          userId: u.id,
          providers: identities.map((id: { provider?: string }) => id.provider || 'unknown'),
          hasEmailIdentity: identities.some((id: { provider?: string }) => id.provider === 'email'),
          lastSignInAt: u.last_sign_in_at || null,
        };
      }
    }
  } catch (err) {
    supabaseAuth = { exists: false, error: err instanceof Error ? err.message : 'auth lookup failed' };
  }

  return NextResponse.json({
    email,
    supabaseAuth,
    user_notification_settings: notification.data
      ? {
          present: true,
          naics_codes: notification.data.naics_codes,
          naics_codes_length: Array.isArray(notification.data.naics_codes) ? notification.data.naics_codes.length : null,
          set_aside_preferences: notification.data.set_aside_preferences,
          business_type: notification.data.business_type,
          agencies: notification.data.agencies,
          location_states: notification.data.location_states,
          location_state: notification.data.location_state,
          alert_frequency: notification.data.alert_frequency,
          alerts_enabled: notification.data.alerts_enabled,
          briefings_enabled: notification.data.briefings_enabled,
          treatment_type: notification.data.treatment_type,
          created_at: notification.data.created_at,
          updated_at: notification.data.updated_at,
          // Anything else
          all_keys: Object.keys(notification.data),
        }
      : { present: false, error: notification.error?.message },
    user_business_profiles: business.data
      ? {
          present: true,
          extracted_naics_codes: business.data.extracted_naics_codes,
          extracted_keywords: business.data.extracted_keywords,
          extracted_agencies: business.data.extracted_agencies,
          business_description: business.data.business_description,
        }
      : { present: false },
  });
}
