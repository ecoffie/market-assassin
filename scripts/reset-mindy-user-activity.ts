/**
 * Reset a Mindy user's ACTIVITY back to zero while KEEPING their login/profile row.
 * For fresh onboarding walkthroughs / a user who wants a true "start over" but not
 * a full account delete.
 *
 * Unlike /api/admin/delete-mindy-user (which hard-deletes the account + auth), this:
 *   - KEEPS the user_notification_settings row (the login for no-auth accounts)
 *   - CLEARS its targeting fields (naics/keywords/agencies/psc/states/set-asides)
 *     + onboarding_completed=false  → onboarding wizard shows again
 *   - DELETES all activity rows (targets, pursuits, journey progress, vault,
 *     contacts, logs) keyed by user_email
 *
 * Dry-run by default (counts only, NO writes). Pass --go to actually write.
 *
 *   npx tsx scripts/reset-mindy-user-activity.ts <email>          # dry-run
 *   npx tsx scripts/reset-mindy-user-activity.ts <email> --go     # execute
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env.local' });

const email = process.argv[2];
const GO = process.argv.includes('--go');

if (!email || email.startsWith('--')) {
  console.error('Usage: npx tsx scripts/reset-mindy-user-activity.ts <email> [--go]');
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Activity tables keyed by user_email — DELETE all rows for this user.
// (Non-existent/legacy tables error harmlessly and are reported, not fatal.)
const ACTIVITY_TABLES = [
  'user_target_list',
  'user_pipeline',
  'pipeline_history',
  'pursuit_monitor_state',
  'pursuit_change_log',
  'pursuit_documents',
  'pursuit_compliance',
  'mindy_journey_progress',
  'contacts',
  'user_teaming_partners',
  'user_business_profiles',
  'user_engagement',
  'user_engagement_scores',
  'alert_log',
  'briefing_log',
  'briefing_feedback',
  'signup_events',
  'opportunity_shares',
  // 5 vault tables
  'vault_identity',
  'vault_past_performance',
  'vault_capabilities',
  'vault_team',
  'vault_boilerplate',
];

async function main() {
  console.log(`\n=== Reset activity for ${email}  (${GO ? 'EXECUTE' : 'DRY-RUN — no writes'}) ===\n`);

  // Confirm the profile row exists (we KEEP it). Plain select + array check —
  // .maybeSingle() can spuriously return null on some PostgREST responses.
  const { data: profRows, error: profErr } = await sb
    .from('user_notification_settings')
    .select('user_email, naics_codes, keywords')
    .eq('user_email', email);
  if (profErr) { console.error(`❌ Error reading profile: ${profErr.message}`); process.exit(1); }
  if (!profRows || profRows.length === 0) {
    console.error(`❌ No user_notification_settings row for ${email} — aborting (nothing to keep).`);
    process.exit(1);
  }
  const p = profRows[0] as { naics_codes?: string[]; keywords?: string[] };
  console.log(`✓ Profile row exists (kept). Current: ${p.naics_codes?.length ?? 0} NAICS, ${p.keywords?.length ?? 0} keywords.`);
  console.log(`  (Onboarding wizard re-shows when codes are empty — no separate flag; matches the in-app self-serve Reset.)\n`);

  let total = 0;
  for (const table of ACTIVITY_TABLES) {
    // count first
    const { count, error: cErr } = await sb
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('user_email', email);
    if (cErr) { console.log(`  ${table.padEnd(26)}  (skip: ${cErr.message.slice(0, 40)})`); continue; }
    const n = count ?? 0;
    total += n;
    if (!GO) { console.log(`  ${table.padEnd(26)}  ${n} row(s)`); continue; }
    if (n === 0) { console.log(`  ${table.padEnd(26)}  0 — nothing to delete`); continue; }
    const { error: dErr } = await sb.from(table).delete().eq('user_email', email);
    console.log(`  ${table.padEnd(26)}  ${dErr ? 'ERROR ' + dErr.message : `deleted ${n}`}`);
  }

  console.log(`\n  Total activity rows ${GO ? 'deleted' : 'that WOULD be deleted'}: ${total}\n`);

  // Clear targeting fields + reset onboarding flag (KEEP the row).
  // Clear ONLY columns that exist on the table (verified against live schema).
  // Empty codes is what re-triggers the onboarding wizard — there is no
  // onboarding_completed column on this table.
  const cleared = {
    naics_codes: [] as string[],
    psc_codes: [] as string[],
    keywords: [] as string[],
    agencies: [] as string[],
    location_states: [] as string[],
    set_aside_preferences: [] as string[],
  };
  if (!GO) {
    console.log('  user_notification_settings: WOULD clear naics/psc/keywords/agencies/states/set-asides (empty codes → onboarding re-shows)\n');
  } else {
    const { error } = await sb
      .from('user_notification_settings')
      .update(cleared)
      .eq('user_email', email);
    console.log(`  user_notification_settings: ${error ? 'ERROR ' + error.message : 'cleared targeting (onboarding will re-show)'}\n`);
  }

  console.log(GO ? '✅ Reset complete — profile is empty, onboarding will show fresh.\n' : 'ℹ️  Dry-run only. Re-run with --go to execute.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
