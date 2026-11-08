/**
 * Job-posting sources: JSearch (private-sector postings, via RapidAPI) and USAJobs (federal).
 *
 * Ported from govcon-funnels (src/lib/jsearch.ts, src/lib/usajobs.ts), which fetched these live
 * for the govcongiants.com /jobs board. Here they feed the stored contractor_job_postings table.
 *
 * Each fetcher returns rows in the table's shape (minus first_seen_at / last_seen_at, which the
 * sync and the table defaults own). A source that is not configured throws: the sync reports it
 * rather than recording an empty run as a quiet day.
 */
import { normalizeStateCode } from '@/lib/utils/us-states';
import { detectClearance, detectContingentOnAward, normalizeEmployer } from './signals';

export interface JobPostingRow {
  id: string;
  source: 'jsearch' | 'usajobs';
  source_job_id: string;
  title: string;
  employer_name: string;
  employer_norm: string;
  department: string | null;
  city: string | null;
  state: string | null;
  remote: boolean;
  clearance: string | null;
  contingent_on_award: boolean;
  salary_min: number | null;
  salary_max: number | null;
  posted_at: string | null;
  expires_at: string | null;
  apply_url: string | null;
  description: string | null;
  search_query: string;
}

const DESC_MAX = 4000;
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const iso = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const state = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? normalizeStateCode(v.trim()) : null);

// ── JSearch ────────────────────────────────────────────────────────────────────

export interface JSearchJob {
  job_id: string;
  job_title: string;
  job_description?: string | null;
  employer_name?: string | null;
  job_is_remote?: boolean | null;
  job_city?: string | null;
  job_state?: string | null;
  job_country?: string | null;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_period?: string | null;
  job_posted_at_datetime_utc?: string | null;
  job_offer_expiration_datetime_utc?: string | null;
  job_apply_link?: string | null;
}

export function jsearchKey(): string | null {
  return (process.env.JSEARCH_API_KEY || process.env.RAPIDAPI_KEY || '').trim() || null;
}

export function mapJSearchJob(j: JSearchJob, query: string): JobPostingRow | null {
  const employer = (j.employer_name || '').trim();
  if (!j.job_id || !j.job_title || !employer) return null;
  if (j.job_country && j.job_country !== 'US') return null;
  const desc = (j.job_description || '').slice(0, DESC_MAX);
  const text = `${j.job_title}\n${desc}`;
  // Annual salaries only; an hourly figure in an annual column would be wrong by ~2,000x.
  const annual = !j.job_salary_period || j.job_salary_period.toUpperCase() === 'YEAR';
  return {
    id: `jsearch:${j.job_id}`,
    source: 'jsearch',
    source_job_id: j.job_id,
    title: j.job_title.trim(),
    employer_name: employer,
    employer_norm: normalizeEmployer(employer),
    department: null,
    city: j.job_city?.trim() || null,
    state: state(j.job_state),
    remote: j.job_is_remote === true,
    clearance: detectClearance(text),
    contingent_on_award: detectContingentOnAward(text),
    salary_min: annual ? num(j.job_min_salary) : null,
    salary_max: annual ? num(j.job_max_salary) : null,
    posted_at: iso(j.job_posted_at_datetime_utc),
    expires_at: iso(j.job_offer_expiration_datetime_utc),
    apply_url: j.job_apply_link || null,
    description: desc || null,
    search_query: query,
  };
}

