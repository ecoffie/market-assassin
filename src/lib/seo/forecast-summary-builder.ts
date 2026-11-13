/**
 * Builds the /forecasts summary from Supabase `agency_forecasts` (zero BigQuery).
 *
 * Shared by the manual script (scripts/build-forecast-summary.ts) and the scheduled
 * materializer (/api/cron/seo-materialize). It used to live only in the script, so nothing ran
 * it on a schedule: the summary aged past its 14-day window, then expired, and /forecasts sat in
 * its noindexed "unavailable" state (found 2026-11-12: KV key absent).
 *
 * `total` is an authoritative COUNT; if the rows read do not add up to it, the summary is marked
 * `truncated` and the page refuses to publish it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FORECAST_SUMMARY_VERSION,
  type StoredForecastSummary,
  type Tally,
} from './forecasts-summary';

const PAGE = 1000;
/** Hard ceiling. Exceeding it sets `truncated` rather than silently undercounting. */
export const FORECAST_MAX_ROWS = 80_000;
/** TTL comfortably longer than the page's 14-day staleness window, so KV never expires first. */
export const FORECAST_SUMMARY_TTL_SECONDS = 30 * 24 * 60 * 60;

interface Row {
  source_agency: string | null;
  bureau: string | null;
  naics_code: string | null;
  naics_description: string | null;
  fiscal_year: string | null;
  set_aside_type: string | null;
  source_type: string | null;
  last_synced_at: string | null;
}

export function tally(
  rows: Row[],
  keyOf: (r: Row) => string | null,
  labelOf: (r: Row) => string | null,
  limit: number,
): Tally[] {
  const m = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const cur = m.get(k);
    if (cur) cur.count++;
    else m.set(k, { label: labelOf(r) || k, count: 1 });
  }
  return [...m.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** Read everything and return the summary. Throws if the authoritative count cannot be read. */
export async function buildForecastSummary(
  db: SupabaseClient,
  log: (msg: string) => void = () => {},
): Promise<StoredForecastSummary> {
  const { count, error: countErr } = await db
    .from('agency_forecasts')
    .select('*', { count: 'exact', head: true });
  if (countErr || count == null) {
    throw new Error(`forecast count failed: ${countErr?.message ?? 'no count returned'}`);
  }
  log(`authoritative total: ${count.toLocaleString()}`);

  const rows: Row[] = [];
  let truncated = false;
  for (let from = 0; ; from += PAGE) {
    if (from >= FORECAST_MAX_ROWS) {
      truncated = true;
      log(`hit MAX_ROWS=${FORECAST_MAX_ROWS}, marking truncated`);
      break;
    }
    const { data, error } = await db
      .from('agency_forecasts')
      .select(
        'source_agency, bureau, naics_code, naics_description, fiscal_year, set_aside_type, source_type, last_synced_at',
      )
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      log(`read failed at offset ${from}: ${error.message}, marking truncated`);
      truncated = true;
      break;
    }
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  log(`rows transferred: ${rows.length.toLocaleString()}`);
  // The decisive check: did we actually see everything the table says exists?
  if (rows.length !== count) {
    truncated = true;
    log(`transferred ${rows.length} but table reports ${count}, marking truncated`);
  }

  let lastSynced: string | null = null;
  for (const r of rows) {
    if (r.last_synced_at && (!lastSynced || r.last_synced_at > lastSynced)) lastSynced = r.last_synced_at;
  }

  return {
    version: FORECAST_SUMMARY_VERSION,
    builtAt: new Date().toISOString(),
    total: count,
    truncated,
    agencies: tally(rows, (r) => r.bureau || r.source_agency, (r) => r.bureau || r.source_agency, 40),
    naics: tally(rows, (r) => r.naics_code, (r) => r.naics_description || r.naics_code, 25),
    fiscalYears: tally(rows, (r) => r.fiscal_year, (r) => r.fiscal_year, 8),
    setAsides: tally(rows, (r) => r.set_aside_type, (r) => r.set_aside_type, 12),
    sources: tally(rows, (r) => r.source_type, (r) => r.source_type, 8),
    lastSynced,
  };
}
