/**
 * One-time: schedule the two semantic-embedding drain crons via the dispatcher
 * (cron_jobs rows — NOT vercel.json, per CLAUDE.md rule #5). These were orphaned:
 * the routes existed but nothing fired them, so the SOW corpus + user capability
 * vectors silently went stale → hidden-match matched ~nobody (the documented
 * "enabled 3 days, ~0 matches"). Config-row INSERT via service role (rule #6
 * allows this programmatically; only DDL is hand-run).
 *
 * Dispatcher ticks HOURLY (0 * * * *) — sub-hour exprs effectively fire once/hour
 * (memory: dispatcher_is_hourly), so we use hourly, which is what these drains want.
 *
 * Run: npx tsx scripts/schedule-embed-crons.ts
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const JOBS = [
  {
    job_name: 'embed-sow-corpus',
    route: '/api/cron/embed-sow-corpus?limit=150',
    cron_expr: '0 * * * *', // hourly (dispatcher is hourly)
    timeout_ms: 120000,
    notes: 'Hourly SOW-corpus embedding drain (sow_text → sow_embedding). Feeds semantic hidden-match. Scheduled 2026-06-18 (was orphaned).',
  },
  {
    job_name: 'embed-user-capabilities',
    route: '/api/cron/embed-user-capabilities?mode=execute&limit=100',
    cron_expr: '0 * * * *', // hourly
    timeout_ms: 60000,
    notes: 'Hourly per-user capability-vector embedding drain (user_identity_profile.capability_embedding). Powers semantic hidden-match. Scheduled 2026-06-18 (was orphaned).',
  },
];

async function main() {
  for (const job of JOBS) {
    // Upsert by job_name so re-runs are idempotent (matches the seed's ON CONFLICT DO NOTHING intent,
    // but we WANT to update route/expr/notes if they changed).
    const { error } = await supabase
      .from('cron_jobs')
      .upsert({ ...job, enabled: true, updated_at: new Date().toISOString() }, { onConflict: 'job_name' });
    console.log(error ? `❌ ${job.job_name}: ${error.message}` : `✅ ${job.job_name} → ${job.route} (${job.cron_expr})`);
  }

  // Read back the two rows to confirm.
  const { data } = await supabase
    .from('cron_jobs')
    .select('job_name, route, cron_expr, enabled, last_run_at')
    .in('job_name', JOBS.map((j) => j.job_name));
  console.log('\nConfirmed rows:');
  console.table(data);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
