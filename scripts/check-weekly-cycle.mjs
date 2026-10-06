#!/usr/bin/env node
/**
 * Weekly-alert cycle funnel — read-only. Did every eligible weekly user get evaluated?
 *
 * Written for PR #1854 (weekly drain, 2026-10-06). Before it, every cycle stopped at
 * exactly 750 users in email order (~"j"); the rest never got a weekly alert.
 *
 *   node scripts/check-weekly-cycle.mjs              # most recent cycle with rows
 *   node scripts/check-weekly-cycle.mjs 2026-10-11   # a specific cycle date
 *
 * PASS requires all of:
 *   - the job's last self-reported status is not partial/error (pending = 0)
 *   - every active, alerts-enabled user who CHOSE weekly has a row this cycle
 *   - the cycle is not stuck at the legacy 750 ceiling
 * Exit 0 = PASS, 1 = FAIL, 2 = could not measure (never reported as a pass).
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('✗ missing Supabase env'); process.exit(2); }
const sb = createClient(url, key);

// Paged read (.range inside) — same contract as src/lib/supabase/paged-read.ts readAllRows.
async function readAllRows(build, label) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await build().range(i, i + 999);
    if (error) { console.error(`✗ ${label}: ${error.message}`); process.exit(2); }
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

let cycle = process.argv[2];
if (!cycle) {
  const { data, error } = await sb.from('alert_log').select('alert_date').eq('alert_type', 'weekly').order('alert_date', { ascending: false }).limit(1);
  if (error || !data?.length) { console.error('✗ no weekly cycle found', error?.message || ''); process.exit(2); }
  cycle = data[0].alert_date;
}

// unranged-ok: paged by readAllRows (.range inside the helper)
const rows = await readAllRows(() => sb.from('alert_log').select('user_email,delivery_status,error_message,created_at').eq('alert_date', cycle).eq('alert_type', 'weekly').order('user_email'), 'alert_log');
// unranged-ok: paged by readAllRows (.range inside the helper)
const users = await readAllRows(() => sb.from('user_notification_settings').select('user_email,alert_frequency').eq('is_active', true).eq('alerts_enabled', true).order('user_email'), 'settings');
const { data: jobs, error: jobsErr } = await sb.from('cron_jobs').select('job_name,last_status,last_run_at').in('job_name', ['weekly-alerts', 'weekly-alerts-mon']).limit(10);
if (jobsErr) { console.error('✗ cron_jobs:', jobsErr.message); process.exit(2); }
// unranged-ok: paged by readAllRows (.range inside the helper)
const runs = await readAllRows(() => sb.from('cron_job_runs').select('job_name,started_at,status,error').in('job_name', ['weekly-alerts', 'weekly-alerts-mon']).gte('started_at', cycle).order('started_at'), 'cron_job_runs');

const byStatus = {}, skipReasons = {};
for (const r of rows) {
  byStatus[r.delivery_status] = (byStatus[r.delivery_status] || 0) + 1;
  if (r.delivery_status === 'skipped') skipReasons[r.error_message || '(none)'] = (skipReasons[r.error_message || '(none)'] || 0) + 1;
}
const evaluated = new Set(rows.map((r) => r.user_email.toLowerCase()));
const weekly = users.filter((u) => u.alert_frequency === 'weekly');
const weeklyMissing = weekly.filter((u) => !evaluated.has(u.user_email.toLowerCase()));
const last = [...evaluated].sort().at(-1) || '';
const windows = {};
for (const r of rows) { const w = r.created_at.slice(0, 15) + '0'; windows[w] = (windows[w] || 0) + 1; }
const pendingReports = runs.filter((r) => r.error && /still pending/.test(r.error)).map((r) => `${r.job_name} ${r.started_at.slice(0, 16)}: ${r.error}`);
const lastStatus = Object.fromEntries((jobs || []).map((j) => [j.job_name, j.last_status]));

console.log(`\n  Weekly cycle ${cycle}`);
console.log(`  runs fired (cron_job_runs since cycle date): ${runs.length}`);
console.log(`  rows written per 10-min window: ${Object.entries(windows).map(([w, n]) => `${w.slice(11)}=${n}`).join(' ')}`);
console.log(`  evaluated (alert_log rows): ${rows.length}   ${JSON.stringify(byStatus)}`);
console.log(`  skipped by reason: ${JSON.stringify(skipReasons)}`);
console.log(`  last email evaluated (alphabetical): ${last.slice(0, 3)}…`);
console.log(`  explicit-weekly users (active): ${weekly.length}   without a row this cycle: ${weeklyMissing.length}`);
console.log(`  job last_status: ${JSON.stringify(lastStatus)}`);
if (pendingReports.length) console.log(`  pending reported by runs:\n    ${pendingReports.join('\n    ')}`);

const failures = [];
if (Object.values(lastStatus).some((s) => s === 'partial' || s === 'error')) failures.push('job self-reported partial/error (pending > 0)');
if (weeklyMissing.length) failures.push(`${weeklyMissing.length} explicit-weekly users never evaluated`);
if (rows.length === 750) failures.push('exactly 750 rows — still at the legacy ceiling');
console.log(failures.length ? `\n  ✗ FAIL — ${failures.join('; ')}\n` : `\n  ✓ PASS — pending = 0, every explicit-weekly user evaluated\n`);
process.exit(failures.length ? 1 : 0);
