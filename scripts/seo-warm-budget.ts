/**
 * Quantify the contractor warm BEFORE anything is executed.
 *
 * Answers, with measurements rather than estimates:
 *   1. exact number of sitemap-advertised contractor roots
 *   2. cached / serveable count
 *   3. missing count
 *   4. bytes scanned per warm batch
 *   5. projected cost and quota usage for completing coverage
 *   6. safe batch size and full-cycle duration
 *
 * COST OF RUNNING THIS SCRIPT: zero BigQuery bytes. It reads the live sitemap
 * over HTTP, reads KV (cache reads, not warehouse reads), and uses BigQuery
 * DRY RUNS, which bill nothing and consume no quota. It never executes a query.
 *
 * Run:  npx tsx scripts/seo-warm-budget.ts [--batch 2000]
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { kv } from '@vercel/kv';
import { bqDryRun } from '../src/lib/bigquery/client';
import { DATA_VERSION } from '../src/lib/bigquery/cache';
import { CONTRACTOR_WARM_LIMITS } from '../src/lib/seo/warm-limits';
import { ROLLUP_BY_SLUG_SQL, CANONICAL_SLUG_SQL, normalizeCompanyName } from '../src/lib/bigquery/recipients';

const SITE = 'https://getmindy.ai';
/** BigQuery on-demand analysis pricing, USD per TiB scanned (public list price). */
const USD_PER_TIB = 6.25;

function gib(bytes: number) {
  return bytes / 1024 ** 3;
}

async function sitemapContractorRoots(): Promise<string[]> {
  const xml = await fetch(`${SITE}/sitemap.xml`).then((r) => r.text());
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const roots = new Set<string>();
  let tabs = 0;
  for (const u of locs) {
    const m = u.match(/\/contractors\/([^/]+)(\/.*)?$/);
    if (!m) continue;
    if (m[2]) tabs++;
    else roots.add(m[1]);
  }
  console.log(`  sitemap URLs total          : ${locs.length.toLocaleString()}`);
  console.log(`  contractor ROOT urls        : ${roots.size.toLocaleString()}`);
  console.log(`  contractor TAB urls         : ${tabs.toLocaleString()}`);
  return [...roots];
}

/** KV reads only. Batched with mget so this is ~12 round-trips, not 12,000. */
async function cachedCount(slugs: string[]): Promise<number> {
  const KEYS_PER_MGET = 200;
  let hits = 0;
  for (let i = 0; i < slugs.length; i += KEYS_PER_MGET) {
    const part = slugs.slice(i, i + KEYS_PER_MGET);
    const keys = part.map((s) => `bq:${DATA_VERSION}:rollup:by-slug:${s}:v2-merged`);
    try {
      const vals = await kv.mget<unknown[]>(...keys);
      for (const v of vals) if (Array.isArray(v) ? v.length > 0 : v != null) hits++;
    } catch (e) {
      console.error(`  mget failed at offset ${i}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return hits;
}

async function main() {
  const batchArg = process.argv.indexOf('--batch');
  const batch = batchArg !== -1 ? Number(process.argv[batchArg + 1]) : CONTRACTOR_WARM_LIMITS.slugsPerScan;

  console.log('\n══ CONTRACTOR WARM BUDGET — measured, nothing executed ══\n');

  console.log('1) SITEMAP POPULATION');
  const roots = await sitemapContractorRoots();

  console.log('\n2) CACHE COVERAGE (KV reads only)');
  const cached = await cachedCount(roots);
  const missing = roots.length - cached;
  const pct = roots.length ? ((cached / roots.length) * 100).toFixed(1) : '0.0';
  console.log(`  cached / serveable          : ${cached.toLocaleString()} (${pct}%)`);
  console.log(`  missing                     : ${missing.toLocaleString()}`);

  console.log(`\n3) BYTES PER WARM BATCH (BigQuery DRY RUN, batch=${batch}, 0 bytes billed)`);
  const sample = roots.slice(0, batch);
  const norm = sample.map(normalizeCompanyName);
  const rollup = await bqDryRun({ query: ROLLUP_BY_SLUG_SQL, params: { slugs: sample } });
  const alias = await bqDryRun({
    query: CANONICAL_SLUG_SQL,
    params: { slugs: sample, normSlugs: norm },
  });
  console.log(`  scan 1 rollup-by-slug       : ${gib(rollup.bytesProcessed).toFixed(3)} GiB`);
  console.log(`  scan 2 canonical-slug       : ${gib(alias.bytesProcessed).toFixed(3)} GiB`);
  const perBatch = rollup.bytesProcessed + alias.bytesProcessed;
  console.log(`  per batch (both scans)      : ${gib(perBatch).toFixed(3)} GiB`);

  console.log('\n4) FULL-COVERAGE PROJECTION');
  const batches = Math.max(1, Math.ceil(missing / batch));
  const totalBytes = perBatch * batches;
  const tib = totalBytes / 1024 ** 4;
  console.log(`  batches to cover missing    : ${batches}`);
  console.log(`  total bytes scanned         : ${gib(totalBytes).toFixed(2)} GiB`);
  console.log(`  projected cost @ $${USD_PER_TIB}/TiB   : $${(tib * USD_PER_TIB).toFixed(2)}`);

  console.log('\n5) LIMITS THIS WARMER WILL ENFORCE');
  for (const [k, v] of Object.entries(CONTRACTOR_WARM_LIMITS)) {
    console.log(`  ${k.padEnd(26)}: ${typeof v === 'number' && v > 1024 ** 2 ? `${gib(v).toFixed(1)} GiB` : v}`);
  }

  const dailyBudget = CONTRACTOR_WARM_LIMITS.dailyScanBudgetBytes;
  const batchesPerDay = Math.max(1, Math.floor(dailyBudget / perBatch));
  const days = Math.ceil(batches / batchesPerDay);
  console.log('\n6) SAFE CADENCE');
  console.log(`  batches allowed per day     : ${batchesPerDay}`);
  console.log(`  days to full coverage       : ${days}`);
  console.log(
    `  per-run ceiling             : ${CONTRACTOR_WARM_LIMITS.maxRecordsPerRun.toLocaleString()} records / ` +
      `${gib(CONTRACTOR_WARM_LIMITS.maxBytesPerRun).toFixed(1)} GiB / ${CONTRACTOR_WARM_LIMITS.maxRuntimeMs / 1000}s`,
  );

  if (perBatch > CONTRACTOR_WARM_LIMITS.maxBytesPerScan) {
    console.log(
      `\n  ⚠️  A batch of ${batch} exceeds maxBytesPerScan ` +
        `(${gib(CONTRACTOR_WARM_LIMITS.maxBytesPerScan).toFixed(1)} GiB). Reduce --batch.`,
    );
  }
  console.log('\nNothing was executed. No bytes were billed.\n');
}

main().catch((e) => {
  console.error('budget report failed:', e);
  process.exit(1);
});
