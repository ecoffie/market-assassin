/**
 * EXPLICIT silent baseline for the canonical Saved Search Forecast engine (cutover step 3).
 * Record: tasks/saved-search-forecast-watermark-2026-09-24.md
 *
 *   npx tsx --env-file=.env.local scripts/saved-search-forecast-baseline.ts                 # DRY RUN (default)
 *   npx tsx --env-file=.env.local scripts/saved-search-forecast-baseline.ts --go             # write
 *   npx tsx --env-file=.env.local scripts/saved-search-forecast-baseline.ts --rollback <backup.json> [--go]
 *
 * Sets forecast_seen_through = ONE DB snapshot (and forecast_gap_since for currently uncovered buyers) on
 * every Forecast-alerting saved search whose watermark is NULL. Nothing that exists at the snapshot is new.
 *
 * Guarantees:
 *   - DRY RUN by default; prints the expected row count.
 *   - Refuses to run if the migration is not applied (columns missing).
 *   - Writes a backup file FIRST (id, last_seen_notice_ids, last_alerted_at, total_alerts_sent,
 *     forecast_seen_through, forecast_gap_since) — every write is reversible from it.
 *   - Idempotent: only rows with forecast_seen_through IS NULL are written; a second run writes 0.
 *   - Touches ONLY forecast_seen_through / forecast_gap_since. Open state (last_seen_notice_ids,
 *     last_alerted_at, total_alerts_sent) is verified byte-identical after the write.
 *   - Has no email path (does not import any sender).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { contextFor } from '@/lib/discovery';
import { savedSearchForecastRequest } from '@/lib/saved-searches/forecast-discovery';
import { planForecastRun, readForecastSnapshot } from '@/lib/saved-searches/forecast-watermark';

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const GO = args.includes('--go');
const rbAt = args.indexOf('--rollback');
const ROLLBACK = rbAt >= 0 ? args[rbAt + 1] : null;
const COLS = 'id, filters, last_seen_notice_ids, last_alerted_at, total_alerts_sent, forecast_seen_through, forecast_gap_since';
const wantsForecast = (f: any) => !!(f?.horizons && typeof f.horizons === 'object' && f.horizons.forecast === true);

async function all(): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('saved_searches').select(COLS).order('id').range(from, from + 999);
    if (error) throw new Error(`read saved_searches: ${error.message} — is 20260924_saved_search_forecast_watermark.sql applied?`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const openState = (r: any) => JSON.stringify([r.last_seen_notice_ids, r.last_alerted_at, r.total_alerts_sent]);

async function rollback(file: string) {
  const backup = JSON.parse(readFileSync(file, 'utf8')) as { rows: any[] };
  const byId = new Map(backup.rows.map((r) => [r.id, r]));
  const cur = (await all()).filter((r) => byId.has(r.id));
  const changes = cur.filter((r) => r.forecast_seen_through !== byId.get(r.id).forecast_seen_through
    || JSON.stringify(r.forecast_gap_since) !== JSON.stringify(byId.get(r.id).forecast_gap_since));
  console.log(`rollback from ${file}: ${backup.rows.length} backed-up rows, ${changes.length} differ and would be restored${GO ? '' : ' (DRY RUN)'}`);
  if (!GO) return;
  let ok = 0;
  for (const r of changes) {
    const b = byId.get(r.id);
    const { error } = await db.from('saved_searches').update({ forecast_seen_through: b.forecast_seen_through, forecast_gap_since: b.forecast_gap_since }).eq('id', r.id);
    if (error) { console.error(`restore ${r.id}: ${error.message}`); continue; }
    ok++;
  }
  console.log(`restored ${ok}/${changes.length}`);
  if (ok !== changes.length) process.exit(1);
}

(async () => {
  if (ROLLBACK) return rollback(ROLLBACK);
  const rows = (await all()).filter((r) => wantsForecast(r.filters));
  const todo = rows.filter((r) => !r.forecast_seen_through);
  const snap = await readForecastSnapshot(db);
  if ('error' in snap) throw new Error(`snapshot: ${snap.error}`);
  const ctx = contextFor(new Date(snap.snapshot));
  const planned = todo.map((r) => {
    const p = planForecastRun({ seenThrough: null, gapSince: null }, savedSearchForecastRequest(r.filters, ctx).plan, snap.snapshot);
    if (p.mode !== 'baseline') throw new Error(`unexpected plan for ${r.id}`);
    return { id: r.id, next: p.nextState };
  });
  console.log(`Forecast-alerting searches: ${rows.length} · already baselined: ${rows.length - todo.length} · to baseline: ${todo.length}`);
  console.log(`snapshot (DB clock, lagged): ${snap.snapshot}`);
  console.log(`with uncovered buyers (gap boundaries): ${planned.filter((p) => p.next.gapSince).length}`);
  if (!GO) { console.log('DRY RUN — nothing written. Re-run with --go.'); return; }

  mkdirSync('backups', { recursive: true });
  const file = join('backups', `saved-search-forecast-baseline-${snap.snapshot.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ taken_at: new Date().toISOString(), snapshot: snap.snapshot, rows }, null, 1));
  console.log(`backup written: ${file} (${rows.length} rows)`);

  let wrote = 0;
  for (const p of planned) {
    const { error, count } = await db.from('saved_searches')
      .update({ forecast_seen_through: p.next.seenThrough, forecast_gap_since: p.next.gapSince }, { count: 'exact' })
      .eq('id', p.id).is('forecast_seen_through', null);
    if (error) { console.error(`${p.id}: ${error.message}`); continue; }
    if (count === null) { console.error(`${p.id}: write count unknown — verify manually`); continue; }
    wrote += count;
  }
  const after = (await all()).filter((r) => wantsForecast(r.filters));
  const before = new Map(rows.map((r) => [r.id, r]));
  const stillNull = after.filter((r) => !r.forecast_seen_through).length;
  const openChanged = after.filter((r) => before.has(r.id) && openState(r) !== openState(before.get(r.id))).length;
  console.log(`wrote ${wrote}/${planned.length} · still NULL: ${stillNull} · Open state changed on ${openChanged} rows (must be 0 unless a cron ran concurrently)`);
  if (wrote !== planned.length || stillNull !== 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
