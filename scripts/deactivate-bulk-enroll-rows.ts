/**
 * Deactivate never-engaged rows from the one-time bootcamp bulk enrollment.
 *
 * WHY
 * ---
 * 8,802 rows in user_notification_settings carry invitation_source =
 * 'bootcamp-batch-enroll'. They were inserted by two bulk pushes (2026-04-30 and
 * 2026-05-05); the people behind them never signed up. Across the whole cohort there
 * are ZERO searches and ZERO clicks.
 *
 * Every one of them has is_active = true, so any count keyed on is_active inherits the
 * contamination — admin dashboards, the throughput digest's denominators, and the
 * profile-reminder audience all read high. Two consumers have already been patched
 * around this (PR #881, PR #904); this fixes the source instead.
 *
 * DEACTIVATE, NEVER DELETE. Flipping is_active is reversible and preserves the record
 * that these people were enrolled. The rollback is the same query with active=true and
 * the emails from the report file.
 *
 * TWO TRAPS THIS SCRIPT EXISTS TO AVOID
 * -------------------------------------
 * 1. engagement_score = 50 on all 8,079 never-engaged rows. It looks like a signal.
 *    It is a hardcoded default. Using it as an activity test would "prove" every row
 *    is an active user.
 *
 * 2. jagomez55@aol.com is inside the never-engaged set with $835 spend, 5 charges and
 *    an ACTIVE SUBSCRIPTION. A filter keyed only on activity would deactivate a live
 *    paying customer. Money is checked independently of engagement, in both this
 *    table and customer_classifications.
 *
 * RESULT OF THE 2026-08-04 RUN
 * ----------------------------
 *   cohort 8,802 → deactivated 7,862, kept 830 (723 engaged + 115 commercial, less
 *   the 8 of those already inactive). System-wide is_active dropped 10,176 → 2,319.
 *
 *   The number that proves the filter was right: alerts_enabled AND is_active went
 *   1,857 → 1,858. The real alerting audience did not lose a single user.
 *
 *   The commercial check excluded 115 paying customers holding $137,903 in spend,
 *   201 charges and 18 active subscriptions — every one of them with ZERO engagement
 *   signals. They bought and never opened an alert. An activity-only filter would
 *   have deactivated all 115.
 *
 * USAGE
 * -----
 *   npx tsx scripts/deactivate-bulk-enroll-rows.ts            # dry run (default)
 *   npx tsx scripts/deactivate-bulk-enroll-rows.ts --go       # perform the write
 *
 * Dry run is the default and --go is the only way to write. The script prints the
 * exact count, the filter definition and sample rows either way, and always writes a
 * JSON report of every affected email so the change can be undone.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const BULK_SOURCE = 'bootcamp-batch-enroll';
const CHUNK = 500;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

type Row = {
  user_email: string;
  is_active: boolean | null;
  alerts_enabled: boolean | null;
  briefings_enabled: boolean | null;
  total_alerts_sent: number | null;
  search_count: number | null;
  last_click_at: string | null;
  alerts_opened_30d: number | null;
  paid_status: string | null;
  stripe_customer_id: string | null;
  products_owned: string[] | null;
  created_at: string;
};

/** PostgREST caps un-ranged selects at 1,000 rows and reports no error. */
async function fetchAll(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('user_notification_settings')
      .select('user_email, is_active, alerts_enabled, briefings_enabled, total_alerts_sent, search_count, last_click_at, alerts_opened_30d, paid_status, stripe_customer_id, products_owned, created_at')
      .eq('invitation_source', BULK_SOURCE)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as Row[]));
    if (data.length < 1000) break;
  }
  return out;
}

/** Any sign a human was ever behind this row. Deliberately generous. */
function hasEngaged(u: Row): boolean {
  return u.alerts_enabled === true
    || u.briefings_enabled === true
    || (u.total_alerts_sent ?? 0) > 0
    || (u.search_count ?? 0) > 0
    || (u.alerts_opened_30d ?? 0) > 0
    || !!u.last_click_at;
  // NOTE: engagement_score is NOT consulted — it is 50 for every row in this cohort.
}

/** Any sign of money. Checked separately: a customer who never opened an alert is
 *  still a customer. jagomez55@aol.com is exactly this case. */
function hasCommercialTies(u: Row, paidEmails: Set<string>): boolean {
  return !!u.stripe_customer_id
    || (!!u.paid_status && u.paid_status !== 'free')
    || (u.products_owned?.length ?? 0) > 0
    || paidEmails.has(u.user_email.toLowerCase());
}

