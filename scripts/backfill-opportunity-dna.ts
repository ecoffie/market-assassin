#!/usr/bin/env npx tsx
/**
 * Precompute the Opportunity DNA genome into sam_opportunities.opportunity_dna (+ _keys) so the
 * STRATEGY FILTER can run over the whole corpus (filter by strand, not NAICS). Reuses the SHARED
 * computeGenome() + genomeKeys() — the map API, the sync, and this script all produce identical DNA.
 *
 * The three lib-derived flags are computed here exactly as the map decorate does:
 *   sbf        = sapBuyerTier(department) === 'most'          (SB-friendly buyer)
 *   repeatBuyer= isRepeatBuyer(department, naics_code)         (≥8 real awards in this NAICS)
 *   postsEarly = early-signal band 'high' for the office DoDAAC (loaded once, cached)
 * Pure compute otherwise — no external APIs, so this is fast (unlike the opp-intel backfill).
 *
 * Resumable: drains rows with dna_computed_at NULL first, stamps it so re-runs continue. Bulk job
 * (>1000 rows) → a local tsx runner, NOT the HTTP cron in a loop (per CLAUDE.md).
 *
 *   npx tsx scripts/backfill-opportunity-dna.ts            # DRY (counts only)
 *   npx tsx scripts/backfill-opportunity-dna.ts --go       # write, default 2000
 *   npx tsx scripts/backfill-opportunity-dna.ts --go --limit 5000
 *   npx tsx scripts/backfill-opportunity-dna.ts --go --all # loop until the corpus is drained
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { computeGenome, genomeKeys } from '../src/lib/opportunities/genome';
import { setGroupKey } from '../src/lib/opportunities/map-data';
import { sapBuyerTier } from '../src/lib/opportunities/sap-friendly-agencies';
import { isRepeatBuyer } from '../src/lib/opportunities/repeat-buyer';
import { dodaacFromSolicitation } from '../src/lib/opportunities/early-signal-pins';
import { loadDodaacEarlySignal } from '../src/lib/gov-contacts/dodaac-directory';

const GO = process.argv.includes('--go');
const ALL = process.argv.includes('--all');
const arg = (f: string, d: number) => { const i = process.argv.indexOf(f); return i >= 0 ? parseInt(process.argv[i + 1], 10) || d : d; };
const LIMIT = arg('--limit', 2000);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

interface Row {
  notice_id: string; naics_code: string | null; department: string | null; title: string | null;
  set_aside_code: string | null; notice_type: string | null; response_deadline: string | null;
  solicitation_number: string | null;
}

async function runBatch(early: Map<string, { band: string; pct: number }>): Promise<number> {
  const nowMs = Date.now();
  // Drain never-computed rows first (dna_computed_at NULL). Active + still-open only — the strategy
  // filter runs on the live corpus, and a closed opp's genome is stale/irrelevant.
  const { data: rows, error } = await db.from('sam_opportunities')
    .select('notice_id, naics_code, department, title, set_aside_code, notice_type, response_deadline, solicitation_number')
    .eq('active', true).gt('response_deadline', new Date().toISOString()).is('dna_computed_at', null)
    .order('posted_date', { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  const batch = (rows || []) as Row[];
  if (!batch.length) return 0;

  let done = 0, withKeys = 0, failed = 0;
  for (const r of batch) {
    try {
      const dodaac = dodaacFromSolicitation(r.solicitation_number);
      const sbf = sapBuyerTier(r.department) === 'most' ? 1 : 0;
      const repeatBuyer = isRepeatBuyer(r.department, r.naics_code) ? 1 : 0;
      const postsEarly = (dodaac && early.get(dodaac)?.band === 'high') ? 1 : 0;
      const genome = computeGenome({
        src: 'SAM',
        noticeType: r.notice_type, title: r.title,
        set: setGroupKey(r.set_aside_code), close: r.response_deadline,
        sbf, repeatBuyer, postsEarly,
      }, nowMs);
      const keys = genomeKeys(genome);
      const { error: uerr } = await db.from('sam_opportunities').update({
        opportunity_dna: genome, opportunity_dna_keys: keys, dna_computed_at: new Date().toISOString(),
      }).eq('notice_id', r.notice_id);
      if (uerr) throw uerr;
      done++; if (keys.length) withKeys++;
      if (done % 200 === 0) console.log(`  ${done}/${batch.length} (${withKeys} with strands)`);
    } catch (e) {
      failed++;
      // Stamp anyway so a permanently-failing row doesn't jam the resumable cursor.
      await db.from('sam_opportunities').update({ dna_computed_at: new Date().toISOString() }).eq('notice_id', r.notice_id).then(() => {}, () => {});
      console.error(`  ✗ ${r.notice_id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Batch: computed ${done} (${withKeys} had strands), ${failed} failed.`);
  return done;
}

async function main() {
  const nowIso = new Date().toISOString();
  const { count: remaining } = await db.from('sam_opportunities')
    .select('notice_id', { count: 'exact', head: true })
    .eq('active', true).gt('response_deadline', nowIso).is('dna_computed_at', null);
  console.log(`Active open opps not yet DNA-computed: ${remaining ?? '?'}`);
  if (!GO) { console.log(`DRY RUN. Re-run with --go (limit ${LIMIT}${ALL ? ', looping until drained' : ''}) to compute.`); return; }

  const early = await loadDodaacEarlySignal().catch(() => new Map<string, { band: string; pct: number }>());
  let total = 0;
  do {
    const n = await runBatch(early);
    total += n;
    if (!ALL || n === 0) break;
  } while (true);
  console.log(`\n✅ Computed DNA for ${total} opps this run. Re-run to continue the drain (or use --all).`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
