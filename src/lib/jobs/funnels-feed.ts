/**
 * Interim /jobs source: the govcongiants.com job board's own feed (govcon-funnels
 * GET /api/jobs, which fetches JSearch live with a 1h cache). Used only while Mindy's own
 * contractor_job_postings table is empty or unreadable, i.e. until JSEARCH_API_KEY and
 * USAJOBS_API_KEY are set and the daily sync has run. Once Mindy holds postings, /jobs reads
 * them instead and this file is no longer on the path.
 *
 * That feed has contractor (JSearch) jobs only, ten per call, so we ask for the default BD
 * search plus each role category and de-duplicate. There are no federal (USAJobs) postings
 * and no first-seen history, so the page shows those parts as not available, never as zero.
 */
import { normalizeStateCode } from '@/lib/utils/us-states';
import { categorizeJob, JOB_ROLES } from './categories';
import { detectClearance, detectContingentOnAward } from './signals';
import { ACTIVE_DAYS, type JobBoardData, type JobBoardFilters, type JobListing } from './read';

export const FUNNELS_JOBS_URL = 'https://govcongiants.com/api/jobs';

interface FunnelsJob {
  id: string;
  title: string;
  company: string;
  locationCity?: string;
  locationState?: string;
  salary_min: number | null;
  salary_max: number | null;
  clearance: string | null;
  remote: boolean;
  posted_date: string;
  apply_url: string;
  description?: string;
}

const annual = (n: number | null) => (typeof n === 'number' && n >= 1000 ? n : null);

export function mapFunnelsJob(j: FunnelsJob): JobListing | null {
  if (!j?.id || !j.title || !j.company) return null;
  const text = `${j.title}\n${j.description || ''}`;
  const posted = Number.isNaN(Date.parse(j.posted_date)) ? null : new Date(j.posted_date).toISOString();
  return {
    id: `jsearch:${j.id}`,
    source: 'jsearch',
    title: j.title.trim(),
    employer_name: j.company.trim(),
    department: null,
    city: j.locationCity?.trim() || null,
    state: j.locationState ? normalizeStateCode(j.locationState) : null,
    remote: j.remote === true,
    clearance: j.clearance || detectClearance(text),
    contingent_on_award: detectContingentOnAward(text),
    salary_min: annual(j.salary_min),
    salary_max: annual(j.salary_max),
    posted_at: posted,
    first_seen_at: posted ?? new Date(0).toISOString(),
    apply_url: j.apply_url || null,
    role: categorizeJob(j.title),
  };
}

export async function readJobBoardFromFunnels(
  filters: JobBoardFilters = {},
  opts: { limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<JobBoardData> {
  const f = opts.fetchImpl ?? fetch;
  const limit = opts.limit ?? 60;
  const urls = [FUNNELS_JOBS_URL + '?limit=25', ...JOB_ROLES.map((r) => `${FUNNELS_JOBS_URL}?limit=25&category=${r.slug}`)];
  const results = await Promise.all(
    urls.map(async (u) => {
      try {
        const res = await f(u, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) } as RequestInit);
        if (!res.ok) return [] as FunnelsJob[];
        const d = (await res.json()) as { jobs?: FunnelsJob[] };
        return d.jobs ?? [];
      } catch {
        return [] as FunnelsJob[];
      }
    }),
  );

  const byId = new Map<string, JobListing>();
  for (const list of results) for (const j of list) {
    const row = mapFunnelsJob(j);
    if (row && !byId.has(row.id)) byId.set(row.id, row);
  }
  const all = [...byId.values()].sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));
  const cutoff = Date.now() - 45 * 86_400_000;
  const recent = all.filter((r) => !r.posted_at || Date.parse(r.posted_at) >= cutoff);

  if (recent.length === 0) {
    return {
      state: 'unavailable',
      source: 'govcongiants',
      error: 'govcongiants.com job feed returned no jobs',
      totals: { active: null, contractor: null, federal: null, cleared: null, contingent: null },
      listings: [],
      topEmployers: [],
      agenciesHiring: [],
      lastSyncedAt: null,
    };
  }

  const listings = recent
    .filter((r) => filters.source !== 'usajobs')
    .filter((r) => !filters.role || r.role === filters.role)
    .filter((r) => !filters.state || r.state === filters.state)
    .filter((r) => filters.clearance !== 'required' || !!r.clearance)
    .filter((r) => filters.clearance !== 'none-stated' || !r.clearance)
    .slice(0, limit);

  const tally = new Map<string, { name: string; count: number }>();
  for (const r of recent) {
    const k = r.employer_name.toLowerCase();
    const t = tally.get(k) ?? { name: r.employer_name, count: 0 };
    t.count++;
    tally.set(k, t);
  }

  return {
    state: 'ok',
    source: 'govcongiants',
    totals: {
      active: recent.length,
      contractor: recent.length,
      federal: null,
      cleared: recent.filter((r) => r.clearance).length,
      contingent: recent.filter((r) => r.contingent_on_award).length,
    },
    listings,
    topEmployers: [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    agenciesHiring: [],
    lastSyncedAt: new Date().toISOString(),
  };
}

/** Days the stored-table view counts as "open". Re-exported for the page copy. */
export { ACTIVE_DAYS };
