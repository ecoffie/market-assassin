/**
 * Cron migration Phase 1 — move the 37 non-send batch-window/maintenance crons off
 * vercel.json onto the dispatcher (cron_jobs rows). 100 → ~63 native crons.
 *
 * SAFE: touches NO email-send jobs (daily/weekly/pursuit alerts + sends stay native).
 * Rule #5: dispatcher rows, not vercel.json. Rule #6: config-row upsert via service role.
 *
 * Dispatcher gotchas honored:
 *  - minute MUST be :00 (dispatcher only ticks at :00 hourly / :05 daily). All exprs
 *    below use minute 0. Non-:00 originals (check-briefing-health :30, check-fms :45,
 *    window :30 entries) are shifted to :00 — harmless for these jobs, and isMissed()
 *    catch-up covers a skipped tick.
 *  - multi-schedule windows collapse to ONE row at the window-start hour; the job is
 *    resumable (returns remaining/templatesRemaining) so the dispatcher re-fires it.
 *  - query-param variants (snapshot-multisite?source=, sync-sam?type=) are DISTINCT
 *    jobs → one row each (different job_name + route).
 *
 * DRY_RUN=1 (default) prints the plan. DRY_RUN=0 writes.
 * Does NOT edit vercel.json — that's a separate manual/edit step AFTER these rows are
 * confirmed firing (so there's never a gap where a job runs nowhere).
 */
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const DRY = process.env.DRY_RUN !== '0';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// job_name, route (with query preserved), cron_expr (minute :00), timeout_ms, notes
const ROWS: Array<{ job_name: string; route: string; cron_expr: string; timeout_ms: number; notes: string }> = [
  { job_name: 'backfill-sam-attachments', route: '/api/cron/backfill-sam-attachments', cron_expr: '0 5 * * *', timeout_ms: 120000, notes: 'Daily SAM attachment backfill. Migrated from vercel.json 2026-06-19.' },
  { job_name: 'backfill-sam-descriptions', route: '/api/cron/backfill-sam-descriptions', cron_expr: '0 3 * * *', timeout_ms: 120000, notes: 'SAM description backfill (was 03:00+15:00; resumable, re-fired until drained). Migrated 2026-06-19.' },
  { job_name: 'bootcamp-rollout', route: '/api/cron/bootcamp-rollout?limit=2000', cron_expr: '0 17 * * *', timeout_ms: 120000, notes: 'Daily bootcamp rollout (limit=2000). Migrated 2026-06-19.' },
  { job_name: 'briefing-watchdog', route: '/api/cron/briefing-watchdog', cron_expr: '0 9 * * *', timeout_ms: 60000, notes: 'Briefing self-heal watchdog (was 09:00+09:30). Migrated 2026-06-19.' },
  { job_name: 'check-alert-throughput', route: '/api/cron/check-alert-throughput', cron_expr: '0 14 * * *', timeout_ms: 60000, notes: 'Daily alert-throughput regression check. Migrated 2026-06-19.' },
  { job_name: 'check-briefing-health', route: '/api/cron/check-briefing-health?email=true', cron_expr: '0 12 * * *', timeout_ms: 60000, notes: 'Daily briefing health email (was 12:30). Migrated 2026-06-19.' },
  { job_name: 'check-fms-health', route: '/api/cron/check-fms-health?email=true', cron_expr: '0 12 * * *', timeout_ms: 60000, notes: 'Daily FMS health email (was 12:45). Migrated 2026-06-19.' },
  { job_name: 'check-provider-health', route: '/api/cron/check-provider-health', cron_expr: '0 */6 * * *', timeout_ms: 60000, notes: 'Provider health every 6h (minute 0 — dispatcher-reachable). Migrated 2026-06-19.' },
  { job_name: 'extract-sam-events', route: '/api/cron/extract-sam-events', cron_expr: '0 7 * * *', timeout_ms: 120000, notes: 'Daily SAM events extraction. Migrated 2026-06-19.' },
  { job_name: 'manage-briefing-rollout', route: '/api/cron/manage-briefing-rollout', cron_expr: '0 12 * * *', timeout_ms: 60000, notes: 'Daily briefing rollout cohort management. Migrated 2026-06-19.' },
  { job_name: 'precompute-briefings', route: '/api/cron/precompute-briefings', cron_expr: '0 2 * * *', timeout_ms: 120000, notes: 'Daily briefing precompute (was 02:00-04:00 window; resumable via templatesRemaining). Migrated 2026-06-19.' },
  { job_name: 'precompute-weekly-briefings', route: '/api/cron/precompute-weekly-briefings', cron_expr: '0 20 * * 4', timeout_ms: 120000, notes: 'Thu weekly precompute (was 20:00-22:00 window; resumable). Migrated 2026-06-19.' },
  { job_name: 'precompute-pursuit-briefs', route: '/api/cron/precompute-pursuit-briefs', cron_expr: '0 20 * * 5', timeout_ms: 120000, notes: 'Fri pursuit precompute (was 20:00-22:00 window; resumable). Migrated 2026-06-19.' },
  { job_name: 'refresh-contracts', route: '/api/cron/refresh-contracts', cron_expr: '0 23 * * 0', timeout_ms: 120000, notes: 'Sun contracts refresh. Migrated 2026-06-19.' },
  { job_name: 'sam-sync-watchdog', route: '/api/cron/sam-sync-watchdog', cron_expr: '0 15 * * *', timeout_ms: 60000, notes: 'Daily SAM sync watchdog. Migrated 2026-06-19.' },
  { job_name: 'snapshot-multisite-darpa', route: '/api/cron/snapshot-multisite?source=darpa_baa', cron_expr: '0 5 * * *', timeout_ms: 120000, notes: 'DARPA BAA multisite snapshot. Migrated 2026-06-19.' },
  { job_name: 'snapshot-multisite-nih', route: '/api/cron/snapshot-multisite?source=nih_reporter', cron_expr: '0 4 * * *', timeout_ms: 120000, notes: 'NIH RePORTER multisite snapshot. Migrated 2026-06-19.' },
  { job_name: 'snapshot-multisite-nsf', route: '/api/cron/snapshot-multisite?source=nsf_sbir', cron_expr: '0 6 * * *', timeout_ms: 120000, notes: 'NSF SBIR multisite snapshot. Migrated 2026-06-19.' },
  { job_name: 'sync-sam-opportunities-full', route: '/api/cron/sync-sam-opportunities', cron_expr: '0 1 * * *', timeout_ms: 290000, notes: 'Daily full SAM sync. Migrated 2026-06-19.' },
  { job_name: 'sync-sam-opportunities-delta', route: '/api/cron/sync-sam-opportunities?type=delta', cron_expr: '0 13 * * *', timeout_ms: 290000, notes: 'Midday SAM delta sync. Migrated 2026-06-19.' },
  { job_name: 'sync-sam-opportunities-resume', route: '/api/cron/sync-sam-opportunities?type=resume', cron_expr: '0 9 * * *', timeout_ms: 290000, notes: 'SAM sync resume pass. Migrated 2026-06-19.' },
  { job_name: 'sync-usaspending-awards', route: '/api/cron/sync-usaspending-awards', cron_expr: '0 4 * * 0', timeout_ms: 290000, notes: 'Sun USASpending awards sync. Migrated 2026-06-19.' },
  { job_name: 'weekly-digest', route: '/api/planner/weekly-digest', cron_expr: '0 14 * * 1', timeout_ms: 120000, notes: 'Mon planner weekly digest. Migrated 2026-06-19.' },
];

