import { createClient } from '@supabase/supabase-js';

const DEFAULT_NAICS_CODES = ['541512', '541611', '541330', '541990', '561210'];

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

  const { error: insertError } = await supabase.from('user_notification_settings').insert({
    user_email: normalizedEmail,
    naics_codes: DEFAULT_NAICS_CODES,
    treatment_type: 'free',
    alerts_enabled: true,
    briefings_enabled: false,
    alert_frequency: 'daily',
    timezone: 'America/New_York',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (insertError) {
    console.error('[Mindy Profile] Error creating user profile:', insertError);
    throw new Error(`Failed to create user profile: ${insertError.message}`);
  }
}
