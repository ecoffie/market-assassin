/**
 * DHS forecast identity migration — strip the republish `*` from DHS external_ids and merge twins.
 * Record: tasks/dhs-forecast-identity-2026-09-24.md · rule: src/lib/forecasts/dhs-identity.ts
 *
 *   npx tsx --env-file=.env.local scripts/dhs-forecast-identity-migration.ts                       # DRY RUN
 *   npx tsx --env-file=.env.local scripts/dhs-forecast-identity-migration.ts --go --expect-twins 92 --expect-renames 254
 *   npx tsx --env-file=.env.local scripts/dhs-forecast-identity-migration.ts --check-resume --fix-sha <sha>
 *   npx tsx --env-file=.env.local scripts/dhs-forecast-identity-migration.ts --verify-after-sync --since <iso>
 *
 * Plan (identity = source_agency 'DHS' + APFS number without `*`):
 *   A · TWINS: KEEP the plain row — its uuid (what pursuits reference) and its created_at (first seen, which
 *       newness depends on) — copy the starred row's current content onto it, re-point references, delete the
 *       starred row.
 *   B · STARRED ONLY: rename external_id in place (uuid and created_at unchanged).
 *
 * --go refuses unless ALL hold: the `sync-forecasts` cron_jobs row is DISABLED · twin and rename counts equal the
 * reviewed --expect-* values · canonical ids are collision-free after twin handling. A backup is written first.
 * After writing it asserts: row count = before − twins · 0 starred ids · reference census unchanged, and no
 * reference points to a deleted row · kept rows' uuid and created_at unchanged.
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonicalDhsApfsNumber } from '@/lib/forecasts/dhs-identity';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const has = (k: string) => args.includes(k);
const val = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const KEEP = new Set(['id', 'source_agency', 'external_id', 'created_at']);
/** Tables whose `notice_id` can hold a forecast uuid, `fc-<uuid>` or an external_id. */
const REF_TABLES = ['user_pipeline', 'pursuit_monitor_state', 'pursuit_change_log', 'pursuit_documents', 'anonymous_shortlist', 'user_saved_opportunities'];
const fail = (m: string): never => { console.error(`✗ ${m}`); process.exit(1); };

async function dhsRows(): Promise<any[]> {
  const out: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from('agency_forecasts').select('*').eq('source_agency', 'DHS').order('id').range(f, f + 999);
    if (error) fail(`read DHS rows: ${error.message}`);
    out.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  return out;
}
const refValues = (r: any) => [r.id, `fc-${r.id}`, r.external_id];
/** Every reference to any DHS row, by table. A failed read is fatal — an unknown census is never "0". */
async function census(rows: any[]): Promise<Array<{ table: string; notice_id: string }>> {
  const values = [...new Set(rows.flatMap(refValues))];
  const out: Array<{ table: string; notice_id: string }> = [];
  for (const t of REF_TABLES) {
    for (let i = 0; i < values.length; i += 100) {
      const { data, error } = await db.from(t).select('notice_id').in('notice_id', values.slice(i, i + 100)).range(0, 999);
      if (error) fail(`reference census on ${t}: ${error.message}`);
      for (const r of data || []) out.push({ table: t, notice_id: String((r as any).notice_id) });
    }
  }
  return out;
}
async function syncDisabled(): Promise<boolean> {
  const { data, error } = await db.from('cron_jobs').select('job_name, enabled').eq('job_name', 'sync-forecasts').limit(1).maybeSingle();
  if (error) fail(`read cron_jobs: ${error.message}`);
  if (!data) fail('cron_jobs row sync-forecasts not found — cannot prove the sync is paused');
  return String((data as any).enabled) === 'false';
}
async function servingSha(): Promise<string> {
  const html = await (await fetch('https://getmindy.ai/opportunity-map', { headers: { 'User-Agent': 'dhs-identity-migration' } })).text();
  const m = html.match(/maps-account-build:([a-fA-F0-9]+)/);
  if (!m) fail('production build stamp not found');
  return m![1];
}

function plan(rows: any[]) {
  const byExt = new Map(rows.map((r) => [r.external_id, r]));
  const starred = rows.filter((r) => String(r.external_id).startsWith('*'));
  const A = starred.filter((s) => byExt.has(canonicalDhsApfsNumber(s.external_id)!)).map((s) => ({ star: s, plain: byExt.get(canonicalDhsApfsNumber(s.external_id)!) }));
  const B = starred.filter((s) => !byExt.has(canonicalDhsApfsNumber(s.external_id)!));
  // Collision-free after twin handling: the final id set (plain ids kept + B renamed) must be unique.
  const finalIds = [...rows.filter((r) => !String(r.external_id).startsWith('*')).map((r) => String(r.external_id)), ...B.map((s) => canonicalDhsApfsNumber(s.external_id)!)];
  const collisions = finalIds.length - new Set(finalIds).size;
  return { starred, A, B, collisions };
}

