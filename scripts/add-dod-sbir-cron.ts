/**
 * One-off: register the sync-dod-sbir cron_jobs row (Eric #6, 2026-07-28).
 * Route is already deployed + verified 200 on prod (CLAUDE.md #5 order satisfied). The dispatcher
 * fires it; it drains DoD SBIR topics into dod_sbir_topics, backing off harmlessly while sbir.gov's
 * API is rate-limited/under maintenance, self-filling when it recovers. Idempotent (upsert on job_name).
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env.local' });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const row = {
    job_name: 'sync-dod-sbir',
    // :50 so it doesn't collide with the cert backfill at :40. Dispatcher ticks ~hourly.
    cron_expr: '50 * * * *',
    route: '/api/cron/sync-dod-sbir?mode=execute&scope=open&budgetMs=120000',
    enabled: 'true',
    timeout_ms: 180000,
  };
  const { error } = await sb.from('cron_jobs').upsert(row, { onConflict: 'job_name' });
  if (error) { console.error('INSERT failed:', error.message); process.exit(1); }
  const { data, error: readErr } = await sb.from('cron_jobs').select('job_name, cron_expr, route, enabled').eq('job_name', 'sync-dod-sbir').single();
  if (readErr) { console.error('verify read failed:', readErr.message); process.exit(1); }
  console.log('✓ cron row registered:', JSON.stringify(data, null, 2));
}
main();
