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
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs/DATA-SOURCES-REGISTRY.md');
const TS_REGISTRY = join(ROOT, 'src/lib/data-sources/registry.ts');
const JSON_OUT = process.argv.includes('--json');

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Material datasets, each carrying the census phase that established materiality.
 * Not an inventory of everything — the census's material set, which is the point:
 * a dataset here that is absent from all three registries is class 10 evidence.
 */
const MATERIAL = [
  { key: 'sam_opportunities', layer: 'supabase', census: '0C — 66 customer-facing consumers, 206,064 rows' },
  { key: 'recompete_opportunities', layer: 'supabase', census: '0C — Pro feature, 171,729 rows' },
  { key: 'agency_forecasts', layer: 'supabase', census: '0C — three registries disagree' },
  { key: 'agency_pain_points', layer: 'supabase', census: '0A/0C — stamp 4 months ahead of data' },
  { key: 'naics_vocabulary', layer: 'supabase', census: '0A — GREEN but unregistered/unmonitorable' },
  { key: 'federal_contacts', layer: 'supabase', census: '0C — the only LIVE_SYNC_CHECKS entry' },
  { key: 'dodaac_directory', layer: 'supabase', census: '0A — office decoding' },
  { key: 'sam_entities', layer: 'supabase', census: '0C — 910,126 rows, in no registry' },
  { key: 'sba_goaling', layer: 'supabase', census: '0C — MCP tool, in NONE of the three' },
  { key: 'tier2_sblo', layer: 'built_curated', census: '0A — no repeatable producer (PR #1444 corrected the description only)' },
  { key: 'dod_command_osbp', layer: 'built_curated', census: '0A — 48/169 directors verified, honestly disclosed' },
  { key: 'forecast_intelligence', layer: 'built_curated', census: '0A — last_built NULL while advancing' },
  { key: 'bq_awards', layer: 'bigquery', census: '0D — reference implementation; stamp matches measurement' },
  { key: 'recipients_rollup_merged', layer: 'bigquery', census: '0D — 296,445 live vs 292,848 documented' },
  { key: 'contractors.json', layer: 'built_curated', census: '0B — no producer, frozen 8.5 months' },
  { key: 'agency-sat-friendliness.json', layer: 'built_curated', census: '0B — opinion percentages in customer alert emails' },
];

const docs = existsSync(DOCS) ? readFileSync(DOCS, 'utf8') : null;
const tsSrc = existsSync(TS_REGISTRY) ? stripComments(readFileSync(TS_REGISTRY, 'utf8')) : null;

async function readSupabaseRegistry() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return null;                       // unmeasured, not absent
  try {
    const res = await fetch(`${url}/rest/v1/data_sources?select=key,last_built,refresh_cadence,is_active`, {
      headers: { apikey: svc, Authorization: `Bearer ${svc}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const supabaseRows = await readSupabaseRegistry();

function classify(row) {
  const present = [row.inSupabase, row.inDocs, row.inTs].filter((v) => v === true).length;
  const unknown = [row.inSupabase, row.inDocs, row.inTs].some((v) => v === null);
  if (row.contradiction) return 'contradictory';
  if (unknown && present === 0) return 'unmeasured';
  if (present === 0) return 'unregistered';
  if (present === 3) return 'aligned';
  return 'partially_aligned';
}

const rows = MATERIAL.map((m) => {
  const inSupabase = supabaseRows === null
    ? null
    : supabaseRows.some((r) => r.key === m.key);
  const inDocs = docs === null ? null : docs.includes(m.key);
  const inTs = tsSrc === null ? null : tsSrc.includes(m.key);

  let contradiction = null;
  if (m.key === 'agency_forecasts' && inDocs && docs.includes('9,973')) {
    contradiction = 'docs claim 9,973; live measured 33,687 (Phase 0C); data_sources.last_built NULL';
  }
  if (m.key === 'naics_vocabulary' && inSupabase === false) {
    contradiction = 'GREEN dataset (real producer + refreshed_at clock) with NO data_sources row — cannot be flagged stale even in principle';
  }
  if (m.key === 'tier2_sblo' && inSupabase) {
    contradiction = 'monitored for freshness but has NO repeatable producer — PR #1444 corrected the description, not the refreshability';
  }
  const row = { ...m, inSupabase, inDocs, inTs, contradiction };
  return { ...row, status: classify(row) };
});

if (JSON_OUT) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), supabaseReadable: supabaseRows !== null, rows }, null, 2));
  process.exit(0);
}

const mark = (v) => (v === null ? ' ? ' : v ? ' Y ' : ' - ');
console.log('\nRegistry Reconciliation Report (C3) — READ ONLY, mutates nothing\n');
if (supabaseRows === null) {
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
