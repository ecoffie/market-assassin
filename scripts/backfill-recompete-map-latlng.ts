#!/usr/bin/env npx tsx
/**
 * Backfill recompete_opportunities.map_lat/map_lng with the contract's REAL
 * place-of-performance city, recovered from its TASK ORDERS — fixing the map
 * pile-up at state centroids.
 *
 * MEASURED (2026-07-26): 0 of 134,162 recompete_opportunities rows (quality_flag IS
 * NULL) carry a place_of_performance_city — SAM/USASpending's contract-level record
 * never had one, so every stored map_lat/map_lng today is a pure STATE-CENTROID +
 * jitter (the "ring" bug — e.g. 500 MO rows cluster around ~9 points near dead-center
 * Missouri, never St. Louis/KC). But each contract's TASK ORDERS carry a real
 * pop_city ~97% of the time (see docs/strategy/PRD-recompete-task-order-spend.md).
 *
 * This reuses the SHARED, PROVEN-SAFE `getTaskOrders()` (src/lib/recompete/task-orders.ts)
 * — do NOT re-derive the BigQuery join. That lib already scopes by
 * `recipient_uei = @uei AND (piid = @piid OR parent_piid = @piid)`, which is the ONLY
 * safe join key (a bare piid match over-matches: PIID "0002" alone pulls 64,016
 * txns/$28.7B/11,207 unrelated recipients — see that file's header). It also already
 * geocodes each task-order transaction via the shared geocodeCity().
 *
 * Dominant-city selection: among a contract's grounded task-order txns, group by
 * (city,state) and pick the group with the LARGEST total obligation (a "most money
 * moved here" signal beats raw txn count when a contract has a HQ processing office
 * plus a small satellite site — the money should point at the real work location).
 * Ties broken by most-recent action_date. Only txns that resolved to city precision
 * are considered (never re-use a task-order's OWN state-centroid fallback — that
 * would just move the same approximation around instead of fixing it).
 *
 * Resumable: WHERE map_loc_source IS NULL is the work queue (partial index in the
 * migration). Every processed row gets stamped map_loc_source EITHER
 * 'task_order_city' (real city recovered) OR 'state_approx' (no task-order city
 * found — map_lat/map_lng LEFT AS-IS, the existing honest state-centroid; NEVER
 * fabricated). Re-running only touches unstamped rows.
 *
 * BigQuery cost: each contract's task-order lookup is a UEI+PIID-scoped query,
 * clustered on recipient_uei — measured ~460MB/query in task-orders.ts's own header
 * (~$0.003 at $6.25/TB). getTaskOrders() also caches the raw BQ result 7 days in
 * mcp_external_cache, so a re-run within a week of a prior backfill pass is free.
 * Concurrency-pooled + a per-record timeout so one hung BQ call can't stall a worker.
 *
 *   npx tsx scripts/backfill-recompete-map-latlng.ts               # DRY (counts + sample)
 *   npx tsx scripts/backfill-recompete-map-latlng.ts --go          # write, default 500
 *   npx tsx scripts/backfill-recompete-map-latlng.ts --go --limit 3000 --concurrency 10
 *
 * ⚠️ This is a ~134K-row bulk write — get explicit sign-off on scope before --go.
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getTaskOrders, type TaskOrderTxn } from '../src/lib/recompete/task-orders';
import { geocodeCity, stableSeed } from '../src/lib/geo/city-geocode';

const GO = process.argv.includes('--go');
const arg = (f: string, d: number) => { const i = process.argv.indexOf(f); return i >= 0 ? parseInt(process.argv[i + 1], 10) || d : d; };
const LIMIT = arg('--limit', 500);
const CONCURRENCY = arg('--concurrency', 8);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const COLS = 'contract_id, piid, incumbent_uei, place_of_performance_state';

// Per-record timeout so one hanging BigQuery call can't stall a pool worker
// (bulk-job non-negotiable: Promise.race, ~30s).
function withTimeout<T>(p: Promise<T>, ms = 30000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

export interface DominantCity {
  city: string;
  state: string; // normalized 2-letter code
  totalObligation: number;
  mostRecentDate: string | null;
}

/**
 * Pick the contract's real work location from its grounded task-order stream:
 * group txns by (city,state), sum obligation per group, return the group with the
 * LARGEST total obligation (ties broken by most-recent action_date). Txns with no
 * resolvable city (locPrecision !== 'city') are excluded — we only trust a REAL
 * city hit, never a task-order's own state-centroid fallback.
 *
 * Returns null when no txn has a real city (the caller falls back to state_approx).
 */
