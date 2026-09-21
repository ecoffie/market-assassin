#!/usr/bin/env npx tsx
/**
 * Precompute per-opportunity intelligence into sam_opportunities.intel_* columns so the
 * map detail drawer reads it instantly (instead of running live tools per click).
 * Reuses the SHARED buildOppIntel() — the API and this script produce identical data.
 *
 * Resumable: processes least-recently-computed active opps first (intel_computed_at NULLS
 * FIRST), stamps intel_computed_at so re-runs continue where they left off. Concurrency
 * pool (external APIs, so modest). ~11k active opps.
 *
 *   npx tsx scripts/backfill-opp-intel.ts            # DRY (counts only)
 *   npx tsx scripts/backfill-opp-intel.ts --go       # write, default 500
 *   npx tsx scripts/backfill-opp-intel.ts --go --limit 2000 --concurrency 6
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { buildOppIntel, intelHasContent } from '../src/lib/opportunities/opp-intel';

const GO = process.argv.includes('--go');
const arg = (f: string, d: number) => { const i = process.argv.indexOf(f); return i >= 0 ? parseInt(process.argv[i + 1], 10) || d : d; };
const LIMIT = arg('--limit', 500);
const CONCURRENCY = arg('--concurrency', 5);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const nowIso = new Date().toISOString();
  const { count: remaining } = await db.from('sam_opportunities')
    .select('notice_id', { count: 'exact', head: true })
    .eq('active', true).gt('response_deadline', nowIso).is('intel_computed_at', null);
  console.log(`Active opps not yet computed: ${remaining ?? '?'}`);
  if (!GO) { console.log(`DRY RUN. Re-run with --go (limit ${LIMIT}, concurrency ${CONCURRENCY}) to compute.`); return; }

  // Least-recently-computed first (NULLs first via ordering + null filter for the fresh drain).
  const { data: rows, error } = await db.from('sam_opportunities')
    // psc_code + sub_tier are REQUIRED so this produces the SAME estimate the live cron/drawer does
    // (route.ts passes buildOppIntel(naics, dept, title, undefined, subTier, psc)). Omitting them
    // computes a NAICS-only estimate that DISAGREES with what the drawer shows — the exact
    // headline/band mismatch class. (Eric 2026-08-04.)
    .select('notice_id, naics_code, department, title, psc_code, sub_tier')
    .eq('active', true).gt('response_deadline', nowIso).is('intel_computed_at', null)
    .order('posted_date', { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  const batch = rows || [];
  console.log(`Processing ${batch.length} this run…`);

  let done = 0, withContent = 0, failed = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queue = [...batch];
  async function worker() {
    while (queue.length) {
      const r = queue.shift()!;
      try {
        const intel = await buildOppIntel(r.naics_code || null, r.department || null, r.title || null, undefined, r.sub_tier || null, r.psc_code || null);
        await db.from('sam_opportunities').update({
          intel_predecessor: intel.predecessor, intel_agency: intel.agency,
          intel_pricing: intel.pricing, intel_computed_at: new Date().toISOString(),
        }).eq('notice_id', r.notice_id);
        if (intel.valueRange) {
          await db.from('sam_opportunities').update({ intel_value_range: intel.valueRange }).eq('notice_id', r.notice_id).then(() => {}, () => {});
        }
        done++; if (intelHasContent(intel)) withContent++;
        if (done % 25 === 0) console.log(`  ${done}/${batch.length} (${withContent} with content)`);
      } catch (e) {
        failed++;
        // Stamp anyway so a permanently-failing row doesn't jam the resumable cursor.
        await db.from('sam_opportunities').update({ intel_computed_at: new Date().toISOString() }).eq('notice_id', r.notice_id).then(() => {}, () => {});
        console.error(`  ✗ ${r.notice_id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n✅ Computed ${done} (${withContent} had content), ${failed} failed. Re-run to continue the drain.`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
