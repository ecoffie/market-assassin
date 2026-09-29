/**
 * Escalation rules. Pure functions over stored history. Nothing escalates on a single
 * observation: every rule needs the same signal across multiple runs or days.
 *
 *   url_persistent        one URL, same our-side failure class in >= 2 of its last 3 crawls
 *   canary_down           a canary failing our-side checks in THIS run and the preceding completed run
 *   stratum_failures      a stratum's crawl failure rate > 5% (min 20 URLs) in this run AND the previous run
 *   gsc_stratum_drop      a stratum's Search Console impressions > 40% below its baseline for 3
 *                         consecutive MATURE calendar days (see stratumImpressionDrop)
 *   google_indexed_drop   within ONE stratum, Google's indexed share of inspected URLs fell
 *                         > 10 points, last 7 days vs the 7 before (>= 50 inspections each)
 *
 * Google's indexing decisions are compared only within a stratum. A global indexed share
 * would move whenever the mix of page types in the sample moves.
 */
import { CRAWL_FAILURES, type CrawlOutcome, type Outcome, type Stratum } from './types';

export const URL_PERSIST = { window: 3, minHits: 2 };
export const STRATUM_FAILURE_RATE = 0.05;
export const STRATUM_MIN_SAMPLE = 20;
export const GSC_DROP = { ratio: 0.4, recentDays: 3, baselineDays: 28, minBaselinePerDay: 20, lagDays: 3 };
export const INDEXED_DROP = { points: 0.1, windowDays: 7, minPerWindow: 50 };

export interface Escalation {
  rule: 'url_persistent' | 'canary_down' | 'stratum_failures' | 'gsc_stratum_drop' | 'google_indexed_drop';
  severity: 'warning' | 'critical';
  key: string;
  message: string;
  evidence: Record<string, unknown>;
}

export interface CheckHistoryRow {
  url: string;
  outcome: Outcome;
  checked_at: string;
}

const isCrawlFailure = (o: Outcome) => CRAWL_FAILURES.has(o as CrawlOutcome);
const DAY_MS = 86_400_000;
const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** history: crawl checks for the URLs of interest, any order, including this run. */
export function urlPersistent(history: CheckHistoryRow[]): Escalation[] {
  const byUrl = new Map<string, CheckHistoryRow[]>();
  for (const r of history) {
    const list = byUrl.get(r.url) ?? [];
    list.push(r);
    byUrl.set(r.url, list);
  }
  const out: Escalation[] = [];
  for (const [url, rows] of byUrl) {
    const recent = rows.sort((a, b) => b.checked_at.localeCompare(a.checked_at)).slice(0, URL_PERSIST.window);
    const counts = new Map<Outcome, number>();
    for (const r of recent) if (isCrawlFailure(r.outcome)) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
    for (const [outcome, n] of counts) {
      if (n >= URL_PERSIST.minHits) {
        out.push({ rule: 'url_persistent', severity: 'warning', key: `${url}|${outcome}`, message: `${outcome} on ${n} of the last ${recent.length} crawls`, evidence: { url, outcome, hits: n, window: recent.length } });
      }
    }
  }
  return out;
}

/**
 * Canary failing in THIS run and in the immediately preceding completed run.
 * `current` is this run's canary checks (the run is still in progress, so it is passed in,
 * not read back from storage); `previous` is the last run that finished ok/partial before it,
 * or null when there is none. A failure today after a pass yesterday, or a recovery today
 * after a failure yesterday, does not escalate.
 */
export function canaryDown(current: Record<string, Outcome>, previous: Record<string, Outcome> | null): Escalation[] {
  if (!previous) return [];
  return Object.entries(current)
    .filter(([url, o]) => isCrawlFailure(o) && previous[url] !== undefined && isCrawlFailure(previous[url]))
    .map(([url, o]) => ({ rule: 'canary_down' as const, severity: 'critical' as const, key: url, message: `canary failing in this run and the previous completed run (${previous[url]} then ${o})`, evidence: { url, now: o, previous: previous[url] } }));
}

export interface StratumRate { total: number; failures: number }

/** Per-stratum crawl failure counts for this run and the previous run. */
export function stratumFailures(now: Partial<Record<Stratum, StratumRate>>, prev: Partial<Record<Stratum, StratumRate>> | null): Escalation[] {
  if (!prev) return [];
  const bad = (r?: StratumRate) => !!r && r.total >= STRATUM_MIN_SAMPLE && r.failures / r.total > STRATUM_FAILURE_RATE;
  return (Object.keys(now) as Stratum[])
    .filter((s) => bad(now[s]) && bad(prev[s]))
    .map((s) => ({
      rule: 'stratum_failures' as const,
      severity: 'warning' as const,
      key: s,
      message: `${s}: ${(100 * now[s]!.failures / now[s]!.total).toFixed(1)}% of crawled URLs failing, 2 runs in a row`,
      evidence: { now: now[s], previous: prev[s] },
    }));
}

/** The last mature day: Search Console data for more recent days is still filling in. */
export function matureEndDay(nowMs: number, lagDays = GSC_DROP.lagDays): string {
  return dayStr(nowMs - lagDays * DAY_MS);
}

