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
import {
  FORECAST_SUMMARY_KEY,
  FORECAST_SUMMARY_VERSION,
  type StoredForecastSummary,
  type Tally,
} from '../src/lib/seo/forecasts-summary';

const PAGE = 1000;
/** Hard ceiling. Exceeding it sets `truncated` rather than silently undercounting. */
const MAX_ROWS = 80_000;
/** TTL comfortably longer than the page's staleness window, so KV never expires first. */
const TTL_SECONDS = 30 * 24 * 60 * 60;

function sb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

interface Row {
  source_agency: string | null;
  bureau: string | null;
  naics_code: string | null;
  naics_description: string | null;
  fiscal_year: string | null;
  set_aside_type: string | null;
  source_type: string | null;
  last_synced_at: string | null;
}

function tally(
  rows: Row[],
  keyOf: (r: Row) => string | null,
  labelOf: (r: Row) => string | null,
  limit: number,
): Tally[] {
  const m = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const cur = m.get(k);
    if (cur) cur.count++;
    else m.set(k, { label: labelOf(r) || k, count: 1 });
  }
  return [...m.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

async function main() {
  const go = process.argv.includes('--go');
  const db = sb();
  if (!db) {
    console.error('No Supabase credentials in env.');
    process.exit(1);
  }

  console.log(`\n${go ? 'BUILDING' : 'DRY RUN —'} /forecasts summary (Supabase only, zero BigQuery)\n`);

  // Authoritative total, independent of what we manage to transfer.
  const { count, error: countErr } = await db
    .from('agency_forecasts')
    .select('*', { count: 'exact', head: true });
  if (countErr || count == null) {
    console.error('count failed:', countErr?.message ?? 'no count returned');
    process.exit(1);
  }
  console.log(`authoritative total: ${count.toLocaleString()}`);

  const rows: Row[] = [];
  let truncated = false;
  for (let from = 0; ; from += PAGE) {
    if (from >= MAX_ROWS) {
      truncated = true;
      console.error(`  ! hit MAX_ROWS=${MAX_ROWS} — marking truncated`);
      break;
    }
    const { data, error } = await db
      .from('agency_forecasts')
      .select(
        'source_agency, bureau, naics_code, naics_description, fiscal_year, set_aside_type, source_type, last_synced_at',
      )
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`  ! read failed at offset ${from}: ${error.message} — marking truncated`);
      truncated = true;
      break;
    }
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  console.log(`rows transferred   : ${rows.length.toLocaleString()}`);

  // The decisive check: did we actually see everything the table says exists?
  if (rows.length !== count) {
    truncated = true;
    console.error(
      `  ! transferred ${rows.length} but table reports ${count} — marking truncated`,
    );
  }

  let lastSynced: string | null = null;
  for (const r of rows) {
    if (r.last_synced_at && (!lastSynced || r.last_synced_at > lastSynced)) {
      lastSynced = r.last_synced_at;
    }
  }

  const summary: StoredForecastSummary = {
    version: FORECAST_SUMMARY_VERSION,
    builtAt: new Date().toISOString(),
    total: count,
    truncated,
    agencies: tally(rows, (r) => r.bureau || r.source_agency, (r) => r.bureau || r.source_agency, 40),
    naics: tally(rows, (r) => r.naics_code, (r) => r.naics_description || r.naics_code, 25),
    fiscalYears: tally(rows, (r) => r.fiscal_year, (r) => r.fiscal_year, 8),
    setAsides: tally(rows, (r) => r.set_aside_type, (r) => r.set_aside_type, 12),
    sources: tally(rows, (r) => r.source_type, (r) => r.source_type, 8),
    lastSynced,
  };

  const bytes = Buffer.byteLength(JSON.stringify(summary), 'utf8');
  console.log(`\nsummary size       : ${(bytes / 1024).toFixed(1)} kB`);
  console.log(`truncated          : ${truncated}`);
  console.log(`agencies/naics/fy  : ${summary.agencies.length}/${summary.naics.length}/${summary.fiscalYears.length}`);
  console.log(`lastSynced         : ${lastSynced ?? '—'}`);

  if (truncated) {
    console.log(
      '\n⚠️  This summary is TRUNCATED. If written, /forecasts will treat it as\n' +
        '    unavailable and noindex — deliberately. Fix the read before relying on it.',
    );
  }

  if (!go) {
    console.log('\nDRY RUN — nothing written. Re-run with --go to materialize.\n');
    return;
  }

  await kv.set(FORECAST_SUMMARY_KEY, summary, { ex: TTL_SECONDS });
  console.log(`\n✓ written to ${FORECAST_SUMMARY_KEY} (ttl ${TTL_SECONDS}s)`);
  console.log('  /forecasts picks it up on its next ISR regeneration (revalidate 86400),');
  console.log('  or immediately on the next deploy.\n');
}

main().catch((e) => {
  console.error('\nbuild-forecast-summary failed:', e);
  process.exit(1);
});
