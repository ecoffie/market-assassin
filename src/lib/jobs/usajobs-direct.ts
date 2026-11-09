/**
 * /jobs straight from USAJobs (Eric, 2026-11-09: "let's just work with USAJobs for now").
 *
 * Contract-specialist openings (series 1102) posted in the last 30 days, read live from the
 * USAJobs API and cached for 6 hours. Used while Mindy's own contractor_job_postings table is
 * empty, so the page does not wait on the daily sync. Contractor (JSearch) jobs are not part of
 * this view: their count stays null ("Soon"), never zero.
 */
import { unstable_cache } from 'next/cache';
import { categorizeJob } from './categories';
import { fetchUSAJobs, usajobsKey, type JobPostingRow } from './sources';
import type { JobBoardData, JobBoardFilters, JobListing } from './read';

export const USAJOBS_DIRECT_SERIES = '1102';
export const USAJOBS_DIRECT_DAYS = 30;

export function usajobsRowToListing(r: JobPostingRow): JobListing {
  return {
    id: r.id,
    source: 'usajobs',
    title: r.title,
    employer_name: r.employer_name,
    department: r.department,
    city: r.city,
    state: r.state,
    remote: r.remote,
    clearance: r.clearance,
    contingent_on_award: false,
    salary_min: r.salary_min,
    salary_max: r.salary_max,
    posted_at: r.posted_at,
    first_seen_at: r.posted_at ?? new Date(0).toISOString(),
    apply_url: r.apply_url,
    role: categorizeJob(r.title),
  };
}

/** Pure: turn fetched postings into the board, applying the page filters. */
export function buildUsaJobsBoard(rows: JobListing[], filters: JobBoardFilters = {}, limit = 60, fetchedAt = new Date()): JobBoardData {
  const all = [...rows].sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));
  const listings = (filters.source === 'jsearch' ? [] : all)
    .filter((r) => !filters.role || r.role === filters.role)
    .filter((r) => !filters.state || r.state === filters.state)
    .filter((r) => filters.clearance !== 'required' || !!r.clearance)
    .filter((r) => filters.clearance !== 'none-stated' || !r.clearance)
    .slice(0, limit);

  const tally = new Map<string, { name: string; department: string | null; count: number }>();
  for (const r of all) {
    const k = r.employer_name.toLowerCase();
    const t = tally.get(k) ?? { name: r.employer_name, department: r.department, count: 0 };
    t.count++;
    tally.set(k, t);
  }

  return {
    state: 'ok',
    source: 'usajobs',
    totals: {
      active: all.length,
      contractor: null, // not fetched in this view — unknown, never zero
      federal: all.length,
      cleared: all.filter((r) => r.clearance).length,
      contingent: null,
    },
    listings,
    topEmployers: [],
    agenciesHiring: [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    lastSyncedAt: fetchedAt.toISOString(),
  };
}

const UNAVAILABLE: JobBoardData = {
  state: 'unavailable',
  source: 'usajobs',
  totals: { active: null, contractor: null, federal: null, cleared: null, contingent: null },
  listings: [],
  topEmployers: [],
  agenciesHiring: [],
  lastSyncedAt: null,
};

const fetchCached = unstable_cache(
  async () => {
    const rows = await fetchUSAJobs(USAJOBS_DIRECT_SERIES, USAJOBS_DIRECT_DAYS);
    return { rows: rows.map(usajobsRowToListing), fetchedAt: new Date().toISOString() };
  },
  ['jobs-usajobs-direct-v1'],
  { revalidate: 6 * 3600 },
);

/** Null when no USAJobs key is set (caller falls back). Unavailable on an API error. */
export async function readJobBoardFromUsaJobs(filters: JobBoardFilters = {}): Promise<JobBoardData | null> {
  if (!usajobsKey()) return null;
  try {
    const { rows, fetchedAt } = await fetchCached();
    if (rows.length === 0) return null;
    return buildUsaJobsBoard(rows, filters, 60, new Date(fetchedAt));
  } catch (e) {
    console.error('[jobs] USAJobs direct read failed:', (e as Error).message);
    return { ...UNAVAILABLE, error: (e as Error).message };
  }
}
