#!/usr/bin/env node
/**
 * Did the set-aside fix (PR #332) actually drop the daily-alerts zero count?
 *
 * ── The bug it's checking ────────────────────────────────────────────────────
 * `businessTypeToSetAside` mapped 'Small Business' -> 'SBP', which is the PARTIAL
 * Small Business Set-Aside (36 active notices) — not 'SBA', Total Small Business
 * Set-Aside (8,824 active). A 245x error. The filter also had no null branch, so
 * it excluded UNRESTRICTED work (the largest pool) too. Net effect: a user's own
 * certification HID the work reserved for them.
 *
 * info@lcmanagementsolutions.com was skipped daily 07-12 -> 07-17 with
 * "no_new_or_active_opportunities" while her profile matched 145 live
 * opportunities. Fixed + extracted to src/lib/market/set-aside-eligibility.ts;
 * all 5 copies of the map converted.
 *
 * ── Why this is a script and not a memory ───────────────────────────────────
 * It was a session-only scheduled wakeup, which dies when the session does.
 * The check outlives the session that wrote it.
 *
 * Usage:  node scripts/check-zero-alert-drop.mjs
 *         node scripts/check-zero-alert-drop.mjs 2026-07-19   (a specific day)
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ missing Supabase env. Run: vercel env pull .env.local');
  process.exit(1);
}
const sb = createClient(url, key);

/**
 * PRE-FIX BASELINE — measured 2026-07-17, before the fix deployed (~11:30 UTC).
 * Dead flat at ~110/day, which is itself the tell: a genuinely thin market would
 * fluctuate with SAM's posting volume; a broken filter returns the same zero
 * every single day.
 */
const BASELINE = [
  { date: '2026-07-14', processed: 1551, noOpps: 102 },
  { date: '2026-07-15', processed: 1572, noOpps: 111 },
  { date: '2026-07-16', processed: 1577, noOpps: 108 },
  { date: '2026-07-17', processed: 1599, noOpps: 116 }, // last PRE-fix day
];

/**
 * The falsifiable prediction. 308 users were affected (257 business_type=
 * 'Small Business' + 51 slug variants like 'small-business'/'women-owned'), out
 * of 1,723 alert-enabled. Not all were in the noOpps bucket — many matched
 * SOMETHING despite the filter.
 *
 * If the set-aside bug was the main driver, ~110 should fall to roughly 20-40.
 * If it barely moves, the diagnosis was INCOMPLETE — say so. The remaining zeros
 * would then be a different cause (likely genuinely narrow profiles or
 * placeholder NAICS, which the zero-alert-nudge cron already targets).
 */
const PREDICTION = { low: 20, high: 40 };

const count = async (filters) => {
  let q = sb.from('alert_log').select('id', { count: 'exact', head: true }).eq('alert_type', 'daily');
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  // null = UNKNOWN, never 0 — the whole reason this codebase has rule #11.
  if (n === null || n === undefined) throw new Error('count came back null (table missing?) — NOT zero');
  return n;
};

const target = process.argv[2] || new Date(Date.now() - 86400_000).toISOString().split('T')[0];

(async () => {
  console.log(`\n  Zero-alert check — did PR #332 drop the noOpps count?\n`);
  console.log(`  ${'date'.padEnd(12)} ${'processed'.padStart(10)} ${'noOpps'.padStart(7)} ${'pct'.padStart(5)}`);
  for (const b of BASELINE) {
    console.log(`  ${b.date.padEnd(12)} ${String(b.processed).padStart(10)} ${String(b.noOpps).padStart(7)} ${String(Math.round((100 * b.noOpps) / b.processed)).padStart(4)}%   (pre-fix)`);
  }

  const processed = await count({ alert_date: target });
  if (processed === 0) {
    console.log(`\n  ${target}: NO ROWS YET — the batch may still be draining (the cron starts ~11:00 UTC`);
    console.log(`  and takes ~7 dispatcher passes to clear ~1,700 users). This is NOT a result.\n`);
    process.exit(0);
  }
  const noOpps = await count({ alert_date: target, error_message: 'no_new_or_active_opportunities' });
  const pct = Math.round((100 * noOpps) / processed);
  console.log(`  ${target.padEnd(12)} ${String(processed).padStart(10)} ${String(noOpps).padStart(7)} ${String(pct).padStart(4)}%   <- POST-FIX`);

  const dropped = BASELINE.at(-1).noOpps - noOpps;
  console.log(`\n  ${dropped >= 0 ? 'Dropped' : 'ROSE'} by ${Math.abs(dropped)} vs the last pre-fix day (${BASELINE.at(-1).noOpps}).`);
  if (noOpps <= PREDICTION.high) {
    console.log(`  ✓ Within the predicted ${PREDICTION.low}-${PREDICTION.high}. The set-aside bug was the main driver.`);
  } else if (dropped > 20) {
    console.log(`  ~ Moved, but above the predicted ${PREDICTION.low}-${PREDICTION.high}. Partly it; something else remains.`);
  } else {
    console.log(`  ✗ Barely moved. The diagnosis was INCOMPLETE — do not explain this away.`);
    console.log(`    Remaining zeros are a different cause: likely narrow profiles or placeholder`);
    console.log(`    NAICS (the zero-alert-nudge cron already targets those).`);
  }

  // The reported user — must send NATURALLY, not via the forced send of 2026-07-17.
  // Bind `error`. The pre-push gate caught this exact line ignoring it — a
  // swallowed-error read, in the script written to catch silent zeros. A renamed
  // column would null the WHOLE query and print "she has no rows", which reads
  // identically to "she wasn't sent an alert". Caught only because #311 unblinded
  // scripts/ this morning; before today it would have shipped.
  const { data: her, error: herErr } = await sb
    .from('alert_log')
    .select('alert_date, opportunities_count, delivery_status, sent_at, error_message')
    .eq('user_email', 'info@lcmanagementsolutions.com')
    .order('alert_date', { ascending: false })
    .limit(3);
  if (herErr) throw new Error(`her alert_log lookup failed: ${herErr.message}`);
  console.log(`\n  info@lcmanagementsolutions.com — skipped daily 07-12 -> 07-17, forced send 07-17 11:36 UTC:`);
  for (const r of her ?? []) {
    console.log(`    ${r.alert_date}  count=${String(r.opportunities_count).padStart(3)}  ${String(r.delivery_status).padEnd(8)} ${r.error_message || ''}`);
  }
  console.log();
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
