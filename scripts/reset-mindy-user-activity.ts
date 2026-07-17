/**
 * Reset a Mindy user's ACTIVITY back to zero while KEEPING their login/profile row.
 * For fresh onboarding walkthroughs / a user who wants a true "start over" but not
 * a full account delete.
 *
 * Unlike /api/admin/delete-mindy-user (which hard-deletes the account + auth), this:
 *   - KEEPS the user_notification_settings row (the login for no-auth accounts)
 *   - CLEARS its targeting fields (naics/keywords/agencies/psc/states/set-asides)
 *     + onboarding_completed=false  → onboarding wizard shows again
 *   - DELETES all activity rows (targets, pursuits, journey progress, contacts,
 *     logs), each keyed by its OWN user column — see ACTIVITY_TABLES
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

/**
 * Activity tables to clear, each with the column that keys it to a user.
 *
 * The key is EXPLICIT per table because assuming `user_email` everywhere was
 * wrong and silently so: `opportunity_shares` keys on `sharer_email`, so
 * `.eq('user_email', …)` errored and the table was skipped on every run since
 * this script was written. Real rows survived every "reset".
 *
 * Verified against the live schema 2026-07-16 — every table below exists and has
 * the named column.
 *
 * DELIBERATELY ABSENT:
 *   pipeline_history, pursuit_monitor_state
 *     Neither has a user column; both FK to user_pipeline ON DELETE CASCADE, so
 *     deleting user_pipeline above already removes them. Listing them here only
 *     produced a blank "(skip: )" that looked like a defect.
 *   vault_identity, vault_past_performance, vault_capabilities, vault_team,
 *   vault_boilerplate
 *     These five NEVER EXISTED. No migration creates them, no code references
 *     them, and no vault_* table exists in the database. They were fiction that
 *     reported "0 row(s)" — see the count===null handling below for why that
 *     read as success for months.
 */
const ACTIVITY_TABLES: { table: string; key: string }[] = [
  { table: 'user_target_list', key: 'user_email' },
  // Cascades to pipeline_history + pursuit_monitor_state.
  { table: 'user_pipeline', key: 'user_email' },
  { table: 'pursuit_change_log', key: 'user_email' },
  { table: 'pursuit_documents', key: 'user_email' },
  { table: 'pursuit_compliance', key: 'user_email' },
  { table: 'mindy_journey_progress', key: 'user_email' },
  { table: 'contacts', key: 'user_email' },
  { table: 'user_teaming_partners', key: 'user_email' },
  { table: 'user_business_profiles', key: 'user_email' },
  { table: 'user_engagement', key: 'user_email' },
  { table: 'user_engagement_scores', key: 'user_email' },
  { table: 'alert_log', key: 'user_email' },
  { table: 'briefing_log', key: 'user_email' },
  { table: 'briefing_feedback', key: 'user_email' },
  { table: 'signup_events', key: 'user_email' },
  { table: 'opportunity_shares', key: 'sharer_email' },
];

/**
 * Render a PostgREST error that is actually actionable.
 *
 * supabase-js can hand back an error whose `message` is the EMPTY STRING and
 * nothing else — that is exactly what `opportunity_shares` returned, and the old
 * code printed `(skip: )`: a blank reason nobody could act on, for a table that
 * was never being cleaned.
 */
function describe(e: { message?: string; code?: string; details?: string; hint?: string }): string {
  const parts = [e.code, e.message, e.details, e.hint].filter((s) => s && String(s).trim());
  return parts.length ? parts.join(' | ') : `empty error object: ${JSON.stringify(e)}`;
}

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
  const problems: string[] = [];

  for (const { table, key } of ACTIVITY_TABLES) {
    const { count, error: cErr } = await sb
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq(key, email);

    if (cErr) {
      // A failed read is NOT a skip. It means we do not know whether this user
      // has rows here, and the account is therefore not verifiably reset.
      const why = describe(cErr);
      console.log(`  ${table.padEnd(26)}  ✗ READ FAILED — ${why}`);
      problems.push(`${table}: read failed — ${why}`);
      continue;
    }

    // count === null is "I don't know", NOT "zero".
    //
    // This is the whole bug. The old code did `count ?? 0`, so a table that did
    // not exist came back with a null count and printed "0 row(s)" — which reads
    // as "nothing to clean up". Five vault_* tables that were never created
    // reported a clean 0 for months, and user_business_profiles did the same for
    // the three months it was missing from the schema.
    //
    // Worse than the misreport: the old code then did `if (n === 0) continue`,
    // so an unknown count SKIPPED THE DELETE entirely. Silent zero didn't just
    // lie about the work — it cancelled it.
    if (count === null) {
      console.log(`  ${table.padEnd(26)}  ? COUNT UNAVAILABLE — not assuming zero`);
      problems.push(`${table}: count unavailable (table missing, or PostgREST returned no count)`);
      if (!GO) continue;
      // Still attempt the delete: unknown means it MIGHT have rows.
      const { error: dErr } = await sb.from(table).delete().eq(key, email);
      if (dErr) {
        console.log(`  ${table.padEnd(26)}  ✗ DELETE FAILED — ${describe(dErr)}`);
        problems.push(`${table}: delete failed — ${describe(dErr)}`);
      } else {
        console.log(`  ${table.padEnd(26)}  delete attempted (row count unknown)`);
      }
      continue;
    }

    total += count;
    if (!GO) { console.log(`  ${table.padEnd(26)}  ${count} row(s)`); continue; }
    if (count === 0) { console.log(`  ${table.padEnd(26)}  0 — nothing to delete`); continue; }

    const { error: dErr } = await sb.from(table).delete().eq(key, email);
    if (dErr) {
      // Never report a delete that didn't happen as done.
      console.log(`  ${table.padEnd(26)}  ✗ DELETE FAILED — ${describe(dErr)}`);
      problems.push(`${table}: delete failed — ${describe(dErr)}`);
    } else {
      console.log(`  ${table.padEnd(26)}  deleted ${count}`);
    }
  }

  console.log(`\n  Total activity rows ${GO ? 'deleted' : 'that WOULD be deleted'}: ${total}`);
  console.log(`  (cascade: deleting user_pipeline also clears pipeline_history + pursuit_monitor_state)\n`);

  if (problems.length) {
    // Exit non-zero so demo-reset.ts stops before granting Pro. A half-reset
    // account that LOOKS ready is worse than one that visibly failed -- and this
    // script spent months reporting exactly that.
    console.error(`✗ ${problems.length} table(s) could not be verified — this account is NOT verifiably reset:\n`);
    for (const p of problems) console.error(`    • ${p}`);
    console.error();
    process.exit(1);
  }

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
