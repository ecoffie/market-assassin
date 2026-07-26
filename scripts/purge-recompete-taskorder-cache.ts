#!/usr/bin/env npx tsx
/**
 * Purge the POISONED recompete task-order response cache.
 *
 * WHY: during the 2026-07-26 BigQuery quota outage, degraded task-order lookups returned
 * `[]`, and `withCache` cached those empties for 7 days (the `fresh !== null` guard let a
 * truthy empty array through — now fixed in src/lib/mcp/external-cache.ts). So the recompete
 * map re-drain read cached empties instead of re-querying BQ and never recovered real cities.
 * Deleting the `recompete:task-orders` cache forces every re-drain lookup to fetch fresh from
 * a now-healthy BQ. REVERSIBLE: the cache simply regenerates on the next query.
 *
 * SCOPE: only `api_type = 'recompete:task-orders'`. All other cache (pricing/EDGAR/Federal
 * Register) is a different api_type and is LEFT INTACT.
 *
 *   npx tsx scripts/purge-recompete-taskorder-cache.ts         # DRY: count only
 *   npx tsx scripts/purge-recompete-taskorder-cache.ts --go    # delete (batched)
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const GO = process.argv.includes('--go');
const API_TYPE = 'recompete:task-orders';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const { count, error } = await db
    .from('mcp_external_cache')
    .select('cache_key', { count: 'exact', head: true })
    .eq('api_type', API_TYPE);
  if (error) { console.error('count failed:', error.message); process.exit(1); }
  console.log(`recompete:task-orders cache entries: ${count ?? 'unknown'}`);

  if (!GO) {
    console.log('\nDRY RUN. Re-run with --go to delete (batched). Other api_types untouched.');
    return;
  }

  // Batch the delete: a single DELETE across ~24.5K rows risks the statement timeout, and
  // PostgREST caps affected rows. Pull a slice of cache_keys, delete by .in(), repeat.
  const BATCH = 200; // cache_keys are 32-char md5 → keep the .in() URL well under the limit
  let total = 0;
  for (;;) {
    const { data: slice, error: selErr } = await db
      .from('mcp_external_cache')
      .select('cache_key')
      .eq('api_type', API_TYPE)
      .limit(BATCH);
    if (selErr) { console.error('select failed:', selErr.message); process.exit(1); }
    if (!slice || slice.length === 0) break;
    const keys = slice.map((r: { cache_key: string }) => r.cache_key);
    const { error: delErr } = await db.from('mcp_external_cache').delete().in('cache_key', keys);
    if (delErr) { console.error('delete failed:', delErr.message); process.exit(1); }
    total += keys.length;
    console.log(`  deleted ${total}…`);
    if (slice.length < BATCH) break;
  }
  console.log(`\n✅ Purged ${total} recompete:task-orders cache entries. Re-drain will now fetch fresh from BQ.`);

  const { count: after } = await db
    .from('mcp_external_cache')
    .select('cache_key', { count: 'exact', head: true })
    .eq('api_type', API_TYPE);
  console.log(`Remaining recompete:task-orders entries: ${after ?? 'unknown'} (expected 0).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
