#!/usr/bin/env npx tsx
/**
 * Backfill ONLY the intel_value_range (the $ estimate) for active opps that don't have one yet.
 *
 * The main intel backfill (backfill-opp-intel.ts) already ran and stamped intel_computed_at on
 * every row, so it SKIPS them — this targeted runner fills the newly-added intel_value_range
 * column without recomputing the rest. For each row it prefers the predecessor's stored value
 * (already in intel_predecessor) and otherwise computes a comparable-award median/IQR from
 * USASpending. Resumable: stamps intel_value_range so re-runs continue; rows that yield no
 * grounded range are stamped with a sentinel {none:true} so they aren't retried forever.
 *
 *   npx tsx scripts/backfill-value-range.ts            # DRY (counts only)
 *   npx tsx scripts/backfill-value-range.ts --go       # write, default 500
 *   npx tsx scripts/backfill-value-range.ts --go --limit 3000 --concurrency 6
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { getComparableAwardRange } from '../src/lib/opportunities/value-range';

const GO = process.argv.includes('--go');
const arg = (f: string, d: number) => { const i = process.argv.indexOf(f); return i >= 0 ? parseInt(process.argv[i + 1], 10) || d : d; };
const LIMIT = arg('--limit', 500);
const CONCURRENCY = arg('--concurrency', 5);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function predRange(pred: any): { low: number; median: number; high: number; label: string; source: 'predecessor' } | null {
  if (!pred) return null;
  const v = pred.ceiling ?? pred.currentValue ?? pred.obligated ?? null;
  // The stored intel_predecessor already formatted value as a string ($X) — but it may also keep
  // the raw number under these keys if present. If only the formatted string exists, skip (the
  // comparable range will cover it).
  if (typeof v === 'number' && v > 0) return { low: Math.round(v * 0.85), median: Math.round(v), high: Math.round(v * 1.15), label: 'based on the prior contract', source: 'predecessor' };
  return null;
}

async function main() {
  const nowIso = new Date().toISOString();
  const { count: remaining } = await db.from('sam_opportunities')
    .select('notice_id', { count: 'exact', head: true })
    .eq('active', true).gt('response_deadline', nowIso).is('intel_value_range', null);
  console.log(`Active opps missing a value range: ${remaining ?? '?'}`);
  if (!GO) { console.log(`DRY RUN. Re-run with --go (limit ${LIMIT}, concurrency ${CONCURRENCY}) to compute.`); return; }

  const { data: rows, error } = await db.from('sam_opportunities')
    .select('notice_id, naics_code, department, sub_tier, intel_predecessor')
    .eq('active', true).gt('response_deadline', nowIso).is('intel_value_range', null)
    .order('posted_date', { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  const batch = rows || [];
  console.log(`Processing ${batch.length} this run…`);

  let done = 0, withRange = 0, failed = 0;
  const queue = [...batch];
  async function worker() {
    while (queue.length) {
      const r = queue.shift()!;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let range: any = predRange(r.intel_predecessor);
        if (!range && r.naics_code) {
          // getComparableAwardRange THROWS on a rate-limit/upstream error, returns null on a
          // genuine empty. So: a throw → leave the row NULL (retry next pass); a null → stamp the
          // {none} sentinel (real no-comparables, don't retry forever).
          const cr = await getComparableAwardRange(r.naics_code, r.department || null, { subAgency: r.sub_tier || null });
          if (cr) range = { low: cr.low, median: cr.median, high: cr.high, label: `${cr.n} comparable ${cr.basis} contracts`, source: 'comparable_awards' };
        }
        await db.from('sam_opportunities').update({ intel_value_range: range || { none: true } }).eq('notice_id', r.notice_id);
        done++; if (range) withRange++;
        if (done % 25 === 0) console.log(`  ${done}/${batch.length} (${withRange} with a range)`);
      } catch (e) {
        // Upstream error (rate-limit) — do NOT stamp; leave NULL so a later pass retries it.
        failed++;
        console.error(`  ⏳ ${r.notice_id}: ${e instanceof Error ? e.message : e} (will retry)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n✅ ${done} computed (${withRange} had a range, ${failed} failed). Re-run to continue.`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
