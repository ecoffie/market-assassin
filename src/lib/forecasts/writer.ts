/**
 * Forecast WRITERS and the backfill-safety contract (2026-09-24).
 * Record: tasks/saved-search-forecast-watermark-2026-09-24.md §4b
 *
 * A row INSERTED into agency_forecasts gets created_at = now(), which is exactly what the saved-search watermark
 * treats as "new". So creating rows is only safe when either
 *   (a) it is the ordinary DAILY SYNC adding genuinely new records (small, bounded — guardForecastInserts), or
 *   (b) the publisher's alert floor is SUSPENDED (historical onboarding / backfill → runPublisherBackfill).
 *
 * Enforcement, strongest first:
 *   1. DATABASE — trigger `agency_forecasts_floor_guard` (migration 20260924_saved_search_forecast_watermark.sql)
 *      refuses to CREATE a row for a publisher whose floor is ACTIVE unless the writer declared itself the daily
 *      sync (PostgREST header `x-forecast-writer: daily_sync`, or `SET LOCAL app.forecast_writer = 'daily_sync'`).
 *      It covers every path, including the JS scripts and psql. Updates to existing rows are never refused.
 *   2. APP — the daily sync declares itself only through forecastWriterClient('daily_sync'), and only the files in
 *      DAILY_SYNC_WRITERS may do so (writer.unit.test.ts scans the repo). Its new-row volume per publisher per run is
 *      capped by guardForecastInserts: a daily sync that suddenly creates hundreds of rows is a re-key or a bulk
 *      publication, and it must go through a backfill instead of alerting everyone.
 */
import { createClient } from '@supabase/supabase-js';

export const FORECAST_WRITER_HEADER = 'x-forecast-writer';
export type ForecastWriterKind = 'daily_sync' | 'backfill';

/** The only files allowed to declare `daily_sync` (pinned by writer.unit.test.ts). */
export const DAILY_SYNC_WRITERS = [
  'src/app/api/cron/sync-forecasts/route.ts',
  'src/app/api/cron/hhs-forecast-sync/route.ts',
  'src/app/api/cron/doj-forecast-sync/route.ts',
  'src/app/api/cron/nasa-forecast-sync/route.ts',
  'src/app/api/cron/ssa-forecast-sync/route.ts',
] as const;

/**
 * Max NEW rows one daily sync may create for one publisher whose floor is ACTIVE. Measured 2026-09-24: DHS, the only
 * publisher with a daily history (45 days), creates median 17 / p90 44 / max 759 rows a day — the 759 is its first
 * load. 500 approved as the initial breaker 2026-09-24; exceeding it is all-or-nothing + quarantine (applyInsertGuard).
 */
export const DAILY_SYNC_MAX_NEW_ROWS = 500;

/** A service client that declares which kind of forecast writer it is (read by the DB guard). */
export function forecastWriterClient(kind: ForecastWriterKind) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    global: { headers: { [FORECAST_WRITER_HEADER]: kind } },
  });
}

export type InsertGuard = { allow: true; reason: string } | { allow: false; reason: string };

/**
 * May the DAILY SYNC create `newRows` rows for `source` now?
 *   floor table absent (pre-migration)  → allow (legacy behaviour, nothing is alertable yet)
 *   no floor row / floor suspended       → allow (rows are not alertable: fail-closed floor)
 *   floor active, newRows ≤ limit        → allow (ordinary new publications)
 *   floor active, newRows > limit        → REFUSE (route it through runPublisherBackfill)
 *   floor read failed                    → REFUSE (never guess toward an alert burst)
 */
export async function guardForecastInserts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, source: string, newRows: number, limit: number = DAILY_SYNC_MAX_NEW_ROWS,
): Promise<InsertGuard> {
  if (newRows <= 0) return { allow: true, reason: 'no new rows' };
  const { data, error } = await db.from('forecast_publisher_alert_floor').select('state').eq('source_agency', source).limit(1).maybeSingle();
  if (error) {
    const msg = `${error.code ?? ''} ${error.message ?? ''}`;
    if (/42P01|PGRST205|forecast_publisher_alert_floor|does not exist|schema cache/i.test(msg)) return { allow: true, reason: 'floor table absent (pre-migration)' };
    return { allow: false, reason: `floor read failed: ${error.message}` };
  }
  if (!data || data.state === 'suspended') return { allow: true, reason: data ? 'floor suspended' : 'no floor (not alertable)' };
  if (newRows <= limit) return { allow: true, reason: `${newRows} new ≤ ${limit}` };
  return {
    allow: false,
    reason: `${source}: daily sync would create ${newRows} new rows (> ${limit}) while the publisher alert floor is ACTIVE — `
      + 'treat it as a historical/bulk load: scripts/forecast-publisher-floor.ts --suspend, load, reconcile, --activate',
  };
}

/** How many of `externalIds` do NOT yet exist for `source` (the rows an upsert would CREATE). */
export async function countNewForecastRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, source: string, externalIds: string[],
): Promise<{ newRows: number } | { error: string }> {
  const ids = [...new Set(externalIds.filter(Boolean))];
  let existing = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('agency_forecasts').select('external_id').eq('source_agency', source).in('external_id', ids.slice(i, i + 200)).limit(1000);
    if (error) return { error: error.message };
    existing += (data ?? []).length;
  }
  return { newRows: ids.length - existing };
}

/**
 * The ONE place a daily writer decides which NEW rows it may create. All-or-nothing per publisher:
 *   allowed  → every new row is returned to be inserted
 *   refused  → NOTHING is returned (no partial insert of earlier pages/batches is possible, because the decision is
 *              made over the full new-row set before the first write), the complete payload is quarantined in
 *              forecast_refused_loads for replay (scripts/forecast-refused-load.ts), and the caller must fail the run
 *              and alert operations. Updates to existing rows are unaffected.
 * A quarantine write failure is reported — the run is failing anyway, and the source still holds the rows.
 */
export async function applyInsertGuard<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, source: string, newRows: T[],
): Promise<{ allowed: T[]; refused: null } | { allowed: []; refused: { reason: string; quarantined: boolean; quarantineError?: string } }> {
  const g = await guardForecastInserts(db, source, newRows.length);
  if (g.allow) return { allowed: newRows, refused: null };
  const q = await quarantineRefusedLoad(db, source, g.reason, newRows.length, newRows);
  return { allowed: [], refused: { reason: g.reason, ...q } };
}

/**
 * Save a refused load so the publisher's interval is never silently skipped: the rows stay replayable from here
 * (scripts/forecast-refused-load.ts) even if the upstream file changes before the backfill runs. `rows` may be the
 * whole publisher payload (sync-forecasts holds back updates too); `newRowCount` is what tripped the breaker.
 */
export async function quarantineRefusedLoad(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, source: string, reason: string, newRowCount: number, rows: unknown[],
): Promise<{ quarantined: boolean; quarantineError?: string }> {
  const { error } = await db.from('forecast_refused_loads').insert({
    source_agency: source, reason, new_row_count: newRowCount, rows,
  });
  return error ? { quarantined: false, quarantineError: error.message } : { quarantined: true };
}

