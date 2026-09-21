/**
 * Phase 3 — embed contractor capability profiles for semantic partner matching.
 * docs/PRD-contractor-capability-profiles.md
 *
 * Local tsx runner (rule #7: >1000 rows → local runner, not an HTTP cron in a loop).
 * Resumable: claims rows where capability_embedded_at IS NULL, and skips any row whose
 * capability_embed_source_hash already matches its current blob, so a re-run after a partial
 * pass costs nothing for work already done.
 *
 * COST GATE (PRD requirement): --sample measures real spend on N rows and reports the projected
 * full-run cost WITHOUT writing. Run that first; the full run is a deliberate second step.
 *
 * Usage:
 *   npx tsx scripts/embed-capability-profiles.ts --sample=1000   # measure cost, NO write
 *   npx tsx scripts/embed-capability-profiles.ts --limit=5000    # partial real run
 *   npx tsx scripts/embed-capability-profiles.ts                 # drain the queue
 *
 * Env: OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
// Must load env BEFORE any client reads process.env at module scope.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import {
  buildCapabilityBlob, blobHash, embedBatch, estimateTokens,
  EMBED_COST_PER_1M_TOKENS, type EmbeddableProfile,
} from '../src/lib/capability/embed';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

const COLS =
  'rollup_uei, rollup_name, capability_label, top_pscs, top_naics, top_agencies, set_asides_won, specialty_tier, capability_embed_source_hash';

// OpenAI accepts large arrays; 256 keeps each request well under limits and bounds the blast
// radius of a retry.
const BATCH = 256;

async function main() {
  const sampleArg = arg('sample');
  const sampleSize = sampleArg ? parseInt(sampleArg, 10) : 0;
  const isSample = sampleSize > 0;
  const limitArg = arg('limit');
  const hardLimit = limitArg ? parseInt(limitArg, 10) : undefined;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('❌ Supabase env missing'); process.exit(1); }
  if (!process.env.OPENAI_API_KEY) { console.error('❌ OPENAI_API_KEY not set'); process.exit(1); }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { count: queueTotal } = await sb
    .from('contractor_capability_profiles')
    .select('*', { count: 'exact', head: true })
    .is('capability_embedded_at', null);

  console.log(`Embedding capability profiles — queue ${queueTotal ?? '?'}${isSample ? ` (SAMPLE ${sampleSize}, NO WRITE)` : ''}`);

  let processed = 0, embedded = 0, skippedUnchanged = 0, noBlob = 0, tokens = 0;
  const t0 = Date.now();
  const target = isSample ? sampleSize : (hardLimit ?? Number.MAX_SAFE_INTEGER);

  for (;;) {
    if (processed >= target) break;
    const take = Math.min(BATCH, target - processed);

    // Always read the HEAD of the queue (embedded_at IS NULL). Because a real run stamps
    // embedded_at, the queue shrinks and `range(0, …)` never re-reads the same rows. A sample
    // run writes nothing, so it re-reads the same head — fine, it only ever runs once.
    const { data, error } = await sb
      .from('contractor_capability_profiles')
      .select(COLS)
      .is('capability_embedded_at', null)
      .order('total_obligated', { ascending: false })   // most-significant contractors first
      .range(0, take - 1);
    if (error) { console.error(`❌ read failed: ${error.message}`); process.exit(1); }

    const rows = (data || []) as Array<EmbeddableProfile & { capability_embed_source_hash: string | null }>;
    if (!rows.length) break;

    // Build blobs; skip rows whose hash is unchanged (idempotent re-run) or that have no content.
    const work: Array<{ uei: string; blob: string; hash: string }> = [];
    for (const r of rows) {
      const blob = buildCapabilityBlob(r);
      if (!blob) { noBlob++; continue; }
      const hash = blobHash(blob);
      if (r.capability_embed_source_hash === hash) { skippedUnchanged++; continue; }
      work.push({ uei: r.rollup_uei, blob, hash });
    }
    processed += rows.length;

    if (!work.length) {
      if (isSample) break;
      // Nothing to embed in this page but rows are still unstamped — stamp them so the queue
      // drains instead of looping forever on the same page.
      const ids = rows.map((r) => r.rollup_uei);
      await sb.from('contractor_capability_profiles')
        .update({ capability_embedded_at: new Date().toISOString() })
        .in('rollup_uei', ids);
      continue;
    }

    tokens += work.reduce((s, w) => s + estimateTokens(w.blob), 0);

    if (isSample) {
      // Measure REAL spend on the sample: actually call the API (a dry estimate of token count
      // is not proof the request succeeds), but never write vectors back.
      const vecs = await embedBatch(work.map((w) => w.blob));
      embedded += vecs.length;
      if (embedded >= sampleSize || processed >= target) break;
      continue;
    }

    const vectors = await embedBatch(work.map((w) => w.blob));
    if (vectors.length !== work.length) {
      console.error(`❌ vector/row mismatch (${vectors.length} vs ${work.length}) — aborting rather than misaligning embeddings`);
      process.exit(1);
    }

    const stamp = new Date().toISOString();
    // Per-row UPDATE, never upsert: an upsert payload is treated as a full INSERT by PostgREST
    // and would NULL every fact column (the Phase-2 near-miss the NOT NULL constraint caught).
    const CONC = 25;
    for (let i = 0; i < work.length; i += CONC) {
      const slice = work.slice(i, i + CONC);
      const results = await Promise.all(slice.map((w, j) =>
        sb.from('contractor_capability_profiles')
          .update({
            capability_embedding: vectors[i + j],
            capability_embed_source_hash: w.hash,
            capability_embedded_at: stamp,
          })
          .eq('rollup_uei', w.uei)
      ));
      const failed = results.find((r) => r.error);
      if (failed?.error) { console.error(`❌ update failed: ${failed.error.message}`); process.exit(1); }
      embedded += slice.length;
    }

    if (embedded % 2560 === 0) {
      const rate = embedded / ((Date.now() - t0) / 1000 / 60);
      console.log(`  ${embedded} embedded · ${rate.toFixed(0)}/min · est $${((tokens / 1e6) * EMBED_COST_PER_1M_TOKENS).toFixed(4)} so far`);
    }
  }

  const mins = (Date.now() - t0) / 1000 / 60;
  const cost = (tokens / 1e6) * EMBED_COST_PER_1M_TOKENS;
  const avgTokens = embedded ? tokens / embedded : 0;

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`embedded ${embedded} · unchanged-skipped ${skippedUnchanged} · no-blob ${noBlob}`);
  console.log(`tokens ${tokens.toLocaleString()} (avg ${avgTokens.toFixed(0)}/row) · cost $${cost.toFixed(4)} · ${mins.toFixed(1)} min`);

  if (isSample) {
    const full = queueTotal ?? 0;
    const projTokens = avgTokens * full;
    const projCost = (projTokens / 1e6) * EMBED_COST_PER_1M_TOKENS;
    const projMins = full / Math.max(embedded / mins, 1);
    console.log(`\n📊 PROJECTED FULL RUN (${full.toLocaleString()} rows)`);
    console.log(`   tokens ≈ ${Math.round(projTokens).toLocaleString()}`);
    console.log(`   cost   ≈ $${projCost.toFixed(2)}`);
    console.log(`   time   ≈ ${projMins.toFixed(0)} min`);
    console.log(`\n(sample only — nothing written. Re-run without --sample to drain.)`);
  } else {
    const { count: left } = await sb
      .from('contractor_capability_profiles')
      .select('*', { count: 'exact', head: true })
      .is('capability_embedded_at', null);
    console.log(`✅ queue remaining: ${left}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message || e); process.exit(1); });
