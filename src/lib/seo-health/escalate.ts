/**
 * Escalation rules. Pure functions over stored history. Nothing escalates on a single
 * observation: every rule needs the same signal across multiple runs or days.
 *
 *   url_persistent       one URL, same our-side failure class in >= 2 of its last 3 crawls
 *   canary_down          a canary page failing our-side checks in 2 consecutive runs
 *   section_failures     a section's crawl failure rate > 5% (min 20 URLs) in this run AND the previous run
 *   gsc_section_drop     a section's Search Console impressions > 40% below its trailing
 *                        28-day daily average for 3 consecutive days (baseline >= 20/day)
 *   google_indexed_drop  share of inspected URLs Google reports as indexed fell > 10 points,
 *                        last 7 days vs the 7 before (>= 50 inspections in each window)
 *
 * Google's indexing decisions are reported as a trend and escalate only through the last
 * rule. A "crawled - not indexed" verdict on one URL is Google's call, not an incident.
 */
import { CRAWL_FAILURES, type CrawlOutcome, type Outcome } from './types';

export const URL_PERSIST = { window: 3, minHits: 2 };
export const SECTION_FAILURE_RATE = 0.05;
export const SECTION_MIN_SAMPLE = 20;
export const GSC_DROP = { ratio: 0.4, consecutiveDays: 3, baselineDays: 28, minBaselinePerDay: 20 };
export const INDEXED_DROP = { points: 0.1, windowDays: 7, minPerWindow: 50 };

export interface Escalation {
  rule: 'url_persistent' | 'canary_down' | 'section_failures' | 'gsc_section_drop' | 'google_indexed_drop';
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

/** canaryRuns[i] = outcomes per canary URL for run i, newest first. */
export function canaryDown(canaryRuns: Array<Record<string, Outcome>>): Escalation[] {
  if (canaryRuns.length < 2) return [];
  const [now, prev] = canaryRuns;
  return Object.entries(now)
    .filter(([url, o]) => isCrawlFailure(o) && prev[url] !== undefined && isCrawlFailure(prev[url]))
    .map(([url, o]) => ({ rule: 'canary_down' as const, severity: 'critical' as const, key: url, message: `canary failing 2 runs in a row (${prev[url]} then ${o})`, evidence: { url, now: o, previous: prev[url] } }));
}

export interface SectionRate { total: number; failures: number }

/** Per-section crawl failure counts for this run and the previous run. */
export function sectionFailures(now: Record<string, SectionRate>, prev: Record<string, SectionRate> | null): Escalation[] {
  if (!prev) return [];
  const bad = (r?: SectionRate) => !!r && r.total >= SECTION_MIN_SAMPLE && r.failures / r.total > SECTION_FAILURE_RATE;
  return Object.keys(now)
    .filter((s) => bad(now[s]) && bad(prev[s]))
    .map((s) => ({
      rule: 'section_failures' as const,
      severity: 'warning' as const,
      key: s,
      message: `${s}: ${(100 * now[s].failures / now[s].total).toFixed(1)}% of crawled URLs failing, 2 runs in a row`,
      evidence: { now: now[s], previous: prev[s] },
    }));
}

export interface SectionDay { day: string; section: string; impressions: number }

/** daily: Search Console rows (any order). Evaluates each section's most recent consecutive days. */
export function gscSectionDrop(daily: SectionDay[]): Escalation[] {
  const bySection = new Map<string, Map<string, number>>();
  for (const r of daily) {
    const m = bySection.get(r.section) ?? new Map<string, number>();
    m.set(r.day, (m.get(r.day) ?? 0) + r.impressions);
    bySection.set(r.section, m);
  }
  const out: Escalation[] = [];
  for (const [section, m] of bySection) {
    const days = [...m.keys()].sort();
    if (days.length < GSC_DROP.consecutiveDays + 7) continue; // not enough history to judge
    const recent = days.slice(-GSC_DROP.consecutiveDays);
    const base = days.slice(0, -GSC_DROP.consecutiveDays).slice(-GSC_DROP.baselineDays);
    const baseline = base.reduce((s, d) => s + (m.get(d) ?? 0), 0) / base.length;
    if (baseline < GSC_DROP.minBaselinePerDay) continue;
    const floor = baseline * (1 - GSC_DROP.ratio);
    if (recent.every((d) => (m.get(d) ?? 0) < floor)) {
      out.push({
        rule: 'gsc_section_drop',
        severity: 'warning',
        key: section,
        message: `${section}: impressions below ${Math.round(floor)}/day (40% under the ${Math.round(baseline)}/day baseline) for ${GSC_DROP.consecutiveDays} days`,
        evidence: { baseline: Math.round(baseline), recent: recent.map((d) => ({ day: d, impressions: m.get(d) ?? 0 })) },
      });
    }
  }
  return out;
}

export interface InspectionRow { outcome: Outcome; checked_at: string }

/** inspections: URL Inspection rows from roughly the last 14 days. `now` is injectable for tests. */
export function googleIndexedDrop(inspections: InspectionRow[], now = Date.now()): Escalation[] {
  const dayMs = 86_400_000;
  const w = INDEXED_DROP.windowDays * dayMs;
  const valid = inspections.filter((r) => r.outcome !== 'inspection_error');
  const cur = valid.filter((r) => now - Date.parse(r.checked_at) < w);
  const prev = valid.filter((r) => { const age = now - Date.parse(r.checked_at); return age >= w && age < 2 * w; });
  if (cur.length < INDEXED_DROP.minPerWindow || prev.length < INDEXED_DROP.minPerWindow) return [];
  const share = (rows: InspectionRow[]) => rows.filter((r) => r.outcome === 'indexed').length / rows.length;
  const a = share(prev);
  const b = share(cur);
  if (a - b <= INDEXED_DROP.points) return [];
  return [{
    rule: 'google_indexed_drop',
    severity: 'warning',
    key: 'indexed_share',
    message: `Google indexed share of inspected URLs fell from ${(100 * a).toFixed(1)}% to ${(100 * b).toFixed(1)}% week over week`,
    evidence: { previous: { share: a, n: prev.length }, current: { share: b, n: cur.length } },
  }];
}
