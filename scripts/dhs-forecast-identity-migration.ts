/**
 * DHS forecast identity migration — strip the republish `*` from DHS external_ids and merge twins.
 * Record: tasks/dhs-forecast-identity-2026-09-24.md · rule: src/lib/forecasts/dhs-identity.ts
 *
 *   npx tsx --env-file=.env.local scripts/dhs-forecast-identity-migration.ts            # DRY RUN (default)
 *   npx tsx --env-file=.env.local scripts/dhs-forecast-identity-migration.ts --go --sync-paused
 *
 * Plan (identity = `source_agency='DHS'` + APFS number without `*`):
 *   A · TWINS (plain row + starred row for one APFS number): KEEP the plain row — its uuid (what pursuits
 *       reference) and its created_at (the first time Mindy saw the forecast, which newness depends on) —
 *       copy the starred row's current content onto it, re-point any reference to the starred row, then
 *       delete the starred row.
 *   B · STARRED ONLY: rename external_id in place (uuid and created_at unchanged).
 *
 * ⚠️ Must run in the SAME window as the ingest fix, with the `sync-forecasts` cron paused: old code would
 * re-insert starred ids, and new code before this migration would insert plain duplicates of group B.
 * --go refuses without --sync-paused. A backup of every touched row + reference is written first.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalDhsApfsNumber } from '@/lib/forecasts/dhs-identity';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const GO = process.argv.includes('--go');
const PAUSED = process.argv.includes('--sync-paused');
/** Never copied from the starred row onto the kept plain row. */
const KEEP = new Set(['id', 'source_agency', 'external_id', 'created_at']);
/** Tables whose `notice_id` can hold a forecast uuid, `fc-<uuid>` or an external_id. */
const REF_TABLES = ['user_pipeline', 'pursuit_monitor_state', 'pursuit_change_log', 'pursuit_documents', 'anonymous_shortlist', 'user_saved_opportunities'];

async function dhsRows(): Promise<any[]> {
  const out: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from('agency_forecasts').select('*').eq('source_agency', 'DHS').order('id').range(f, f + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  return out;
}
async function refsTo(values: string[]): Promise<Array<{ table: string; row: any }>> {
  const out: Array<{ table: string; row: any }> = [];
  for (const t of REF_TABLES) {
    for (let i = 0; i < values.length; i += 100) {
      const { data, error } = await db.from(t).select('*').in('notice_id', values.slice(i, i + 100)).range(0, 999);
      if (error) { console.error(`[refs] ${t}: ${error.message} — treated as UNKNOWN, --go will refuse`); throw new Error(`reference scan failed on ${t}`); }
      for (const row of data || []) out.push({ table: t, row });
    }
  }
  return out;
}

(async () => {
  const rows = await dhsRows();
  const byExt = new Map(rows.map((r) => [r.external_id, r]));
  const starred = rows.filter((r) => String(r.external_id).startsWith('*'));
  const A = starred.filter((s) => byExt.has(canonicalDhsApfsNumber(s.external_id)!)).map((s) => ({ star: s, plain: byExt.get(canonicalDhsApfsNumber(s.external_id)!) }));
  const B = starred.filter((s) => !byExt.has(canonicalDhsApfsNumber(s.external_id)!));
  const collisionsInB = new Set<string>(); const seenB = new Set<string>();
  for (const s of B) { const k = canonicalDhsApfsNumber(s.external_id)!; if (seenB.has(k)) collisionsInB.add(k); seenB.add(k); }
  const starRefValues = A.flatMap(({ star }) => [star.id, `fc-${star.id}`, star.external_id]);
  const refs = await refsTo(starRefValues);

  console.log(`DHS rows: ${rows.length} · starred: ${starred.length}`);
  console.log(`A · twins to merge (keep plain uuid + created_at, take starred content, delete starred): ${A.length}`);
  console.log(`   starred row newer than plain: ${A.filter((x) => x.star.created_at > x.plain.created_at).length}/${A.length} · starred row is the live one: ${A.filter((x) => x.star.last_synced_at >= x.plain.last_synced_at).length}/${A.length}`);
  console.log(`B · starred-only rows to rename in place: ${B.length} (duplicate canonical ids inside B: ${collisionsInB.size})`);
  console.log(`references to starred twin rows to re-point: ${refs.length}`, refs.map((r) => `${r.table}:${r.row.notice_id}`));
  console.log(`expected after: DHS rows = ${rows.length - A.length}, starred external_ids = 0`);
  if (collisionsInB.size) { console.error('refusing: canonical collisions inside group B need a manual decision'); process.exit(1); }
  if (!GO) { console.log('DRY RUN — nothing written.'); return; }
  if (!PAUSED) { console.error('refusing --go without --sync-paused (disable the sync-forecasts cron_jobs row first)'); process.exit(1); }

  mkdirSync('backups', { recursive: true });
  const file = join('backups', `dhs-forecast-identity-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ taken_at: new Date().toISOString(), A, B, refs }, null, 1));
  console.log(`backup: ${file}`);

  let fail = 0;
  for (const { star, plain } of A) {
    const content: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(star)) if (!KEEP.has(k)) content[k] = v;
    const u = await db.from('agency_forecasts').update(content).eq('id', plain.id);
    if (u.error) { fail++; console.error(`merge ${plain.external_id}: ${u.error.message}`); continue; }
    for (const r of refs.filter((x) => [star.id, `fc-${star.id}`, star.external_id].includes(x.row.notice_id))) {
      const to = r.row.notice_id === star.external_id ? plain.external_id : String(r.row.notice_id).startsWith('fc-') ? `fc-${plain.id}` : plain.id;
      const rr = await db.from(r.table).update({ notice_id: to }).eq('notice_id', r.row.notice_id);
      if (rr.error) { fail++; console.error(`re-point ${r.table}: ${rr.error.message}`); }
    }
    const d = await db.from('agency_forecasts').delete().eq('id', star.id);
    if (d.error) { fail++; console.error(`delete ${star.external_id}: ${d.error.message}`); }
  }
  for (const s of B) {
    const u = await db.from('agency_forecasts').update({ external_id: canonicalDhsApfsNumber(s.external_id) }).eq('id', s.id);
    if (u.error) { fail++; console.error(`rename ${s.external_id}: ${u.error.message}`); }
  }
  const after = await dhsRows();
  const left = after.filter((r) => String(r.external_id).startsWith('*')).length;
  console.log(`after: DHS rows ${after.length} (expected ${rows.length - A.length}) · starred left ${left} · failures ${fail}`);
  if (fail || left || after.length !== rows.length - A.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
