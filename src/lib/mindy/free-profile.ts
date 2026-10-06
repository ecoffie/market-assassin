import { createClient } from '@supabase/supabase-js';
import { freeNotificationSettingsInsert } from '@/lib/onboarding/free-notification-defaults';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Supabase service role is not configured');
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function ensureMindyFreeProfile(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const supabase = getSupabaseAdmin();

  const { data: existing, error: selectError } = await supabase
    .from('user_notification_settings')
    .select('user_email, treatment_type')
    .eq('user_email', normalizedEmail)
    .maybeSingle();

  if (selectError) {
    console.error('[Mindy Profile] Error checking existing user:', selectError);
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from('user_notification_settings')
      .update({
        alerts_enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq('user_email', normalizedEmail);

    if (updateError) {
      console.error('[Mindy Profile] Error updating existing user:', updateError);
    }
    return;
  }

  // NO NAICS on a new row. This insert used to write the 5-code placeholder
  // (541512/541611/541330/541990/561210) with naics_source NULL. Measured 2026-10-06: all 64
  // September–October signups holding the placeholder came through here (email signup via
  // /app/setup-password); Google/Microsoft signups never got it. The daily-alert cron reads
  // stored codes as targeting, so these accounts were mailed generic IT/admin work as if it
  // matched their business, while naics_source said "unknown", not "default".
  // A user with no targeting is skipped by the alert cron and reached by the profile-setup
  // flow instead (daily-alerts "NO TARGETING -> SKIP", 2026-07-27) — the same state every
  // OAuth signup already starts in. Use the ONE shared free-row definition so this path
  // cannot drift from /api/app/profile and /api/company-setup again.
  const nowIso = new Date().toISOString();
  const { error: insertError } = await supabase.from('user_notification_settings').insert({
    ...freeNotificationSettingsInsert(normalizedEmail, nowIso),
    updated_at: nowIso,
  });

  if (insertError) {
    console.error('[Mindy Profile] Error creating user profile:', insertError);
    throw new Error(`Failed to create user profile: ${insertError.message}`);
  }
}
