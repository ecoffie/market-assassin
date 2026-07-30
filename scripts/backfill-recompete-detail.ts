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
// ⚠️ SUSTAINED-LOAD THROTTLE (measured 2026-07-30): the detail endpoint tolerates a
// short burst at concurrency 5 (~10 req/s) but THROTTLES OUR IP after ~1000 sustained
// requests — it starts dropping connections (RemoteDisconnected / ECONNRESET), and even
// a serial known-good request then fails ~4-in-5. So the full 132K drain must be POLITE:
// low concurrency + a per-request delay + retry-with-backoff (a dropped connection is
// transient — the SAME id usually succeeds after a pause). Defaults tuned for that.
const CONCURRENCY = arg('--concurrency', 2);
const DELAY_MS = arg('--delay', 300);          // pause between a worker's requests
const MAX_RETRIES = arg('--retries', 4);        // per-id retries on a dropped connection

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  // Retry with exponential backoff: a dropped connection (RemoteDisconnected /
  // ECONNRESET) or a transient null from fetchAwardDetail is almost always the IP
  // throttle, and the SAME id succeeds after a short pause. Only after MAX_RETRIES
  // exhausted do we throw (→ row left NULL for a later run). This converts the
  // flaky-drop failures the burst run hit into successes.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s, 2s, 4s
    try {
      const detail = await fetchAwardDetail(row.contract_id);
      if (detail) {
        return {
          psc_code: stripNul(detail.pscCode),
          psc_description: stripNul(detail.pscDescription),
          description: stripNul(detail.description),
        };
      }
      // null = non-2xx / dropped — retry (the id is valid; the sync wrote this row).
      lastErr = new Error('null detail (transient)');
    } catch (e) {
      lastErr = e;
    }
  }
  void lastErr;
  throw new DetailFetchError(row.contract_id);
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

  // DRAIN LOOP. PostgREST hard-caps a .select() at 1000 rows regardless of .limit(),
  // so one fetch never returns the whole table. Page in chunks of ≤1000 and repeat
  // until the work queue is empty OR the --limit budget is spent, so ONE invocation
  // drains fully. The cursor is the IS NULL filter itself (every stamped row drops
  // out), so we always re-fetch the current head — no offset bookkeeping, and a
  // transient-failed row (left NULL) naturally comes back on a later page/run.
  const PAGE = 1000;
  let done = 0, withPsc = 0, withDesc = 0, empty = 0, failed = 0, page = 0;
  const startedAt = Date.now();

  for (;;) {
    const budgetLeft = LIMIT - done;
    if (budgetLeft <= 0) { console.log(`\nReached --limit ${LIMIT}. Stopping (re-run to continue).`); break; }
    const take = Math.min(PAGE, budgetLeft);
    const { data: rows, error } = await db.from(TABLE)
      .select('contract_id, piid, naics_code')
      .is('quality_flag', null).is('detail_checked_at', null)
      // Value DESC: fill the biggest/most-visible contracts first. Resumability holds —
      // each stamped row drops out of the IS NULL filter, so the next page is the next
      // unprocessed head. (A transient-failed row stays NULL and reappears on a later run.)
      .order('potential_total_value', { ascending: false, nullsFirst: false })
      .order('contract_id', { ascending: true })
      .limit(take);
    if (error) throw error;
    const batch = (rows || []) as Row[];
    if (batch.length === 0) { console.log('\nWork queue empty — nothing left to process.'); break; }

    // GUARD against a live-lock: if a whole page is transient-failures (all left NULL),
    // the same page would be re-fetched forever. Track failures THIS page; if a page
    // makes zero forward progress (0 stamped), bail loudly rather than spin.
    page++;
    let pageStamped = 0, pageFailed = 0;
    const queue = [...batch];
    async function worker() {
      while (queue.length) {
        const r = queue.shift()!;
        const nowIso = new Date().toISOString();
        if (DELAY_MS > 0) await sleep(DELAY_MS); // polite pacing — keep under the IP throttle
        try {
          const f = await resolveDetailFields(r);
          const { error: upErr } = await db.from(TABLE)
            .update({ psc_code: f.psc_code, psc_description: f.psc_description, description: f.description, detail_checked_at: nowIso })
            .eq('contract_id', r.contract_id);
          if (upErr) throw upErr;
          if (f.psc_code) withPsc++;
          if (f.description) withDesc++;
          if (!f.psc_code && !f.description && !f.psc_description) empty++;
          done++; pageStamped++;
        } catch (e) {
          failed++; pageFailed++;
          // Transient fetch/update error → row LEFT NULL for a later page/run to retry.
          console.error(`  ✗ ${r.contract_id}: ${e instanceof Error ? e.message : e} (will retry — not stamped)`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const elapsedMin = (Date.now() - startedAt) / 60000;
    const rate = done / Math.max(elapsedMin, 0.01);
    const leftEst = Math.max(0, (remaining ?? done) - done);
    const etaMin = rate > 0 ? Math.round(leftEst / rate) : 0;
    console.log(`  page ${page}: +${pageStamped} stamped (${pageFailed} failed) — total ${done} done (${withPsc} psc, ${withDesc} desc, ${empty} empty), ~${etaMin}m ETA`);

    if (pageStamped === 0) {
      console.error(`\n🚨 Page ${page} made ZERO forward progress — all ${batch.length} rows failed (likely a USASpending outage/rate-limit). STOPPING to avoid a spin loop. Wait, then re-run — the resumable cursor picks up here.`);
      break;
    }
  }

  console.log(`\n✅ ${done} processed (${withPsc} got psc_code, ${withDesc} got description, ${empty} genuinely empty), ${failed} failed across ${page} page(s).`);
  if (failed > 0) {
    const pct = done + failed ? Math.round((failed / (done + failed)) * 100) : 0;
    console.error(`\nℹ️  ${failed} rows (${pct}%) hit a transient fetch error — LEFT NULL, not stamped. Re-run to sweep the stragglers (the failure rate is usually a few %; a re-run resolves most).`);
  }
}

// Only auto-run when invoked directly (guards against firing when imported for tests).
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
