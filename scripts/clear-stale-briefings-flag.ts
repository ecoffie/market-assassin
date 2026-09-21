/**
 * Turn off briefings_enabled for users whose briefings entitlement is expired,
 * missing, or was never an entitling tier.
 *
 * WHY
 * ---
 * 779 profiles carry briefings_enabled = true. Only 115 have a live entitlement.
 * The flag was set when the beta_preview trial was handed out and never cleared when
 * the trial ended, so it now claims 779 people want briefings when 115 can receive
 * them.
 *
 * THIS CHANGES NOTHING ABOUT WHO RECEIVES BRIEFINGS. The cron already gates on
 * customer_classifications, so these 655 have been getting nothing regardless — that
 * is exactly why nobody noticed. What it fixes is the flag lying: every count keyed on
 * briefings_enabled reads ~7x high, including the admin dashboard and the throughput
 * digest's orphan check (which is what surfaced this).
 *
 * THE 9 PAYING CUSTOMERS — DELIBERATELY EXCLUDED
 * ----------------------------------------------
 * 9 users in the turn-off set have spend, charges or an active subscription but an
 * expired/missing briefings entitlement. That is a business question, not a data
 * error: either their access lapsed legitimately, or billing and entitlement drifted
 * apart. Eric's call (2026-08-04): leave them enabled and report them for review.
 *
 * Two of them hold an EXPIRED 1_year — genuine former subscribers whose term ended.
 * Turning those off is a renewal conversation, not a cleanup.
 *
 * RESULT OF THE 2026-08-04 RUN
 * ----------------------------
 *   briefings_enabled 779 → 124 (655 cleared)
 *   kept: 115 live entitlement + 9 paid-but-lapsed
 *   verification matched exactly (124 expected, 124 found)
 *
 *   The number that proves it was safe: the RECEIVING audience — enabled AND active
 *   AND live entitlement — stayed at 113, exactly where it was before the write.
 *   Dashboard briefingsEnabled dropped 773 → 123 while cronEligible held at 110 and
 *   briefings.sent held at 114.
 *
 * USAGE
 * -----
 *   npx tsx scripts/clear-stale-briefings-flag.ts          # dry run (default)
 *   npx tsx scripts/clear-stale-briefings-flag.ts --go     # perform the write
 *
 * Writes a JSON report of every affected email before any write. Rollback is
 * briefings_enabled = true for that list; nothing is deleted.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

/** Tiers the briefing cron treats as entitling. Mirrors the dashboard + digest. */
const ENTITLING = new Set(['lifetime', '1_year', '6_month', 'subscription', 'beta_preview']);
/** Of those, the ones that represent money rather than a free trial. */
const PAID_TIERS = new Set(['lifetime', '1_year', '6_month', 'subscription']);
const CHUNK = 500;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

type Classification = {
  email: string;
  briefings_access: string | null;
  briefings_expiry: string | null;
  total_spend: number | null;
  charge_count: number | null;
  has_active_subscription: boolean | null;
};