/** Calendar days (YYYY-MM-DD, UTC) ending at `endDay`, oldest first. */
export function calendar(endDay: string, days: number): string[] {
  const end = Date.parse(`${endDay}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => dayStr(end - (days - 1 - i) * DAY_MS));
}

export interface StratumDay { day: string; stratum: Stratum; impressions: number }

/**
 * Search Console impression drop per stratum, over a COMPLETE calendar.
 *
 * Call this only with rows from a Search Console response that paginated to completion.
 * Search Console omits zero-impression (day, page) combinations, so a stratum with no row on a
 * day had zero impressions that day. That is only true if the query completed, which is why
 * `complete` must be passed and an incomplete response returns no verdict at all.
 *
 * Window: the 3 most recent MATURE days (ending lagDays before today) vs the 28 mature days
 * before them. A stratum is "established" when that 28-day baseline averages >= 20/day. An
 * established stratum that vanished entirely (zero rows) is therefore caught.
 */
export function stratumImpressionDrop(rows: StratumDay[], opts: { complete: boolean; endDay: string; strata: readonly Stratum[] }): { evaluated: boolean; escalations: Escalation[]; baselines: Partial<Record<Stratum, number>> } {
  if (!opts.complete) return { evaluated: false, escalations: [], baselines: {} };
  const days = calendar(opts.endDay, GSC_DROP.baselineDays + GSC_DROP.recentDays);
  const baseDays = days.slice(0, GSC_DROP.baselineDays);
  const recentDays = days.slice(GSC_DROP.baselineDays);
  const byKey = new Map<string, number>();
  for (const r of rows) byKey.set(`${r.stratum}|${r.day}`, (byKey.get(`${r.stratum}|${r.day}`) ?? 0) + r.impressions);
  const value = (s: Stratum, d: string) => byKey.get(`${s}|${d}`) ?? 0; // zero-fill: valid only because complete

  const escalations: Escalation[] = [];
  const baselines: Partial<Record<Stratum, number>> = {};
  for (const s of opts.strata) {
    const baseline = baseDays.reduce((sum, d) => sum + value(s, d), 0) / baseDays.length;
    baselines[s] = Math.round(baseline * 10) / 10;
    if (baseline < GSC_DROP.minBaselinePerDay) continue; // not established: too small to judge
    const floor = baseline * (1 - GSC_DROP.ratio);
    const recent = recentDays.map((d) => ({ day: d, impressions: value(s, d) }));
    if (recent.every((r) => r.impressions < floor)) {
      escalations.push({
        rule: 'gsc_stratum_drop',
        severity: 'warning',
        key: s,
        message: `${s}: impressions below ${Math.round(floor)}/day (40% under the ${Math.round(baseline)}/day 28-day baseline) on ${recentDays.length} consecutive mature days ending ${opts.endDay}`,
        evidence: { baseline: Math.round(baseline), floor: Math.round(floor), recent, window: { baseline: [baseDays[0], baseDays[baseDays.length - 1]], recent: [recentDays[0], recentDays[recentDays.length - 1]] } },
      });
    }
  }
  return { evaluated: true, escalations, baselines };
}

export interface InspectionRow { stratum: Stratum; outcome: Outcome; checked_at: string }

export interface StratumIndexShare { stratum: Stratum; current: { share: number | null; n: number }; previous: { share: number | null; n: number } }

/** Indexed share per stratum, this 7-day window vs the previous one. Never mixed across strata. */
export function indexedShareByStratum(inspections: InspectionRow[], strata: readonly Stratum[], now = Date.now()): StratumIndexShare[] {
  const w = INDEXED_DROP.windowDays * DAY_MS;
  const valid = inspections.filter((r) => r.outcome !== 'inspection_error');
  const share = (rows: InspectionRow[]) => ({ share: rows.length ? rows.filter((r) => r.outcome === 'indexed').length / rows.length : null, n: rows.length });
  return strata.map((stratum) => {
    const mine = valid.filter((r) => r.stratum === stratum);
    const age = (r: InspectionRow) => now - Date.parse(r.checked_at);
    return { stratum, current: share(mine.filter((r) => age(r) < w)), previous: share(mine.filter((r) => age(r) >= w && age(r) < 2 * w)) };
  });
}

export function googleIndexedDrop(shares: StratumIndexShare[]): Escalation[] {
  return shares
    .filter((s) => s.current.n >= INDEXED_DROP.minPerWindow && s.previous.n >= INDEXED_DROP.minPerWindow && s.previous.share! - s.current.share! > INDEXED_DROP.points)
    .map((s) => ({
      rule: 'google_indexed_drop' as const,
      severity: 'warning' as const,
      key: s.stratum,
      message: `${s.stratum}: Google indexed share of inspected URLs fell from ${(100 * s.previous.share!).toFixed(1)}% to ${(100 * s.current.share!).toFixed(1)}% week over week`,
      evidence: { current: s.current, previous: s.previous },
    }));
}
