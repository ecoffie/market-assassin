/**
 * Registers the weekly SEO report as a dispatcher cron_jobs row.
 *
 * Why a row and not vercel.json: Mindy is AT the 100-cron Vercel cap;
 * the dispatcher exists to add logical jobs without new vercel.json crons.
 *
 * Schedule: "0 13 * * 1" (Mondays 13:00 UTC = 9am ET). The dispatcher's
 * hourly tick (0 * * * *) lands on minute 0 of hour 13, so this fires.
 *
 * Run: npx tsx scripts/insert-seo-report-cron.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env not set');
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const row = {
    job_name: 'seo-report',
    route: '/api/cron/seo-report',
    cron_expr: '0 13 * * 1', // Mondays 09:00 ET — hits the hourly tick at minute 0
    enabled: true,
    timeout_ms: 60000,
    notes: 'Weekly GSC SEO report -> Slack. Added 2026-06-12. Needs SEO_SLACK_CHANNEL env + SA on getmindy.ai GSC property.',
  };

  // Upsert on the unique job_name so re-running is idempotent.
  const { data, error } = await sb
    .from('cron_jobs')
    .upsert(row, { onConflict: 'job_name' })
    .select('id, job_name, route, cron_expr, enabled');

  if (error) throw new Error(`upsert failed: ${error.message}`);
  console.log('✅ cron_jobs row registered:');
  console.log(JSON.stringify(data, null, 2));

  // Read back to confirm it's queryable by the dispatcher's filter.
  const { data: check } = await sb
    .from('cron_jobs')
    .select('job_name, cron_expr, enabled')
    .eq('job_name', 'seo-report')
    .single();
  console.log('\nReadback:', JSON.stringify(check));
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