export function pickDominantCity(txns: TaskOrderTxn[]): DominantCity | null {
  const groups = new Map<string, { city: string; state: string; total: number; mostRecent: string | null }>();
  for (const t of txns) {
    if (t.locPrecision !== 'city' || !t.popCity || !t.popState) continue;
    const key = `${t.popCity.toUpperCase()}|${t.popState.toUpperCase()}`;
    const g = groups.get(key) || { city: t.popCity, state: t.popState, total: 0, mostRecent: null as string | null };
    g.total += t.obligation || 0;
    if (t.actionDate && (!g.mostRecent || t.actionDate > g.mostRecent)) g.mostRecent = t.actionDate;
    groups.set(key, g);
  }
  if (groups.size === 0) return null;
  const ranked = [...groups.values()].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return (b.mostRecent || '').localeCompare(a.mostRecent || '');
  });
  const top = ranked[0];
  return { city: top.city, state: top.state, totalObligation: top.total, mostRecentDate: top.mostRecent };
}

interface Row {
  contract_id: string;
  piid: string | null;
  incumbent_uei: string | null;
  place_of_performance_state: string | null;
}

interface ProcessResult {
  contractId: string;
  outcome: 'task_order_city' | 'state_approx';
  lat?: number;
  lng?: number;
  city?: string;
  state?: string;
}

/** Pure per-row logic — the shared core the drain script (and any future cron) reuses. */
export async function resolveRecompeteMapLoc(row: Row): Promise<ProcessResult> {
  const result = await getTaskOrders({ piid: row.piid, incumbentUei: row.incumbent_uei });
  if (!result.grounded) {
    return { contractId: row.contract_id, outcome: 'state_approx' };
  }
  const dominant = pickDominantCity(result.txns);
  if (!dominant) {
    return { contractId: row.contract_id, outcome: 'state_approx' };
  }
  const geo = geocodeCity(dominant.city, dominant.state, stableSeed(row.contract_id));
  if (!geo || geo.precision !== 'city') {
    // Shouldn't happen (the dominant city already resolved to 'city' precision
    // inside getTaskOrders' own geocode pass) but guard rather than ever write a
    // fabricated coordinate.
    return { contractId: row.contract_id, outcome: 'state_approx' };
  }
  return {
    contractId: row.contract_id,
    outcome: 'task_order_city',
    lat: geo.lat, lng: geo.lng,
    city: dominant.city, state: dominant.state,
  };
}

async function printDrySample(columnExists: boolean) {
  let q = db.from('recompete_opportunities')
    .select('contract_id, incumbent_name, piid, incumbent_uei, place_of_performance_state, map_lat, map_lng')
    .is('quality_flag', null)
    .not('incumbent_uei', 'is', null)
    .order('potential_total_value', { ascending: false, nullsFirst: false })
    .limit(8);
  if (columnExists) q = q.is('map_loc_source', null);
  const { data: sample, error } = await q;
  if (error) { console.error('sample error:', error.message); return; }
  console.log('\nSample (state-centroid before → real task-order city after), largest contracts first:');
  let shown = 0;
  for (const r of sample || []) {
    if (shown >= 5) break;
    const res = await resolveRecompeteMapLoc(r as Row);
    if (res.outcome !== 'task_order_city') continue;
    shown++;
    console.log(`  ${r.incumbent_name} (${r.piid}) — ${r.place_of_performance_state}`);
    console.log(`    before: (${r.map_lat}, ${r.map_lng}) [state]  →  after: (${res.lat}, ${res.lng}) [${res.city}, ${res.state}]`);
  }
  if (shown === 0) console.log('  (none of the sampled rows had a task-order city — try a larger --limit sample)');
}

