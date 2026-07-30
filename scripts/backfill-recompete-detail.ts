#!/usr/bin/env npx tsx
/**
 * MINDY-007 remainder — backfill recompete_opportunities.psc_code / psc_description /
 * description from USASpending's AWARD-DETAIL endpoint.
 *
 * WHY: USASpending's spending_by_award SEARCH endpoint (the recompete sync's source)
 * returns "NAICS Description" / "Product or Service Code" / "Award Description" as NULL
 * even when requested (verified live 2026-07-30 — same class as its NULL set-aside).
 * So all 132,693 live rows (quality_flag IS NULL) carry psc_code / psc_description /
 * description = NULL. The per-award DETAIL endpoint (/api/v2/awards/<id>/) DOES have
 * them (verified: 1305M325P0015 → psc 6640 "LABORATORY EQUIPMENT…", desc "KINGFISHER
 * APEX INSTRUMENT(S)…"). naics_description is already DERIVED for free at query time
 * (src/lib/recompete/query.ts + /api/recompete), so this backfill is only about the
 * three the code can't derive.
 *
 * REUSE, don't rebuild: the fetch + field extraction is the SHARED, proven
 * `fetchAwardDetail(generatedId)` (src/lib/usaspending/award-detail.ts). Our
 * `contract_id` column IS the generated_internal_id it wants
 * (e.g. "CONT_AWD_1305M325P0015_1330_-NONE-_-NONE-"). Do NOT re-derive the detail
 * parse — that lib already normalizes psc_hierarchy / naics_hierarchy / description.
 *
 * THROUGHPUT (measured 2026-07-30): the detail endpoint is ~470ms/req and plateaus at
 * ~10 req/s (latency-bound; concurrency 5 and 10 both ~10/s, 0×429). So 132,693 rows
 * ≈ ~3.7h at 10/s, ~4.6h at a politer 8. Free public API, no key, $0.
 *
 * RESUMABLE: WHERE detail_checked_at IS NULL is the work queue (partial index in the
 * migration 20260730_recompete_detail_checked_at.sql — hand-run, this DB has no in-app
 * DDL). Every processed row is STAMPED detail_checked_at whether or not the endpoint
 * had data, so a genuine-empty isn't re-fetched forever. Re-running only touches
 * unstamped rows.
 *
 * ⚠️ FAIL-LOUD CONTRACT (the silent-degradation class this repo has been bitten by
 * twice): a TRANSIENT fetch failure (5xx / timeout / network / 429) is NOT the same as
 * "this award genuinely has no psc/description". A throw LEAVES THE ROW NULL + counts
 * `failed` (the resumable cursor retries it next run); a successful fetch that simply
 * returned empty fields stamps detail_checked_at with whatever was there (often the
 * fields ARE present — FPDS requires them on awards). An errored fetch must NEVER be
 * stamped as done — that would permanently skip a row that actually has data.
 *
 * ⚠️ NULL BYTES: Postgres text columns reject . description is free text from
 * FPDS — strip NUL before writing (bulk-job non-negotiable #7).
 *
 *   npx tsx scripts/backfill-recompete-detail.ts                 # DRY (counts + 5-row sample proof)
 *   npx tsx scripts/backfill-recompete-detail.ts --go            # write, default 500
 *   npx tsx scripts/backfill-recompete-detail.ts --go --limit 5000 --concurrency 5
 *
 * ⚠️ This is a ~132K-row bulk write — get explicit sign-off on scope before --go.
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAwardDetail } from '../src/lib/usaspending/award-detail';

const GO = process.argv.includes('--go');
const arg = (f: string, d: number) => { const i = process.argv.indexOf(f); return i >= 0 ? parseInt(process.argv[i + 1], 10) || d : d; };
const LIMIT = arg('--limit', 500);
// 5 is the measured sweet spot — the endpoint plateaus at ~10 req/s regardless, so
// higher concurrency just risks 429s without going faster.
const CONCURRENCY = arg('--concurrency', 5);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const TABLE = 'recompete_opportunities';

/** Postgres rejects NUL in text columns — strip it from FPDS free text before writing. */
function stripNul(s: string | null | undefined): string | null {
  if (s == null) return null;
  const cleaned = s.replace(/\x00/g, '').trim();
  return cleaned.length ? cleaned : null;
}

interface Row {
  contract_id: string;
  piid: string | null;
  naics_code: string | null;
}

interface DetailFields {
  psc_code: string | null;
  psc_description: string | null;
  description: string | null;
}

/** Transient fetch failure (5xx/timeout/network/429) — retry, do NOT stamp. */
class DetailFetchError extends Error {
  constructor(public contractId: string) {
    super(`detail fetch failed for ${contractId} — transient, leaving row NULL for retry`);
    this.name = 'DetailFetchError';
  }
}

/**
 * Pure per-row logic — reuses the shared fetchAwardDetail. Returns the three fields to
 * write (any may be null if the award genuinely lacks it — that's an honest empty, still
 * stamped). Throws DetailFetchError on a transient fetch failure so the worker leaves the
 * row NULL for the next run.
 */
