/**
 * Where the weekly ingest's action_date window starts.
 *
 * THE BUG THIS REPLACES. The window was `MAX(action_date) − 100 days`, with MAX taken over ALL
 * agencies. Civilian agencies publish within days; DoD publishes on a ~90-day delay. So the
 * global MAX says nothing about where DoD's data actually ends. Measured 2026-09-23: DoD
 * transactions dated 2026-01-25..2026-05-03 (~1.2M rows) were never loaded while the global
 * watermark stayed fresh. The hole's start (2026-01-24 = 2026-04-23 − 89 days) is consistent
 * with the 2026-04-23 bulk snapshot predating DoD's publication of those actions; no later
 * window reached back to them.
 *
 * THE RULE. Start the window at the EARLIER of
 *   - global MAX(action_date) − correctionDays   (FPDS 90-day corrections), and
 *   - each lagging cohort's own DENSE frontier − slackDays   (continuity for the laggard),
 * so a cohort that falls behind is re-pulled from where ITS data stops — bounded by
 * `maxLaggardExtensionDays` (21 by default) so the weekly acquisition stays inside its poll/timeout
 * budget; a deeper gap is reported (`cappedLaggards`) and repaired by the one-time --from backfill.
 * In steady state
 * DoD's frontier ≈ today − 90, so the laggard term (≈ today − 104) and the global term
 * (≈ today − 105) coincide and the download does not grow.
 *
 * What this does NOT do: repair a hole that sits BEFORE the laggard's max (the Jan–May 2026 hole
 * is before DoD's current dense frontier of 2026-06-21). That needs a one-time `--from=` backfill, and
 * `cohort-completeness.ts` is what detects it.
 */

export interface IngestWindowInput {
  /** MAX(action_date) across all rows, 'YYYY-MM-DD'. */
  globalMax: string;
  /** DENSE frontier per lagging cohort (resolveDenseFrontier, e.g. { '097': '2026-06-21' }). null = unmeasured. */
  laggardMaxes: Record<string, string | null>;
  correctionDays: number;
  laggardSlackDays: number;
  /**
   * The most the laggard term may pull the start EARLIER than the global rule. Beyond this the
   * gap is a backfill job, not a weekly window: the weekly run keeps the global start and reports
   * the cohort in `cappedLaggards` (the USASpending acquisition must stay inside the workflow's
   * poll/timeout budget — a 106-day window took ~61 min on 2026-09-20, against a 90-min poll).
   */
  maxLaggardExtensionDays?: number;
}

export interface IngestWindow {
  startDate: string;
  /** Which term set the start: 'global' or 'laggard:<code>'. */
  anchor: string;
  /** Cohorts with no measurable frontier — reported, never silently treated as current. */
  unmeasuredLaggards: string[];
  /** Cohorts whose frontier is further back than `maxLaggardExtensionDays` — needs a manual `--from` backfill. */
  cappedLaggards: string[];
}

export const MAX_LAGGARD_EXTENSION_DAYS = 21;

export const LAGGARD_CONTINUITY_SLACK_DAYS = 14;

/**
 * A lagging cohort's DENSE frontier — NOT its MAX(action_date).
 *
 * MAX is useless for DoD: a trickle of DoD actions is published without the 90-day delay
 * (measured: 300 and 304 DoD rows in the weeks of 2026-08-31 and 2026-09-14 against ~80,000 in a
 * normal week), so DoD's MAX(action_date) was 2026-09-18 — as fresh as the civilian max — while
 * its bulk ended 2026-06-20. The frontier is the END of the latest week whose count reaches
 * `fraction` × the upper quartile of the cohort's settled weeks.
 *
 * Returns null when there is no settled baseline to judge against (unmeasured, never "current").
 */
export function resolveDenseFrontier(
  weeks: Array<{ week: string; n: number }>,
  asOf: string,
  opts: { settleDays?: number; fraction?: number } = {},
): string | null {
  const settleDays = opts.settleDays ?? 120;
  const fraction = opts.fraction ?? 0.25;
  const settledBefore = shift(asOf, -settleDays);
  const settled = weeks.filter((w) => shift(w.week, 6) < settledBefore).map((w) => Number(w.n) || 0).sort((a, b) => a - b);
  if (settled.length < 8) return null;
  // Upper quartile, not median: the baseline must survive the very holes it is looking for
  // (on 2026-09-23, 14 of the trailing settled DoD weeks were a hole).
  const p75 = settled[Math.floor(0.75 * (settled.length - 1))];
  if (!(p75 > 0)) return null;
  const dense = weeks
    .filter((w) => (Number(w.n) || 0) >= fraction * p75)
    .map((w) => w.week)
    .sort();
  const last = dense.pop();
  return last ? shift(last, 6) : null;
}

/** DoD transactions per ISO week (Monday start) over the trailing ~56 weeks ending `asOf`. */
export function buildLaggardWeeklyCountsSql(awardsTable: string, asOf: string, agencyCode: string): string {
  return `
    SELECT CAST(DATE_TRUNC(action_date, WEEK(MONDAY)) AS STRING) AS week, COUNT(*) AS n
    FROM ${awardsTable}
    WHERE action_date BETWEEN DATE_SUB(DATE('${asOf}'), INTERVAL 392 DAY) AND DATE('${asOf}')
      AND awarding_agency_code = '${agencyCode}'
    GROUP BY week
  `;
}

function shift(day: string, deltaDays: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${day}`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function resolveIngestWindowStart(input: IngestWindowInput): IngestWindow {
  let startDate = shift(input.globalMax, -input.correctionDays);
  let anchor = 'global';
  const globalStart = startDate;
  const cap = input.maxLaggardExtensionDays ?? MAX_LAGGARD_EXTENSION_DAYS;
  const floor = shift(globalStart, -cap);
  const unmeasuredLaggards: string[] = [];
  const cappedLaggards: string[] = [];
  for (const [code, max] of Object.entries(input.laggardMaxes)) {
    if (!max) {
      unmeasuredLaggards.push(code);
      continue;
    }
    const candidate = shift(max, -input.laggardSlackDays);
    if (candidate < floor) {
      cappedLaggards.push(code);
      continue;
    }
    if (candidate < startDate) {
      startDate = candidate;
      anchor = `laggard:${code}`;
    }
  }
  return { startDate, anchor, unmeasuredLaggards, cappedLaggards };
}
