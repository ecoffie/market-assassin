/**
 * Atomic rebuild of award_detail_lookup + piid_lookup (2026-11-13).
 * Replaces scripts/usaspending-ingest/build-lookup-tables.sh (DROP-then-CREATE; do not use).
 *
 *   npx tsx scripts/rebuild-award-lookups.ts                 # dry run: source facts + priced builds
 *   npx tsx scripts/rebuild-award-lookups.ts --go            # lock → staging → validate → backup → publish → verify
 *   npx tsx scripts/rebuild-award-lookups.ts --go --probe <award_id> [--probe …]
 *   npx tsx scripts/rebuild-award-lookups.ts --rollback      # copy <table>__prev back over production
 *
 * Runs after a successful weekly ingest (.github/workflows/bq-awards-ingest.yml). Logs every
 * outcome to Supabase data_sources (key 'bq_award_lookups'). Exit code 1 on any failure.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { bqQuery, bqDryRun, bqCopyTable, bqTableRows } from '../src/lib/bigquery/client';
import { rebuildLookups, LOOKUPS, backupName, type RebuildBq, type RebuildResult } from '../src/lib/awards-ingest/lookup-rebuild';

const bq: RebuildBq = {
  query: (sql, o) => bqQuery({ query: sql, params: o?.params, maximumBytesBilled: o?.maximumBytesBilled != null ? String(o.maximumBytesBilled) : undefined, bulkJob: 'award-lookup-rebuild' }) as never,
  dryRunBytes: async (sql) => (await bqDryRun({ query: sql })).bytesProcessed,
  copy: (src, dst) => bqCopyTable(src, dst),
  tableRows: (t) => bqTableRows(t),
};

async function logOutcome(r: RebuildResult | { ok: boolean; stage: string; reasons: string[] }, extra: Record<string, unknown> = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.warn('[rebuild] no Supabase env; outcome not logged'); return; }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const KEY = 'bq_award_lookups';
  const { data: existing, error: readErr } = await db.from('data_sources').select('id, notes, last_built, record_count').eq('key', KEY).limit(1).maybeSingle();
  if (readErr) { console.warn('[rebuild] data_sources read failed:', readErr.message); return; }
  const status = { at: new Date().toISOString(), ok: r.ok, stage: r.stage, reasons: r.reasons, ...extra };
  const success = r.ok && 'published' in r && r.published.length === LOOKUPS.length;
  const notes = `award_detail_lookup + piid_lookup, rebuilt atomically after the weekly awards ingest (scripts/rebuild-award-lookups.ts).\n\n[award-lookups:v1]\n${JSON.stringify(status)}\n[/award-lookups]`;
  const row = {
    key: KEY, name: 'BigQuery award lookup tables', category: 'warehouse', built_from: 'usaspending.awards',
    refresh_cadence: 'weekly, after ingest', notes, updated_at: new Date().toISOString(),
    // last_built / record_count only advance on a successful publish: a failed run keeps the last good values.
    ...(success ? { last_built: status.at.slice(0, 10), record_count: Number((r as RebuildResult).rows.award_detail_lookup ?? 0) } : {}),
  };
  const { error } = existing
    ? await db.from('data_sources').update(row).eq('id', existing.id)
    : await db.from('data_sources').insert(row);
  if (error) console.warn('[rebuild] outcome log failed:', error.message);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--rollback')) {
    for (const t of LOOKUPS) { await bqCopyTable(backupName(t), t); console.log(`restored ${t} from ${backupName(t)}`); }
    await logOutcome({ ok: true, stage: 'rollback', reasons: [] });
    return;
  }
  const go = argv.includes('--go');
  const probeIds = argv.flatMap((a, i) => (a === '--probe' && argv[i + 1] ? [argv[i + 1]] : []));
  const t0 = Date.now();
  const r = await rebuildLookups(bq, { go, probeIds, log: (m) => console.log(`  ${m}`) });
  console.log(`\n${go ? 'REBUILD' : 'DRY RUN'}: ${r.ok ? 'OK' : 'FAILED'} at stage "${r.stage}" in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`  source max action date: ${r.sourceMaxActionDate}`);
  console.log(`  published: ${r.published.join(', ') || 'none'}; rows: ${JSON.stringify(r.rows)}; est scan ${(r.estimatedBytes / 1e9).toFixed(1)} GB`);
  if (r.reasons.length) console.log(`  reasons:\n    - ${r.reasons.join('\n    - ')}`);
  if (go) await logOutcome(r, { sourceMaxActionDate: r.sourceMaxActionDate, rows: r.rows, published: r.published, estimatedBytes: r.estimatedBytes });
  if (!r.ok) process.exit(1);
}
main().catch(async (e) => { console.error('rebuild failed:', e); process.exit(1); });