(async () => {
  if (has('--check-resume')) {
    // Gate BEFORE re-enabling sync-forecasts: the migration is complete AND production serves the new ingest code.
    const fix = val('--fix-sha') ?? fail('--fix-sha <sha> required');
    const rows = await dhsRows();
    const left = rows.filter((r) => String(r.external_id).startsWith('*')).length;
    const sha = await servingSha();
    let deployed = false;
    try { execFileSync('git', ['merge-base', '--is-ancestor', fix!, sha]); deployed = true; } catch { deployed = false; }
    console.log(`starred DHS ids: ${left} · serving ${sha} · contains ${fix}: ${deployed}`);
    if (left || !deployed) fail('NOT safe to resume sync-forecasts');
    console.log('✓ safe to resume sync-forecasts');
    return;
  }
  if (has('--verify-after-sync')) {
    const since = val('--since') ?? fail('--since <iso> required');
    const rows = await dhsRows();
    const newStar = rows.filter((r) => String(r.external_id).startsWith('*') && r.created_at > since!).length;
    const dupCanon = rows.length - new Set(rows.map((r) => canonicalDhsApfsNumber(r.external_id) ?? r.external_id)).size;
    console.log(`after sync: DHS rows ${rows.length} · new starred rows since ${since}: ${newStar} · duplicate canonical ids: ${dupCanon}`);
    if (newStar || dupCanon) fail('post-sync identity check FAILED');
    console.log('✓ republished records updated their canonical rows; no new starred rows');
    return;
  }

  const rows = await dhsRows();
  const p = plan(rows);
  const before = await census(rows);
  const dangling = (refs: typeof before, gone: Set<string>) => refs.filter((r) => gone.has(r.notice_id));
  console.log(`DHS rows: ${rows.length} · starred: ${p.starred.length}`);
  console.log(`A · twins to merge (keep plain uuid + created_at, take starred content, delete starred): ${p.A.length}`);
  console.log(`   starred newer than plain: ${p.A.filter((x) => x.star.created_at > x.plain.created_at).length}/${p.A.length} · starred is the live one: ${p.A.filter((x) => x.star.last_synced_at >= x.plain.last_synced_at).length}/${p.A.length}`);
  console.log(`B · starred-only rows to rename in place: ${p.B.length}`);
  console.log(`canonical id collisions after twin handling: ${p.collisions}`);
  const starRefs = before.filter((r) => p.A.some((x) => refValues(x.star).includes(r.notice_id)));
  console.log(`reference census: ${before.length} references to DHS rows (${starRefs.length} to starred twin rows, re-pointed)`);
  console.log(`expected after: DHS rows = ${rows.length - p.A.length}, starred ids = 0, references = ${before.length}`);
  const sync = await syncDisabled();
  console.log(`sync-forecasts cron_jobs.enabled = ${sync ? 'false (paused)' : 'TRUE (NOT paused)'}`);
  if (p.collisions) fail(`${p.collisions} canonical collisions after twin handling — needs a manual decision`);
  if (!has('--go')) { console.log('DRY RUN — nothing written.'); return; }

  // ── --go preconditions ──
  if (!sync) fail('refusing --go: sync-forecasts is not paused (set its cron_jobs row enabled=false first)');
  const et = Number(val('--expect-twins')); const er = Number(val('--expect-renames'));
  if (!Number.isFinite(et) || !Number.isFinite(er)) fail('refusing --go without --expect-twins N --expect-renames M (the reviewed counts)');
  if (et !== p.A.length || er !== p.B.length) fail(`refusing --go: counts changed since review (twins ${p.A.length} vs expected ${et}, renames ${p.B.length} vs expected ${er})`);

  mkdirSync('backups', { recursive: true });
  const file = join('backups', `dhs-forecast-identity-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ taken_at: new Date().toISOString(), A: p.A, B: p.B, census: before }, null, 1));
  console.log(`backup: ${file}`);

  let errors = 0;
  for (const { star, plain } of p.A) {
    const content: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(star)) if (!KEEP.has(k)) content[k] = v;
    const u = await db.from('agency_forecasts').update(content).eq('id', plain.id);
    if (u.error) { errors++; console.error(`merge ${plain.external_id}: ${u.error.message}`); continue; }
    for (const r of before.filter((x) => refValues(star).includes(x.notice_id))) {
      const to = r.notice_id === star.external_id ? plain.external_id : r.notice_id.startsWith('fc-') ? `fc-${plain.id}` : plain.id;
      const rr = await db.from(r.table).update({ notice_id: to }).eq('notice_id', r.notice_id);
      if (rr.error) { errors++; console.error(`re-point ${r.table}: ${rr.error.message}`); }
    }
    const d = await db.from('agency_forecasts').delete().eq('id', star.id);
    if (d.error) { errors++; console.error(`delete ${star.external_id}: ${d.error.message}`); }
  }
  for (const s of p.B) {
    const u = await db.from('agency_forecasts').update({ external_id: canonicalDhsApfsNumber(s.external_id) }).eq('id', s.id);
    if (u.error) { errors++; console.error(`rename ${s.external_id}: ${u.error.message}`); }
  }

  // ── post-assertions ──
  const after = await dhsRows();
  const afterById = new Map(after.map((r) => [r.id, r]));
  const left = after.filter((r) => String(r.external_id).startsWith('*')).length;
  const gone = new Set(p.A.flatMap((x) => refValues(x.star)));
  const afterRefs = await census(after.concat(p.A.map((x) => x.star)));
  const keptOk = p.A.every(({ plain }) => afterById.get(plain.id)?.created_at === plain.created_at)
    && p.B.every((s) => afterById.get(s.id)?.created_at === s.created_at);
  const checks: Array<[string, boolean, string]> = [
    ['row count = before − twins', after.length === rows.length - p.A.length, `${after.length} vs ${rows.length - p.A.length}`],
    ['0 starred canonical ids', left === 0, String(left)],
    ['reference count unchanged', afterRefs.length === before.length, `${afterRefs.length} vs ${before.length}`],
    ['no reference to a deleted row', dangling(afterRefs, gone).length === 0, String(dangling(afterRefs, gone).length)],
    ['kept rows keep uuid + created_at', keptOk, ''],
    ['no write errors', errors === 0, String(errors)],
  ];
  for (const [n, ok, d] of checks) console.log(`${ok ? '✓' : '✗'} ${n}${d ? ` (${d})` : ''}`);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
  console.log('Next: deploy/confirm the ingest fix, then --check-resume --fix-sha <sha> BEFORE re-enabling sync-forecasts.');
})().catch((e) => { console.error(e); process.exit(1); });