async function main() {
  console.log(`${DRY ? '[DRY RUN]' : 'EXECUTING'} — Phase-1 cron migration: ${ROWS.length} dispatcher rows\n`);
  // Safety: confirm none collide with an existing row that points at a DIFFERENT route.
  const { data: existing } = await sb.from('cron_jobs').select('job_name,route');
  const exMap = new Map((existing || []).map((r: { job_name: string; route: string }) => [r.job_name, r.route]));
  for (const r of ROWS) {
    const clash = exMap.get(r.job_name);
    if (clash && clash !== r.route) { console.log(`  ⚠️ COLLISION ${r.job_name}: existing route ${clash} ≠ new ${r.route} — SKIP, resolve manually`); continue; }
    if (DRY) { console.log(`  would upsert  ${r.job_name.padEnd(32)} "${r.cron_expr}"  ${r.route}`); continue; }
    const { error } = await sb.from('cron_jobs').upsert({ ...r, enabled: true, updated_at: new Date().toISOString() }, { onConflict: 'job_name' });
    console.log(error ? `  ❌ ${r.job_name}: ${error.message}` : `  ✅ ${r.job_name}`);
  }
  if (!DRY) {
    const { count } = await sb.from('cron_jobs').select('*', { count: 'exact', head: true });
    console.log(`\n  cron_jobs total rows now: ${count}`);
    console.log('  NEXT: confirm these fire (watch cron_job_runs 24-48h), THEN remove their entries from vercel.json.');
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
