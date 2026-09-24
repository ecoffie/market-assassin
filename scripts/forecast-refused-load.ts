/**
 * Refused forecast loads — list and replay what the daily-sync breaker held back.
 * Record: tasks/saved-search-forecast-watermark-2026-09-24.md · lib: src/lib/forecasts/writer.ts
 *
 *   npx tsx --env-file=.env.local scripts/forecast-refused-load.ts --list
 *   npx tsx --env-file=.env.local scripts/forecast-refused-load.ts --replay <id> --reason "…" [--go]
 *
 * A daily writer that would create more than DAILY_SYNC_MAX_NEW_ROWS new rows for a publisher with an active floor
 * writes ZERO new rows, saves the full payload to forecast_refused_loads and alerts operations. Nothing about that
 * interval is skipped: this script replays the payload through runPublisherBackfill (suspend → verify suspended →
 * load → reconcile), leaving the publisher SUSPENDED. Activation is a separate, explicit decision:
 *
 *   treat the bulk as historical (no alerts):  forecast-publisher-floor.ts --activate <CODE> --after last
 *   treat the bulk as genuinely new (alerts):  forecast-publisher-floor.ts --activate <CODE> --after <prior floor>
 *
 * Replay is INSERT-ONLY (ignoreDuplicates): it never overwrites a row that exists, so replaying an old payload
 * cannot roll content back. Updates to existing rows resume with the next daily sync.
 * DRY RUN unless --go.
 */
import { createClient } from '@supabase/supabase-js';
import { runPublisherBackfill } from '@/lib/forecasts/alert-floor';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const a = process.argv.slice(2);
const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const GO = a.includes('--go');
const SET_BY = process.env.USER ? `operator:${process.env.USER}` : 'operator';

type Row = Record<string, unknown> & { external_id?: unknown };

(async () => {
  if (a.includes('--list')) {
    const { data, error } = await db.from('forecast_refused_loads')
      .select('id, source_agency, refused_at, reason, new_row_count, resolved_at, resolution')
      .order('refused_at', { ascending: false }).range(0, 199);
    if (error) throw new Error(`${error.message} — is 20260924_saved_search_forecast_watermark.sql applied?`);
    console.table(data);
    return;
  }
  const id = val('--replay');
  const reason = val('--reason');
  if (!id || !reason) { console.log('usage: --list | --replay <id> --reason "…" [--go]'); process.exit(1); }

  const { data: load, error } = await db.from('forecast_refused_loads')
    .select('id, source_agency, reason, new_row_count, rows, resolved_at').eq('id', id).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!load) throw new Error(`no refused load ${id}`);
  if (load.resolved_at) throw new Error(`load ${id} already resolved at ${load.resolved_at}`);
  const rows = (load.rows ?? []) as Row[];
  const source = String(load.source_agency);
  if (rows.some((r) => String(r.source_agency) !== source || !r.external_id)) throw new Error('payload has rows for another publisher or without external_id — refusing');
  const ids = [...new Set(rows.map((r) => String(r.external_id)))];
  console.log(`${source}: ${rows.length} payload rows, ${ids.length} distinct ids, breaker reason: ${load.reason}`);
  if (!GO) { console.log('DRY RUN — would suspend, insert-only replay, reconcile, and leave the publisher SUSPENDED'); return; }

  const out = await runPublisherBackfill(db, source, `refused-load replay ${id}: ${reason}`, SET_BY,
    async () => {
      let written = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const { error: e } = await db.from('agency_forecasts')
          .upsert(rows.slice(i, i + 500), { onConflict: 'source_agency,external_id', ignoreDuplicates: true });
        if (e) throw new Error(`replay insert failed at ${i}: ${e.message}`);
        written += Math.min(500, rows.length - i);
      }
      return written;
    },
    async () => {
      // Every payload id must now exist — read back, never inferred from the write.
      let present = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error: e } = await db.from('agency_forecasts').select('external_id')
          .eq('source_agency', source).in('external_id', ids.slice(i, i + 200)).limit(1000);
        if (e) return { ok: false, detail: e.message };
        present += (data ?? []).length;
      }
      return present === ids.length ? { ok: true } : { ok: false, detail: `${present}/${ids.length} payload ids present` };
    });
  const { error: re } = await db.from('forecast_refused_loads')
    .update({ resolved_at: new Date().toISOString(), resolution: `replayed by ${SET_BY}: ${reason}` }).eq('id', id);
  if (re) console.error(`replayed, but marking the load resolved failed: ${re.message}`);
  console.log(`✓ ${source} replayed and reconciled — state=${out.state}; proposed floor (historical) = ${out.proposedFloor}`);
  console.log('  Next: activate explicitly with scripts/forecast-publisher-floor.ts (see header).');
})().catch((e) => { console.error(e); process.exit(1); });
