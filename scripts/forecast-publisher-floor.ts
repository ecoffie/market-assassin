/**
 * Publisher alert floor management — the ONLY operator path that moves a floor.
 * Record: tasks/saved-search-forecast-watermark-2026-09-24.md · lib: src/lib/forecasts/alert-floor.ts
 *
 *   npx tsx --env-file=.env.local scripts/forecast-publisher-floor.ts --status
 *   npx tsx --env-file=.env.local scripts/forecast-publisher-floor.ts --seed [--go]
 *       seed a floor for every publisher present in agency_forecasts at its last created_at (never overwrites)
 *   npx tsx --env-file=.env.local scripts/forecast-publisher-floor.ts --suspend <CODE> --reason "…" [--go]
 *   npx tsx --env-file=.env.local scripts/forecast-publisher-floor.ts --activate <CODE> --after <ISO|last> --reason "…" [--go] [--allow-rewind]
 *
 * DRY RUN unless --go. Every write also appends forecast_publisher_alert_floor_log.
 * Historical onboarding/backfill code should call runPublisherBackfill() instead (suspend → load → activate).
 */
import { createClient } from '@supabase/supabase-js';
import { applyFloorChange, publisherLastCreatedAt, type FloorChange } from '@/lib/forecasts/alert-floor';
import { FORECAST_SOURCE_AGENCY_CODES } from '@/lib/forecasts/agency-identity';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const a = process.argv.slice(2);
const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const GO = a.includes('--go');
const SET_BY = process.env.USER ? `operator:${process.env.USER}` : 'operator';

(async () => {
  if (a.includes('--status')) {
    const { data, error } = await db.from('forecast_publisher_alert_floor').select('source_agency, state, alertable_after, reason, set_by, updated_at').order('source_agency').range(0, 999);
    if (error) throw new Error(`${error.message} — is 20260924_saved_search_forecast_watermark.sql applied?`);
    console.table(data);
    return;
  }
  const changes: FloorChange[] = [];
  if (a.includes('--seed')) {
    for (const code of FORECAST_SOURCE_AGENCY_CODES) {
      const last = await publisherLastCreatedAt(db, code);
      if ('error' in last) throw new Error(`${code}: ${last.error}`);
      if (!last.at) { console.log(`${code}: no rows held — no floor (fail closed until onboarded)`); continue; }
      changes.push({ kind: 'seed', source_agency: code, alertable_after: last.at, reason: 'cutover seed: every row held at cutover is historical', set_by: SET_BY });
    }
  }
  const sus = val('--suspend');
  if (sus) changes.push({ kind: 'suspend', source_agency: sus, reason: val('--reason') ?? '', set_by: SET_BY });
  const act = val('--activate');
  if (act) {
    let after = val('--after') ?? '';
    if (after === 'last') {
      const last = await publisherLastCreatedAt(db, act);
      if ('error' in last || !last.at) throw new Error(`${act}: cannot read last created_at`);
      after = last.at;
    }
    changes.push({ kind: 'activate', source_agency: act, alertable_after: after, reason: val('--reason') ?? '', set_by: SET_BY, allowRewind: a.includes('--allow-rewind') });
  }
  if (!changes.length) { console.log('nothing to do — see the header for usage'); return; }
  let failed = 0;
  for (const c of changes) {
    const r = await applyFloorChange(db, c, { dryRun: !GO });
    if (!r.ok) { failed++; console.error(`✗ ${c.source_agency}: ${r.error}`); continue; }
    console.log(`${r.noop ? '·' : GO ? '✓' : '○'} ${c.kind} ${c.source_agency} → ${r.next.state} ${r.next.alertable_after ?? ''}${r.noop ? ' (no change)' : GO ? '' : ' (DRY RUN)'}`);
  }
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
