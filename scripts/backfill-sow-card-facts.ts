#!/usr/bin/env npx tsx
/**
 * Backfill SOW card facts (Tier 1 — brand-name/or-equal flag, eval basis, set-aside-from-text)
 * for active opps with real SOW text (>200 chars) that haven't been computed yet.
 *
 * Reuses the SHARED extractSowCardFacts() — the cron (precompute-opp-intel) and this script
 * produce identical data. Resumable: processes least-recently-computed rows first
 * (sow_card_facts_computed_at NULLS FIRST), stamps sow_card_facts_computed_at so re-runs
 * continue where they left off. Extraction is LOCAL regex + at most one mini-tier LLM call on
 * genuine ambiguity (no external rate limits like value-range/opp-intel), so this can run with a
 * higher concurrency than the API-bound backfills.
 *
 *   npx tsx scripts/backfill-sow-card-facts.ts            # DRY (counts only)
 *   npx tsx scripts/backfill-sow-card-facts.ts --go       # write, default 500
 *   npx tsx scripts/backfill-sow-card-facts.ts --go --limit 2502 --concurrency 12
 */
import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { extractSowCardFacts, sowCardFactsHasContent } from '../src/lib/opportunities/sow-card-facts';

const GO = process.argv.includes('--go');
const arg = (f: string, d: number) => { const i = process.argv.indexOf(f); return i >= 0 ? parseInt(process.argv[i + 1], 10) || d : d; };
const LIMIT = arg('--limit', 500);
const CONCURRENCY = arg('--concurrency', 10);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Per-record timeout so one hanging LLM call (the eval-basis ambiguity escalation) can't stall a
// pool worker — matches the bulk-job non-negotiable (Promise.race, ~30s).
function withTimeout<T>(p: Promise<T>, ms = 30000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function main() {
  const nowIso = new Date().toISOString();
  const { count: remaining } = await db.from('sam_opportunities')
    .select('notice_id', { count: 'exact', head: true })
    .eq('active', true).gt('response_deadline', nowIso)
    .not('sow_text', 'is', null)
    .is('sow_card_facts_computed_at', null);
  console.log(`Active opps with SOW text, not yet computed: ${remaining ?? '?'}`);
  if (!GO) { console.log(`DRY RUN. Re-run with --go (limit ${LIMIT}, concurrency ${CONCURRENCY}) to compute.`); return; }

  // Least-recently-computed first (NULLs first via the null filter + posted_date ordering, same
  // pattern as backfill-opp-intel.ts).
  const { data: rows, error } = await db.from('sam_opportunities')
    .select('notice_id, sow_text, set_aside_code')
    .eq('active', true).gt('response_deadline', nowIso)
    .not('sow_text', 'is', null)
    .is('sow_card_facts_computed_at', null)
    .order('posted_date', { ascending: false })
    .limit(LIMIT);
  if (error) throw error;
  // >200 chars is the addressable set (per the scope doc) — the DB filter above only excludes
  // NULL, so short stubs still need filtering client-side.
  const batch = (rows || []).filter((r) => (r.sow_text || '').length > 200);
  console.log(`Processing ${batch.length} this run (of ${rows?.length ?? 0} fetched)…`);

  let done = 0, withContent = 0, failed = 0;
  const queue = [...batch];
  async function worker() {
    while (queue.length) {
      const r = queue.shift()!;
      try {
        const facts = await withTimeout(extractSowCardFacts(r.sow_text, r.set_aside_code || null));
        await db.from('sam_opportunities')
          .update({ sow_card_facts: sowCardFactsHasContent(facts) ? facts : null, sow_card_facts_computed_at: new Date().toISOString() })
          .eq('notice_id', r.notice_id);
        done++; if (sowCardFactsHasContent(facts)) withContent++;
        if (done % 100 === 0) console.log(`  ${done}/${batch.length} (${withContent} with content)`);
      } catch (e) {
        failed++;
        // Stamp anyway so a permanently-failing/timed-out row can't jam the resumable cursor.
        await db.from('sam_opportunities').update({ sow_card_facts_computed_at: new Date().toISOString() }).eq('notice_id', r.notice_id).then(() => {}, () => {});
        console.error(`  ✗ ${r.notice_id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n✅ Computed ${done} (${withContent} had content), ${failed} failed. Re-run to continue the drain.`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