/** PostgREST caps un-ranged selects at 1,000 rows and reports no error. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const hasPaid = (c?: Classification) =>
  !!c && ((c.total_spend ?? 0) > 0 || (c.charge_count ?? 0) > 0 || c.has_active_subscription === true);

async function main() {
  const go = process.argv.includes('--go');
  console.log(`\n${go ? '*** LIVE RUN — THIS WRITES ***' : 'DRY RUN (pass --go to write)'}\n`);

  const classifications = await fetchAll<Classification>((from, to) => sb
    .from('customer_classifications')
    .select('email, briefings_access, briefings_expiry, total_spend, charge_count, has_active_subscription')
    .range(from, to));
  const byEmail = new Map(classifications.map(c => [String(c.email).toLowerCase(), c]));

  const enabled = await fetchAll<{ user_email: string; is_active: boolean | null }>((from, to) => sb
    .from('user_notification_settings')
    .select('user_email, is_active')
    .eq('briefings_enabled', true)
    .range(from, to));

  const now = Date.now();
  const keep: string[] = [];
  const targets: string[] = [];
  const flaggedPayers: Array<{ email: string; access: string | null; expiry: string | null; spendUsd: number; charges: number; activeSub: boolean }> = [];
  const reasons: Record<string, number> = { expired: 0, noRow: 0, notEntitling: 0 };

  for (const u of enabled) {
    const email = String(u.user_email).toLowerCase();
    const c = byEmail.get(email);

    let stale: keyof typeof reasons | null = null;
    if (!c) stale = 'noRow';
    else if (!ENTITLING.has(c.briefings_access || '')) stale = 'notEntitling';
    else if (c.briefings_expiry && new Date(c.briefings_expiry).getTime() <= now) stale = 'expired';

    if (!stale) { keep.push(u.user_email); continue; }

    // Money overrides a lapsed entitlement — surfaced, never silently cut.
    if (hasPaid(c)) {
      flaggedPayers.push({
        email: u.user_email,
        access: c?.briefings_access ?? null,
        expiry: c?.briefings_expiry ?? null,
        spendUsd: (c?.total_spend ?? 0) / 100,
        charges: c?.charge_count ?? 0,
        activeSub: c?.has_active_subscription === true,
      });
      continue;
    }
    reasons[stale]++;
    targets.push(u.user_email);
  }

  const livePaid = keep.filter(e => PAID_TIERS.has(byEmail.get(e.toLowerCase())?.briefings_access || '')).length;

  console.log('FILTER  briefings_enabled = true');
  console.log('        AND entitlement is expired, missing, or not an entitling tier');
  console.log('        AND no spend / charges / active subscription\n');
  console.log('  briefings_enabled = true :', enabled.length);
  console.log('  KEEP — live entitlement  :', keep.length, `(paid ${livePaid}, beta_preview ${keep.length - livePaid})`);
  console.log('  KEEP — paid but lapsed   :', flaggedPayers.length, '  <-- for your review, NOT touched');
  console.log('  >>> WILL TURN OFF        :', targets.length);
  console.log('        expired entitlement:', reasons.expired);
  console.log('        no classification  :', reasons.noRow);
  console.log('        not an entitling tier:', reasons.notEntitling, '\n');

  if (flaggedPayers.length) {
    console.log('  PAID BUT LAPSED — decide separately (restore access, or let it stand):');
    for (const p of flaggedPayers) {
      console.log(`    ${p.email.padEnd(36)} $${String(p.spendUsd).padStart(8)} charges=${p.charges} sub=${p.activeSub} tier=${p.access ?? 'none'} expired=${String(p.expiry).slice(0, 10)}`);
    }
    console.log();
  }

  console.log('  sample to turn off:');
  for (const t of targets.slice(0, 5)) console.log('   ', t);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = `/tmp/clear-stale-briefings-${stamp}.json`;
  writeFileSync(reportPath, JSON.stringify({
    filter: 'briefings_enabled=true AND entitlement expired/missing/non-entitling AND no money',
    counts: { enabled: enabled.length, keep: keep.length, flaggedPayers: flaggedPayers.length, targets: targets.length, reasons },
    flaggedPayers,
    emails: targets,
  }, null, 2));
  console.log(`\n  report written : ${reportPath}`);
  console.log('  rollback       : set briefings_enabled=true for the emails in that file\n');

  if (!go) {
    console.log('Dry run complete. Nothing was written. Re-run with --go to apply.\n');
    return;
  }

  let done = 0;
  for (let i = 0; i < targets.length; i += CHUNK) {
    const batch = targets.slice(i, i + CHUNK);
    const { error } = await sb
      .from('user_notification_settings')
      .update({ briefings_enabled: false })
      .in('user_email', batch);
    if (error) {
      console.error(`\nFAILED after ${done} rows: ${error.message}`);
      console.error('Earlier chunks are committed. The report lists every intended email.');
      process.exit(1);
    }
    done += batch.length;
    console.log(`  turned off ${done}/${targets.length}`);
  }

  // Verify against the DB, not the loop counter. Expectation must count only rows
  // that were enabled to begin with — see the phantom "830 vs 838" in the bulk-enroll
  // cleanup, where an unadjusted expectation cost a detour proving a clean write.
  const { count: remaining } = await sb
    .from('user_notification_settings')
    .select('*', { count: 'exact', head: true })
    .eq('briefings_enabled', true);
  const expected = keep.length + flaggedPayers.length;
  console.log(`\n  DONE. ${done} flags cleared.`);
  console.log(`  briefings_enabled still true: ${remaining} (expected ${expected})`);
  console.log(remaining === expected ? '  ✓ matches\n' : '  ⚠️  MISMATCH — investigate before trusting this run.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
