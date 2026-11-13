/**
 * Materialize the compact /forecasts summary into KV. Offline job.
 *
 * WHY THIS IS A JOB AND NOT A PAGE QUERY
 * --------------------------------------
 * /forecasts used to page the whole `agency_forecasts` table on the request
 * path — ~36,000 rows over ~36 round-trips per regeneration, and a SECOND time
 * for `generateMetadata`. This moves that work offline and leaves the page a
 * single small KV read.
 *
 * PostgREST aggregates are disabled on this project ("Use of aggregate
 * functions is not allowed"), so grouping cannot be pushed into the database
 * from the client. This job therefore still reads rows — but it is bounded,
 * runs off the request path, selects only the six columns it groups on, and
 * marks its output `truncated` if it could not see everything.
 *
 * COST: **Supabase only. Zero BigQuery.**
 *
 * TRUNCATION IS THE POINT
 * -----------------------
 * `total` comes from an authoritative `count: 'exact', head: true` query, NOT
 * from the number of rows transferred. If those two disagree, or the row cap is
 * hit, the summary is written with `truncated: true` — and the page then treats
 * it as unavailable and noindexes rather than publishing counts that understate
 * reality. A wrong number is worse than no number.
 *
 * USAGE
 *   npx tsx scripts/build-forecast-summary.ts            # dry run (default)
 *   npx tsx scripts/build-forecast-summary.ts --go       # write to KV
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { kv } from '@vercel/kv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { FORECAST_SUMMARY_KEY } from '../src/lib/seo/forecasts-summary';
import { buildForecastSummary, FORECAST_SUMMARY_TTL_SECONDS } from '../src/lib/seo/forecast-summary-builder';

function sb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// The build itself lives in src/lib/seo/forecast-summary-builder.ts, shared with the scheduled
// materializer (/api/cron/seo-materialize). This script remains for manual dry runs.
async function main() {
  const go = process.argv.includes('--go');
  const db = sb();
  if (!db) {
    console.error('No Supabase credentials in env.');
    process.exit(1);
  }
  console.log(`\n${go ? 'BUILDING' : 'DRY RUN —'} /forecasts summary (Supabase only, zero BigQuery)\n`);
  const summary = await buildForecastSummary(db, (m) => console.log(`  ${m}`));

  const bytes = Buffer.byteLength(JSON.stringify(summary), 'utf8');
  console.log(`\nsummary size       : ${(bytes / 1024).toFixed(1)} kB`);
  console.log(`truncated          : ${summary.truncated}`);
  console.log(`agencies/naics/fy  : ${summary.agencies.length}/${summary.naics.length}/${summary.fiscalYears.length}`);
  console.log(`lastSynced         : ${summary.lastSynced ?? '—'}`);
  if (summary.truncated) {
    console.log('\n⚠️  TRUNCATED: not written. /forecasts would refuse it anyway. Fix the read first.\n');
    return;
  }
  if (!go) {
    console.log('\nDRY RUN — nothing written. Re-run with --go to materialize.\n');
    return;
  }
  await kv.set(FORECAST_SUMMARY_KEY, summary, { ex: FORECAST_SUMMARY_TTL_SECONDS });
  console.log(`\n✓ written to ${FORECAST_SUMMARY_KEY} (ttl ${FORECAST_SUMMARY_TTL_SECONDS}s)\n`);
}

main().catch((e) => {
  console.error('\nbuild-forecast-summary failed:', e);
  process.exit(1);
});
