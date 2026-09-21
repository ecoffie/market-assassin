#!/usr/bin/env node
/**
 * C3 — REGISTRY RECONCILIATION REPORT (Data Core Controls, Phase 1)
 *
 * Census trace: Phase 0B found a THIRD registry (src/lib/data-sources/registry.ts)
 * beside Supabase `data_sources` and docs/DATA-SOURCES-REGISTRY.md. Phase 0C proved
 * they disagree: agency_forecasts is 33,687 live / 9,973 in docs / last_built NULL.
 * Phase 0A found naics_vocabulary is GREEN (real producer + real refreshed_at clock)
 * yet has NO data_sources row, so it can never be flagged stale — while tier2_sblo,
 * which has NO repeatable producer, IS monitored.
 *
 * THIS IS A REPORT, NOT A GATE. It mutates nothing and always exits 0 unless it
 * fails to read. Phase 1 is about visibility; the merge/architecture decision is
 * explicitly deferred (controls plan, "Registry Architecture Recommendation").
 *
 * ABSENT EVIDENCE -> `unmeasured`, NEVER `aligned`. A dataset we cannot read is not
 * a dataset in agreement.
 *
 * Supabase reads are optional: without credentials the report still runs and marks
 * the Supabase column `unmeasured` rather than claiming absence.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileRegistries } from '../src/lib/data-core/registry-reconcile.mjs';

// ── THIN CLI ADAPTER ────────────────────────────────────────────────────────
// The reconciliation now lives in src/lib/data-core/registry-reconcile.mjs so
// Platform Health can IMPORT it instead of spawning this file. That subprocess
// call (execFileSync on a dynamic scripts/ path) broke the production Turbopack
// build. ONE implementation, TWO consumers; this file is consumer #2.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

const report = await reconcileRegistries(ROOT);
const { supabaseReadable, rows } = report;

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const mark = (v) => (v === null ? ' ? ' : v ? ' Y ' : ' - ');
console.log('\nRegistry Reconciliation Report (C3) — READ ONLY, mutates nothing\n');
if (!supabaseReadable) {
  console.log('  NOTE: Supabase not readable here — that column reports "?" (unmeasured), never "absent".\n');
}
console.log('  dataset                          layer          sb docs ts  status');
console.log('  ' + '-'.repeat(84));
for (const r of rows) {
  console.log(`  ${r.key.padEnd(32)} ${r.layer.padEnd(14)}${mark(r.inSupabase)}${mark(r.inDocs)}${mark(r.inTs)} ${r.status}`);
  if (r.contradiction) console.log(`      ! ${r.contradiction}`);
}
const tally = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
console.log('\n  tally:', Object.entries(tally).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('  (report only — no gate, no mutation, exit 0)\n');
