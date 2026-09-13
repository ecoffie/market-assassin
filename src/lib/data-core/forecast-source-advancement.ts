/**
 * FORECAST PER-SOURCE ADVANCEMENT — Phase II, Potato 2.
 *
 * THE MASKING FAILURE, measured live 2026-09-13:
 *   30 (source_agency, source_type) pairs hold forecast rows.
 *   TWO wrote today (DHS, DOE). TWENTY-EIGHT are frozen 30+ days.
 *   NAVY — the LARGEST source at 8,821 rows — has not written since 2026-08-01.
 *   Yet the dataset aggregate MAX(last_synced_at) reads 2026-09-13, because two
 *   live sources drag the maximum forward. USDA advancing hides Navy dead.
 *
 * ⚠️ FROZEN IS NOT AUTOMATICALLY BROKEN. `sync-forecasts` deliberately runs only
 * DHS + DOE. Its header documents why: HHS is a login-gated SPA, VA/DOT migrated
 * behind the GSA Gateway login, USACE sits behind an Akamai WAF, and
 * DOI/USDA/DOJ/GSA/DOL/NASA had rotted Puppeteer scrapers. Those were left
 * UNSCHEDULED on purpose, precisely so they would not "succeed" while importing
 * nothing. A source nobody polls is NOT_POLLED — an honest, deliberate state —
 * and calling it `ingest_broken` would be a false alarm.
 *
 * ⚠️ last_synced_at IS MINDY'S WRITE TIME, NOT AN UPSTREAM WATERMARK. No forecast
 * source exposes a defensible publication clock in what we store, so
 * LAST SOURCE ADVANCE is `unmeasured` for every source. We do not manufacture
 * freshness from a write timestamp.
 *
 * C1 vocabulary is reused; `not_polled` is the single addition, and it exists
 * because a REAL source population demonstrated the need — 28 of 30 pairs.
 */
import type { AdvancementStatus } from './advancement';

export type ForecastSourceStatus =
  | 'advancing'       // polled, and its stored population changed
  | 'upstream_quiet'  // polled successfully; nothing new upstream
  | 'not_polled'      // deliberately unscheduled — honest, not a fault
  | 'ingest_broken'   // polled (or scheduled) but the destination did not advance
  | 'unmeasured';     // cannot distinguish the above

export interface ForecastSourceEvidence {
  agency: string;
  sourceType: string;
  /** Rows currently attributed to this source. Zero is a measured population, not a diagnosis. */
  rows: number;
  /** Newest write Mindy made for this source. NOT an upstream watermark. */
  lastWriteAt: string | null;
  /** Is this source attempted by a scheduled job at all? */
  scheduled: boolean;
  /** Did the most recent attempt fail outright? */
  lastAttemptFailed?: boolean;
  /** Did this source's stored population change on the most recent poll? */
  populationChanged?: boolean | null;
}

export interface ForecastSourceResult {
  key: string;
  status: ForecastSourceStatus;
  c1Equivalent: AdvancementStatus;
  /** Days since Mindy last wrote for this source. Null when never written. */
  writeAgeDays: number | null;
  /** ALWAYS null today: no forecast source exposes a publication clock we store. */
  sourceAdvanceAgeDays: null;
  detail: string;
}

/** Beyond this, a SCHEDULED source that has not written is a real concern. */
export const SCHEDULED_STALE_DAYS = 7;

function ageDays(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86_400_000)) : null;
}

export function classifyForecastSource(
  e: ForecastSourceEvidence,
  now: string = new Date().toISOString(),
): ForecastSourceResult {
  const key = `${e.agency}|${e.sourceType}`;
  const nowMs = Date.parse(now);
  const writeAgeDays = ageDays(e.lastWriteAt, nowMs);
  const base = { key, sourceAdvanceAgeDays: null as null, writeAgeDays };

  if (e.lastAttemptFailed) {
    return { ...base, status: 'ingest_broken', c1Equivalent: 'ingest_broken',
      detail: 'the most recent collection attempt failed' };
  }

  // NOT POLLED: nobody attempts this source. Honest and deliberate — never "broken".
  if (!e.scheduled) {
    return { ...base, status: 'not_polled', c1Equivalent: 'unmeasured',
      detail: e.rows > 0
        ? `${e.rows} row(s) held from a past manual/one-off import; no scheduled collector attempts this source`
        : 'no scheduled collector attempts this source and it holds no rows' };
  }

  // Scheduled but never wrote -> we cannot tell quiet from broken.
  if (writeAgeDays === null) {
    return { ...base, status: 'unmeasured', c1Equivalent: 'unmeasured',
      detail: 'scheduled, but no write has ever been recorded for this source' };
  }

  // Scheduled and silent for longer than the budget -> the destination is not advancing.
  if (writeAgeDays > SCHEDULED_STALE_DAYS) {
    return { ...base, status: 'ingest_broken', c1Equivalent: 'ingest_broken',
      detail: `scheduled, but no write in ${writeAgeDays}d (budget ${SCHEDULED_STALE_DAYS}d)` };
  }

  if (e.populationChanged === true) {
    return { ...base, status: 'advancing', c1Equivalent: 'healthy',
      detail: `wrote ${writeAgeDays}d ago and its stored population changed` };
  }
  return { ...base, status: 'upstream_quiet', c1Equivalent: 'healthy',
    detail: `polled ${writeAgeDays}d ago; stored population unchanged` };
}

export interface ForecastRollup {
  status: 'healthy' | 'degraded' | 'incomplete';
  counts: Record<ForecastSourceStatus, number>;
  /** Sources that must be named wherever the dataset status is shown. */
  attention: string[];
  detail: string;
}

/**
 * Dataset rollup — NOT an average, NOT a percentage, NOT a max timestamp.
 *
 * Forecasts stays ONE logical dataset; its status DERIVES from source states:
 *   any ingest_broken            -> degraded  (a dead source can never be hidden)
 *   else any unmeasured/not_polled -> incomplete (the gap is disclosed, not averaged away)
 *   else                         -> healthy
 */
export function rollupForecastSources(results: ForecastSourceResult[]): ForecastRollup {
  const counts: Record<ForecastSourceStatus, number> = {
    advancing: 0, upstream_quiet: 0, not_polled: 0, ingest_broken: 0, unmeasured: 0,
  };
  for (const r of results) counts[r.status] += 1;

  const broken = results.filter((r) => r.status === 'ingest_broken').map((r) => r.key);
  if (broken.length) {
    return { status: 'degraded', counts, attention: broken,
      detail: `${broken.length} source(s) scheduled but not advancing: ${broken.slice(0, 5).join(', ')}` };
  }
  const opaque = results.filter((r) => r.status === 'unmeasured' || r.status === 'not_polled').map((r) => r.key);
  if (opaque.length) {
    return { status: 'incomplete', counts, attention: opaque,
      detail: `${opaque.length} source(s) are not polled or not measurable — dataset freshness is partial` };
  }
  return { status: 'healthy', counts, attention: [],
    detail: `all ${results.length} source(s) polled and accounted for` };
}