async function main() {
  const go = process.argv.includes('--go');
  console.log(`\n${go ? '*** LIVE RUN — THIS WRITES ***' : 'DRY RUN (pass --go to write)'}\n`);

  // Anyone with real spend or an active subscription, from the billing table.
  const paidEmails = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('customer_classifications')
      .select('email, total_spend, charge_count, has_active_subscription')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) {
      if ((r.total_spend ?? 0) > 0 || (r.charge_count ?? 0) > 0 || r.has_active_subscription) {
        paidEmails.add(String(r.email).toLowerCase());
      }
    }
    if (data.length < 1000) break;
  }

  const all = await fetchAll();
  const engaged = all.filter(hasEngaged);
  const neverEngaged = all.filter(u => !hasEngaged(u));
  const commercial = neverEngaged.filter(u => hasCommercialTies(u, paidEmails));
  const alreadyInactive = neverEngaged.filter(u => !u.is_active && !hasCommercialTies(u, paidEmails));
  const targets = neverEngaged.filter(u => u.is_active && !hasCommercialTies(u, paidEmails));

  console.log('FILTER  invitation_source = %s', BULK_SOURCE);
  console.log('        AND is_active = true');
  console.log('        AND no alerts_enabled / briefings_enabled / alerts sent / searches / clicks / opens');
  console.log('        AND no stripe_customer_id / paid_status / products_owned / billing history\n');
  console.log('  cohort total          :', all.length);
  console.log('  ever engaged (KEPT)   :', engaged.length);
  console.log('  commercial ties (KEPT):', commercial.length,
    commercial.length ? `→ ${commercial.map(c => c.user_email).join(', ')}` : '');
  console.log('  already inactive      :', alreadyInactive.length);
  console.log('  >>> WILL DEACTIVATE   :', targets.length, '\n');

  const dates: Record<string, number> = {};
  for (const t of targets) {
    const d = String(t.created_at).slice(0, 10);
    dates[d] = (dates[d] || 0) + 1;
  }
  console.log('  created dates         :', JSON.stringify(dates));
  console.log('  sample rows           :');
  for (const t of targets.slice(0, 5)) {
    console.log(`    ${t.user_email.padEnd(38)} created=${String(t.created_at).slice(0, 10)} alerts_sent=${t.total_alerts_sent ?? 0} searches=${t.search_count ?? 0}`);
  }

  // Always write the report — a dry run's list IS the rollback list for the live run.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = `/tmp/deactivate-bulk-enroll-${stamp}.json`;
  writeFileSync(reportPath, JSON.stringify({
    filter: { invitation_source: BULK_SOURCE, is_active: true, neverEngaged: true, noCommercialTies: true },
    counts: { cohort: all.length, engaged: engaged.length, commercial: commercial.length, alreadyInactive: alreadyInactive.length, targets: targets.length },
    keptForCommercialTies: commercial.map(c => c.user_email),
    emails: targets.map(t => t.user_email),
  }, null, 2));
  console.log(`\n  report written        : ${reportPath}`);
  console.log('  rollback              : set is_active=true for the emails in that file\n');

  if (!go) {
    console.log('Dry run complete. Nothing was written. Re-run with --go to apply.\n');
    return;
  }

  let done = 0;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const batch = targets.slice(i, i + CHUNK).map(t => t.user_email);
    const { error } = await sb
      .from('user_notification_settings')
      .update({ is_active: false })
      .in('user_email', batch);
    if (error) {
      console.error(`\nFAILED after ${done} rows: ${error.message}`);
      console.error('Earlier chunks are committed. The report file lists every intended email.');
      process.exit(1);
    }
    done += batch.length;
    console.log(`  deactivated ${done}/${targets.length}`);
  }

  // Verify against the DB rather than trusting the loop counter.
  const { count: remaining } = await sb
    .from('user_notification_settings')
    .select('*', { count: 'exact', head: true })
    .eq('invitation_source', BULK_SOURCE)
    .eq('is_active', true);
  // Expectation must exclude rows that were ALREADY inactive, or the check reports a
  // phantom discrepancy. The 2026-08-04 run printed "830, expected 838" and cost a
  // detour proving the write was fine — 8 of the kept rows had been inactive since July.
  const expectedActive = engaged.filter(u => u.is_active).length
    + commercial.filter(u => u.is_active).length;
  console.log(`\n  DONE. ${done} rows deactivated.`);
  console.log(`  still active in cohort: ${remaining} (expected ${expectedActive})`);
  if (remaining !== expectedActive) {
    console.warn('  ⚠️  MISMATCH — investigate before trusting this run.\n');
  } else {
    console.log('  ✓ matches\n');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