export async function resolveDetailFields(row: Row): Promise<DetailFields> {
  let detail;
  try {
    detail = await fetchAwardDetail(row.contract_id);
  } catch {
    throw new DetailFetchError(row.contract_id);
  }
  // fetchAwardDetail returns null on a NON-2xx / parse failure — that's the transient
  // class here (the id is valid; if it weren't, the sync wouldn't have written the row).
  // Treat null as retry, NOT as a genuine empty, so a 5xx blip doesn't stamp a real row.
  if (!detail) throw new DetailFetchError(row.contract_id);
  return {
    psc_code: stripNul(detail.pscCode) ,
    psc_description: stripNul(detail.pscDescription),
    description: stripNul(detail.description),
  };
}

async function hasCheckedColumn(): Promise<boolean> {
  const { error } = await db.from(TABLE).select('detail_checked_at').limit(1);
  return !error;
}

async function printDrySample(columnExists: boolean) {
  let q = db.from(TABLE)
    .select('contract_id, incumbent_name, piid, naics_code, psc_code, description')
    .is('quality_flag', null)
    .order('potential_total_value', { ascending: false, nullsFirst: false })
    .limit(8);
  if (columnExists) q = q.is('detail_checked_at', null);
  const { data: sample, error } = await q;
  if (error) { console.error('sample error:', error.message); return; }
  console.log('\nSample — the three NULL fields BEFORE → recovered from the detail endpoint AFTER (largest contracts first):');
  let shown = 0;
  for (const r of sample || []) {
    if (shown >= 5) break;
    try {
      const f = await resolveDetailFields(r as Row);
      shown++;
      console.log(`\n  ${r.incumbent_name} (${r.piid}) — NAICS ${r.naics_code}`);
      console.log(`    psc_code       : ${r.psc_code ?? 'NULL'}  →  ${f.psc_code ?? 'NULL'}`);
      console.log(`    psc_description: ${r.description == null ? 'NULL' : ''}${(f.psc_description ?? 'NULL').slice(0, 60)}`);
      console.log(`    description    : ${r.description ?? 'NULL'}  →  ${(f.description ?? 'NULL').slice(0, 70)}`);
    } catch {
      console.log(`  (fetch failed for ${(r as Row).contract_id} — would retry, not stamp)`);
    }
  }
  if (shown === 0) console.log('  (no rows sampled — try a larger --limit)');
}

async function main() {
  const columnExists = await hasCheckedColumn();
  if (!columnExists) {
    console.log('⚠️  detail_checked_at column not found — run supabase/migrations/20260730_recompete_detail_checked_at.sql in Supabase first.');
    if (GO) { console.error('Cannot --go without the column (nothing to stamp progress against). Exiting.'); process.exit(1); }
  }

  const baseCountQ = db.from(TABLE).select('contract_id', { count: 'exact', head: true }).is('quality_flag', null);
  const { count: remaining, error: countErr } = columnExists
    ? await baseCountQ.is('detail_checked_at', null)
    : await baseCountQ;
  if (countErr) { console.error('count error:', countErr.message); process.exit(1); }
  console.log(`Recompete contracts not yet detail-backfilled: ${remaining ?? 'unknown'}`);

  if (!GO) {
    await printDrySample(columnExists);
    console.log(`\nDRY RUN. Nothing written. Re-run with --go (limit ${LIMIT}, concurrency ${CONCURRENCY}) to write.`);
    return;
  }

  const { data: rows, error } = await db.from(TABLE)
    .select('contract_id, piid, naics_code')
    .is('quality_flag', null).is('detail_checked_at', null)
    // Value DESC: fill the biggest/most-visible contracts first, so a partial run is
    // already useful. Resumability holds — each stamped row drops out of the IS NULL filter.
    .order('potential_total_value', { ascending: false, nullsFirst: false })
    .order('contract_id', { ascending: true })
    .limit(LIMIT);
  if (error) throw error;
  const batch = (rows || []) as Row[];
  console.log(`Processing ${batch.length} this run (concurrency ${CONCURRENCY})…`);

  const nowIso = new Date().toISOString();
  let done = 0, withPsc = 0, withDesc = 0, empty = 0, failed = 0;
  const queue = [...batch];
  async function worker() {
    while (queue.length) {
      const r = queue.shift()!;
      try {
        const f = await resolveDetailFields(r);
        const { error: upErr } = await db.from(TABLE)
          .update({
            psc_code: f.psc_code,
            psc_description: f.psc_description,
            description: f.description,
            detail_checked_at: nowIso,
          })
          .eq('contract_id', r.contract_id);
        if (upErr) throw upErr;
        if (f.psc_code) withPsc++;
        if (f.description) withDesc++;
        if (!f.psc_code && !f.description && !f.psc_description) empty++;
        done++;
        if (done % 50 === 0) console.log(`  ${done}/${batch.length} (${withPsc} psc, ${withDesc} desc, ${empty} genuinely-empty)`);
      } catch (e) {
        failed++;
        // Transient fetch/update error → row LEFT NULL for the next run to retry (NOT stamped).
        console.error(`  ✗ ${r.contract_id}: ${e instanceof Error ? e.message : e} (will retry — not stamped)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n✅ ${done} processed (${withPsc} got psc_code, ${withDesc} got description, ${empty} genuinely empty), ${failed} failed. Re-run to continue.`);
  if (failed > 0) {
    const pct = batch.length ? Math.round((failed / batch.length) * 100) : 0;
    console.error(`\n🚨 ${failed}/${batch.length} (${pct}%) rows FAILED a transient fetch — LEFT NULL, not stamped. If high, USASpending may be rate-limiting: lower --concurrency or wait, then re-run.`);
  }
}

// Only auto-run when invoked directly (guards against firing when imported for tests).
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