/** One JSearch query, `pages` pages (10 postings per page). */
export async function fetchJSearch(
  query: string,
  pages: number,
  fetchImpl: typeof fetch = fetch,
): Promise<JobPostingRow[]> {
  const key = jsearchKey();
  if (!key) throw new Error('JSEARCH_API_KEY not set');
  const params = new URLSearchParams({
    query,
    page: '1',
    num_pages: String(Math.max(1, Math.min(pages, 10))),
    date_posted: 'week',
    country: 'us',
  });
  const res = await fetchImpl(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`JSearch ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = (await res.json()) as { data?: JSearchJob[] };
  return (data.data || []).map((j) => mapJSearchJob(j, query)).filter((r): r is JobPostingRow => r !== null);
}

// ── USAJobs ────────────────────────────────────────────────────────────────────

export interface USAJobsItem {
  MatchedObjectId: string;
  MatchedObjectDescriptor: {
    PositionTitle: string;
    PositionURI?: string;
    OrganizationName?: string;
    DepartmentName?: string;
    PositionLocation?: Array<{ CityName?: string; CountrySubDivisionCode?: string; LocationName?: string }>;
    PositionRemuneration?: Array<{ MinimumRange?: string; MaximumRange?: string; RateIntervalCode?: string }>;
    PublicationStartDate?: string;
    ApplicationCloseDate?: string;
    UserArea?: { Details?: { JobSummary?: string; SecurityClearance?: string; TeleworkEligible?: boolean; RemoteIndicator?: boolean } };
  };
}

export function usajobsKey(): string | null {
  return (process.env.USAJOBS_API_KEY || '').trim() || null;
}

const USAJOBS_CLEARANCE: Record<string, string> = {
  'top secret/sci': 'TS/SCI',
  'sci': 'TS/SCI',
  'top secret': 'Top Secret',
  'secret': 'Secret',
  'q - sensitive': 'Top Secret',
  'l - confidential': 'Secret',
  'public trust - background investigation': 'Public Trust',
};

export function mapUSAJob(item: USAJobsItem, query: string): JobPostingRow | null {
  const d = item.MatchedObjectDescriptor;
  if (!item.MatchedObjectId || !d?.PositionTitle) return null;
  const employer = (d.OrganizationName || d.DepartmentName || '').trim();
  if (!employer) return null;
  const loc = d.PositionLocation?.[0];
  const pay = d.PositionRemuneration?.[0];
  const annual = !pay?.RateIntervalCode || pay.RateIntervalCode === 'PA';
  const summary = (d.UserArea?.Details?.JobSummary || '').slice(0, DESC_MAX);
  const declared = (d.UserArea?.Details?.SecurityClearance || '').toLowerCase().trim();
  return {
    id: `usajobs:${item.MatchedObjectId}`,
    source: 'usajobs',
    source_job_id: item.MatchedObjectId,
    title: d.PositionTitle.trim(),
    employer_name: employer,
    employer_norm: normalizeEmployer(employer),
    department: d.DepartmentName?.trim() || null,
    city: loc?.CityName?.split(',')[0]?.trim() || null,
    state: state(loc?.CountrySubDivisionCode),
    remote: d.UserArea?.Details?.RemoteIndicator === true,
    clearance: USAJOBS_CLEARANCE[declared] ?? detectClearance(`${d.PositionTitle}\n${summary}`),
    contingent_on_award: false,
    salary_min: annual ? num(pay?.MinimumRange) : null,
    salary_max: annual ? num(pay?.MaximumRange) : null,
    posted_at: iso(d.PublicationStartDate),
    expires_at: iso(d.ApplicationCloseDate),
    apply_url: d.PositionURI || null,
    description: summary || null,
    search_query: query,
  };
}

/**
 * USAJobs postings in one occupational series posted in the last `days` days.
 * Default series 1102 = Contracting: an agency hiring contract specialists is staffing up to buy.
 */
export async function fetchUSAJobs(
  series: string,
  days: number,
  fetchImpl: typeof fetch = fetch,
): Promise<JobPostingRow[]> {
  const key = usajobsKey();
  if (!key) throw new Error('USAJOBS_API_KEY not set');
  const contact = (process.env.USAJOBS_EMAIL || 'hello@getmindy.ai').trim();
  const out: JobPostingRow[] = [];
  const query = `series:${series}`;
  for (let page = 1; page <= 10; page++) {
    const params = new URLSearchParams({
      JobCategoryCode: series,
      DatePosted: String(days),
      ResultsPerPage: '500',
      Page: String(page),
    });
    const res = await fetchImpl(`https://data.usajobs.gov/api/search?${params}`, {
      headers: { Host: 'data.usajobs.gov', 'User-Agent': contact, 'Authorization-Key': key },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`USAJobs ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = (await res.json()) as {
      SearchResult?: { SearchResultItems?: USAJobsItem[]; UserArea?: { NumberOfPages?: string } };
    };
    const items = data.SearchResult?.SearchResultItems || [];
    for (const it of items) {
      const row = mapUSAJob(it, query);
      if (row) out.push(row);
    }
    const pages = Number(data.SearchResult?.UserArea?.NumberOfPages || '1');
    if (items.length === 0 || page >= pages) break;
  }
  return out;
}
