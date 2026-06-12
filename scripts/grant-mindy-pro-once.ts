import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { grantBriefingsAccess, hasBriefingsAccess } from '../src/lib/briefings/access';
import { isAdvocateAccount } from '../src/lib/mindy/advocate-accounts';

const email = (process.argv[2] || '').toLowerCase().trim();
const asAdvocate = process.argv.includes('--advocate') || isAdvocateAccount(email);

if (!email || !email.includes('@')) {
  console.error('Usage: npx tsx scripts/grant-mindy-pro-once.ts email@example.com [--advocate]');
  process.exit(1);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env vars');

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Mirror access_briefings when a profile row already exists (requires auth user_id to create).
  const { data: profileRows } = await supabase
    .from('user_profiles')
    .select('email, access_briefings')
    .eq('email', email);

  let profile = profileRows?.[0] ?? null;
  if (profileRows && profileRows.length > 0) {
    const { data: updated, error: updateErr } = await supabase
      .from('user_profiles')
      .update({ access_briefings: true, updated_at: new Date().toISOString() })
      .eq('email', email)
      .select('email, access_briefings')
      .maybeSingle();
    if (updateErr) throw updateErr;
    profile = updated;
  }

  const notifPatch: Record<string, unknown> = {
    briefings_enabled: true,
    alerts_enabled: true,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  if (asAdvocate) {
    notifPatch.treatment_type = 'briefings';
    notifPatch.invitation_source = 'advocate';
    notifPatch.beta_pioneer = true;
    notifPatch.paid_status = false;
  }

  const { data: notif, error: notifErr } = await supabase
    .from('user_notification_settings')
    .update(notifPatch)
    .eq('user_email', email)
    .select('user_email, briefings_enabled, alerts_enabled, is_active, treatment_type, invitation_source, beta_pioneer')
    .maybeSingle();
  if (notifErr) throw notifErr;

  await grantBriefingsAccess(email);

  console.log(JSON.stringify({
    success: true,
    email,
    accountType: asAdvocate ? 'advocate' : 'pro_comp',
    profile,
    notification: notif,
    hasBriefingsAccess: await hasBriefingsAccess(email),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
