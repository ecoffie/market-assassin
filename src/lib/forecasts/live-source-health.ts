/**
 * FORECAST SOURCE HEALTH, DERIVED FROM LIVE DATA — Phase II, Potato 2D-A.
 *
 * ⚠️ WHY THIS EXISTS. `check-fms-health` judged every forecast source from the
 * `forecast_sources` CONFIG table. Measured 2026-09-13, that table is ABANDONED and
 * contradicts reality on every row:
 *     total_records = 0 on all 11 rows      … against 33,687 real forecast rows
 *     DHS  is_active = false                … while it writes every single day
 *     DOE  last_sync_at = 2026-04-06        … while it wrote today
 *     11 rows                               … against 30 real (agency, source_type) pairs
 * The live `sync-forecasts` cron never writes it. So forecast health has been
 * evaluated against April data since April, and a working source could be reported
 * `critical` purely because a config row was never updated.
 *
 * THE FIX IS THE AUTHORITY, NOT THE TABLE. We do NOT repopulate `forecast_sources`
 * to make it look current — that would launder a stale registry into a fresh-looking
 * one and re-create the same defect the next time someone stops maintaining it.
 * Health is derived from the FORECAST ROWS THEMSELVES, which cannot go stale
 * without the data going stale.
 *
 * `forecast_sources` keeps its legitimate CONFIG role (source_url, scraper_config,
 * sync_frequency) for the admin/setup path. It is simply no longer health truth.
 *
 * ⚠️ DISPOSITION IS NOT FAILURE. A BLOCKED / SUPERSEDED / RETIRED source has no
 * scheduled collector on purpose (Potato 2C: 11 blocked by login/WAF, 8 superseded,
 * 2 retired). Reporting those as `critical` would be 21 false alarms. Only a source
 * we actually intend to poll can be unhealthy.
 */
import type { SourceStage } from './source-policy';

/** What Potato 2C decided about each source, with evidence. */
export type ForecastDisposition =
  | 'living'            // scheduled and expected to advance
  | 'ready_to_activate' // producer verified against live upstream; not yet scheduled
  | 'blocked'           // login / WAF / external dependency
  | 'superseded'        // another canonical source replaced it
  | 'retired'           // no longer published or no product value
  | 'repair_required'   // upstream exists, producer broken
  | 'unmeasured';       // evidence still insufficient

/** One source's LIVE evidence, read from agency_forecasts — never from config. */
export interface LiveSourceEvidence {
  agency: string;
  sourceType: string;
  /** Rows currently attributed to this source pair. */
  rows: number;
  /** Newest write Mindy made for this pair. NOT an upstream watermark. */
  lastWriteAt: string | null;
  disposition: ForecastDisposition;
  stage?: SourceStage;
}

export type LiveHealthStatus = 'healthy' | 'warning' | 'critical' | 'not_applicable';

export interface LiveSourceHealth {
  key: string;
  status: LiveHealthStatus;
  rows: number;
  lastWriteDaysAgo: number | null;
  disposition: ForecastDisposition;
  reasons: string[];
}

/** Only these dispositions are EXPECTED to advance; the rest are deliberate. */
const EXPECTED_TO_ADVANCE = new Set<ForecastDisposition>(['living']);

export const WARN_DAYS = 3;
export const CRITICAL_DAYS = 7;

function daysSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86_400_000)) : null;
}

export function evaluateLiveSource(e: LiveSourceEvidence, now = new Date().toISOString()): LiveSourceHealth {
  const key = `${e.agency}|${e.sourceType}`;
  const lastWriteDaysAgo = daysSince(e.lastWriteAt, Date.parse(now));
  const reasons: string[] = [];

  // A source we do not intend to poll cannot be "unhealthy". It is dispositioned.
  if (!EXPECTED_TO_ADVANCE.has(e.disposition)) {
    return {
      key, status: 'not_applicable', rows: e.rows, lastWriteDaysAgo, disposition: e.disposition,
      reasons: [`${e.disposition} — no scheduled collector by decision; ${e.rows} historical row(s) retained`],
    };
  }

  let status: LiveHealthStatus = 'healthy';
  if (lastWriteDaysAgo === null) {
    status = 'critical';
    reasons.push('living source has never written');
  } else if (lastWriteDaysAgo > CRITICAL_DAYS) {
    status = 'critical';
    reasons.push(`last write ${lastWriteDaysAgo}d ago`);
  } else if (lastWriteDaysAgo > WARN_DAYS) {
    status = 'warning';
    reasons.push(`last write ${lastWriteDaysAgo}d ago`);
  }

  // Rows come from the DATA, so a living source holding zero is a real signal —
  // unlike `forecast_sources.total_records`, which said 0 for everything.
  if (e.rows === 0 && status === 'healthy') {
    status = 'warning';
    reasons.push('living source holds no rows');
  }

  if (!reasons.length) reasons.push(`${e.rows} row(s); last write ${lastWriteDaysAgo}d ago`);
  return { key, status, rows: e.rows, lastWriteDaysAgo, disposition: e.disposition, reasons };
}

export interface LiveForecastHealth {
  status: 'healthy' | 'warning' | 'critical';
  sources: LiveSourceHealth[];
  totalRows: number;
  livingCount: number;
  dispositionedCount: number;
  detail: string;
}

/**
 * Dataset rollup. The worst LIVING source decides — a dispositioned source can
 * never drag it down, and no single healthy source can lift it.
 */
export function rollupLiveForecastHealth(sources: LiveSourceHealth[]): LiveForecastHealth {
  const living = sources.filter((s) => s.disposition === 'living');
  const totalRows = sources.reduce((n, s) => n + s.rows, 0);
  const critical = living.filter((s) => s.status === 'critical');
  const warning = living.filter((s) => s.status === 'warning');

  const status = critical.length ? 'critical' : warning.length ? 'warning' : 'healthy';
  return {
    status, sources, totalRows,
    livingCount: living.length,
    dispositionedCount: sources.length - living.length,
    detail: critical.length
      ? `${critical.length} living source(s) critical: ${critical.map((s) => s.key).join(', ')}`
      : warning.length
        ? `${warning.length} living source(s) warning: ${warning.map((s) => s.key).join(', ')}`
        : `${living.length} living source(s) healthy; ${sources.length - living.length} dispositioned; ${totalRows} row(s) total`,
  };
}