/**
 * `map_loc_source` may not exist yet (migration 20260726_recompete_map_loc_source.sql
 * is hand-run in Supabase — this DB has no in-app DDL). DRY mode must still work
 * pre-migration so Eric can see the real numbers before running it; only --go
 * actually needs the column (to stamp progress) and fails loudly if it's missing.
 */
async function hasLocSourceColumn(): Promise<boolean> {
  const { error } = await db.from('recompete_opportunities').select('map_loc_source').limit(1);
  return !error;
}

async function main() {
  const columnExists = await hasLocSourceColumn();
  if (!columnExists) {
    console.log('⚠️  map_loc_source column not found — run supabase/migrations/20260726_recompete_map_loc_source.sql in Supabase first.');
    if (GO) { console.error('Cannot --go without the column (nothing to stamp progress against). Exiting.'); process.exit(1); }
  }

  const baseCountQ = db.from('recompete_opportunities').select('contract_id', { count: 'exact', head: true }).is('quality_flag', null);
  const { count: remaining, error: countErr } = columnExists
    ? await baseCountQ.is('map_loc_source', null)
    : await baseCountQ; // pre-migration: "remaining" = the whole clean table (nothing stamped yet)
  if (countErr) { console.error('count error:', countErr.message); process.exit(1); }
  console.log(`Recompete contracts not yet processed for real-city recovery: ${remaining ?? 'unknown'}`);

  if (!GO) {
    await printDrySample(columnExists);
    console.log(`\nDRY RUN. Re-run with --go (limit ${LIMIT}, concurrency ${CONCURRENCY}) to write.`);
    return;
  }

  const { data: rows, error } = await db.from('recompete_opportunities')
    .select(COLS)
    .is('quality_flag', null).is('map_loc_source', null)
    .not('incumbent_uei', 'is', null)
    .order('contract_id', { ascending: true })
    .limit(LIMIT);
  if (error) throw error;
  const batch = (rows || []) as Row[];
  console.log(`Processing ${batch.length} this run…`);

  let done = 0, realCity = 0, stateApprox = 0, failed = 0;
  const queue = [...batch];
  async function worker() {
    while (queue.length) {
      const r = queue.shift()!;
      try {
        const res = await withTimeout(resolveRecompeteMapLoc(r));
        if (res.outcome === 'task_order_city' && res.lat != null && res.lng != null) {
          const { error: upErr } = await db.from('recompete_opportunities')
            .update({ map_lat: res.lat, map_lng: res.lng, map_loc_source: 'task_order_city' })
            .eq('contract_id', r.contract_id);
          if (upErr) throw upErr;
          realCity++;
        } else {
          // Leave map_lat/map_lng untouched (the existing honest state-centroid) —
          // only stamp provenance so the resumable cursor moves past this row.
          const { error: upErr } = await db.from('recompete_opportunities')
            .update({ map_loc_source: 'state_approx' })
            .eq('contract_id', r.contract_id);
          if (upErr) throw upErr;
          stateApprox++;
        }
        done++;
        if (done % 25 === 0) console.log(`  ${done}/${batch.length} (${realCity} real city, ${stateApprox} state-approx)`);
      } catch (e) {
        failed++;
        console.error(`  ✗ ${r.contract_id}: ${e instanceof Error ? e.message : e} (will retry — not stamped)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n✅ ${done} processed (${realCity} real task-order city, ${stateApprox} state-approx), ${failed} failed. Re-run to continue.`);
}

// Only auto-run when invoked directly (`npx tsx scripts/...`) — guards against
// firing (and process.exit'ing) when this module is imported for unit tests
// (pickDominantCity / resolveRecompeteMapLoc are exported for that purpose).
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
