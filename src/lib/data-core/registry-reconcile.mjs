/**
 * C3 — REGISTRY RECONCILIATION, as an IMPORTABLE module.
 *
 * ⚠️ WHY THIS FILE EXISTS. This logic used to live only at module scope inside
 * `scripts/registry-reconciliation.mjs`, so the only way to obtain it was to spawn
 * the script. Platform Health did exactly that, via a dynamic `scripts/` path, and
 * Turbopack FAILED THE PRODUCTION BUILD — correctly: a bundled server module must
 * not reach into repo CLI files. The fix is the boundary, not the bundler.
 *
 * ONE implementation, TWO consumers:
 *   reconcileRegistries()  ├── src/lib/data-core/integrity-report.ts imports it
 *                          └── scripts/registry-reconciliation.mjs is a CLI adapter
 *
 * ⚠️ FAILURE SEMANTICS ARE LOAD-BEARING AND PRESERVED VERBATIM. When Supabase is
 * unreachable or credentials are absent, `readSupabaseRegistry()` returns null ->
 * `inSupabase: null` -> status `unmeasured`. It must NEVER become `false`
 * ("absent"), `aligned`, or zero. A refactor that turns an unreadable source into a
 * confident answer is the exact defect this control exists to catch.
 *
 * Plain `.mjs` ON PURPOSE so both a bundled TS import and a plain `node scripts/...`
 * CLI can load it with no loader in either path.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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


function classify(row) {
  const present = [row.inSupabase, row.inDocs, row.inTs].filter((v) => v === true).length;
  const unknown = [row.inSupabase, row.inDocs, row.inTs].some((v) => v === null);
  if (row.contradiction) return 'contradictory';
  if (unknown && present === 0) return 'unmeasured';
  if (present === 0) return 'unregistered';
  if (present === 3) return 'aligned';
  return 'partially_aligned';
}

function buildRows({ docs, tsSrc, supabaseRows }) {
  return MATERIAL.map((m) => {
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
}


/**
 * THE single C3 reconciliation.
 * @param root repo root
 * @returns { generatedAt, supabaseReadable, rows }
 */
export async function reconcileRegistries(root) {
  const DOCS = join(root, 'docs/DATA-SOURCES-REGISTRY.md');
  const TS_REGISTRY = join(root, 'src/lib/data-sources/registry.ts');
  const docs = existsSync(DOCS) ? readFileSync(DOCS, 'utf8') : null;
  const tsSrc = existsSync(TS_REGISTRY) ? stripComments(readFileSync(TS_REGISTRY, 'utf8')) : null;
  const supabaseRows = await readSupabaseRegistry();
  return {
    generatedAt: new Date().toISOString(),
    supabaseReadable: supabaseRows !== null,
    rows: buildRows({ docs, tsSrc, supabaseRows }),
  };
}
