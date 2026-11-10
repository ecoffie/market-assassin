/**
 * MCP tool: search_govcon_jobs — federal contracting job openings from USAJobs.
 *
 * Two uses: (1) a job seeker finding contract-specialist / contracting-officer openings, and
 * (2) a buying signal — an agency office adding buyers (series 1102) is staffing up to buy.
 * Same source as getmindy.ai/jobs (src/lib/jobs/sources.ts fetchUSAJobs), cached 6h in
 * mcp_external_cache. Contractor (private-sector) jobs are NOT in this tool yet.
 *
 * credits: 1. `_meta` always ships; `_ai_hint` OFF by default. A failed USAJobs call is
 * degraded=true, never an empty "nobody is hiring".
 */
import { fetchUSAJobs, usajobsKey, type JobPostingRow } from '@/lib/jobs/sources';
import { withCache } from '@/lib/mcp/external-cache';
import { normalizeStateCode } from '@/lib/utils/us-states';
import { mcpFlags } from '@/lib/mcp/flags';

export interface GovconJobsInput {
  keyword?: string;
  agency?: string;
  state?: string;
  clearance?: 'required' | 'none-stated';
  remote_only?: boolean;
  days?: number;
  series?: string;
  limit?: number;
}

export interface GovconJob {
  title: string;
  agency: string;
  department: string | null;
  city: string | null;
  state: string | null;
  remote: boolean;
  clearance: string | null;
  salary_min: number | null;
  salary_max: number | null;
  posted: string | null;
  closes: string | null;
  apply_url: string | null;
}

export interface GovconJobsResult {
  queried: { series: string; days: number; keyword?: string; agency?: string; state?: string; clearance?: string; remote_only?: boolean };
  total_matching: number;
  jobs: GovconJob[];
  agencies_hiring: Array<{ agency: string; department: string | null; openings: number }>;
  source: string;
  _ai_hint?: { summary: string; how_to_use: string; key_caveats: string[] };
  _meta: { grounded: boolean; degraded: boolean; count: number; total_in_series: number | null; from_cache?: boolean; error?: string };
}

const SERIES_RE = /^\d{4}$/;

export function filterJobs(rows: JobPostingRow[], input: GovconJobsInput, state: string | undefined): JobPostingRow[] {
  const kw = input.keyword?.trim().toLowerCase();
  const ag = input.agency?.trim().toLowerCase();
  return rows
    .filter((r) => !kw || `${r.title}\n${r.description ?? ''}`.toLowerCase().includes(kw))
    .filter((r) => !ag || `${r.employer_name} ${r.department ?? ''}`.toLowerCase().includes(ag))
    .filter((r) => !state || r.state === state)
    .filter((r) => input.clearance !== 'required' || !!r.clearance)
    .filter((r) => input.clearance !== 'none-stated' || !r.clearance)
    .filter((r) => !input.remote_only || r.remote)
    .sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));
}

export function agenciesHiring(rows: JobPostingRow[]): GovconJobsResult['agencies_hiring'] {
  const m = new Map<string, { agency: string; department: string | null; openings: number }>();
  for (const r of rows) {
    const k = r.employer_name.toLowerCase();
    const t = m.get(k) ?? { agency: r.employer_name, department: r.department, openings: 0 };
    t.openings++;
    m.set(k, t);
  }
  return [...m.values()].sort((a, b) => b.openings - a.openings).slice(0, 10);
}

export async function govconJobsSearch(input: GovconJobsInput, deps: { fetch?: typeof fetchUSAJobs } = {}): Promise<GovconJobsResult> {
  const series = input.series && SERIES_RE.test(input.series) ? input.series : '1102';
  const days = Math.max(1, Math.min(60, Math.round(input.days ?? 30)));
  const limit = Math.max(1, Math.min(100, Math.round(input.limit ?? 25)));
  const state = input.state ? normalizeStateCode(input.state) ?? undefined : undefined;
  const queried: GovconJobsResult['queried'] = {
    series,
    days,
    ...(input.keyword ? { keyword: input.keyword } : {}),
    ...(input.agency ? { agency: input.agency } : {}),
    ...(state ? { state } : {}),
    ...(input.clearance ? { clearance: input.clearance } : {}),
    ...(input.remote_only ? { remote_only: true } : {}),
  };
  const empty = (degraded: boolean, error?: string): GovconJobsResult => ({
    queried,
    total_matching: 0,
    jobs: [],
    agencies_hiring: [],
    source: 'USAJobs',
    _meta: { grounded: false, degraded, count: 0, total_in_series: null, ...(error ? { error } : {}) },
  });

  if (!deps.fetch && !usajobsKey()) return empty(true, 'USAJobs is not configured');

  let rows: JobPostingRow[];
  let fromCache = false;
  try {
    const fetcher = deps.fetch ?? fetchUSAJobs;
    if (deps.fetch) {
      rows = await fetcher(series, days);
    } else {
      const r = await withCache('usajobs_series', { series, days }, 6 * 3600, () => fetcher(series, days));
      rows = r.value;
      fromCache = r.fromCache;
    }
  } catch (e) {
    console.error('[mcp:govcon-jobs] USAJobs failed:', (e as Error).message);
    return empty(true, 'USAJobs could not be reached');
  }

  const matching = filterJobs(rows, input, state);
  const jobs: GovconJob[] = matching.slice(0, limit).map((r) => ({
    title: r.title,
    agency: r.employer_name,
    department: r.department,
    city: r.city,
    state: r.state,
    remote: r.remote,
    clearance: r.clearance,
    salary_min: r.salary_min,
    salary_max: r.salary_max,
    posted: r.posted_at,
    closes: r.expires_at,
    apply_url: r.apply_url,
  }));
  const grounded = jobs.length > 0;
  const result: GovconJobsResult = {
    queried,
    total_matching: matching.length,
    jobs,
    agencies_hiring: agenciesHiring(matching),
    source: `USAJobs, occupational series ${series}${series === '1102' ? ' (Contracting)' : ''}, posted in the last ${days} days`,
    _meta: { grounded, degraded: false, count: jobs.length, total_in_series: rows.length, from_cache: fromCache },
  };
  if (mcpFlags.aiHint) {
    result._ai_hint = {
      summary: grounded
        ? `${matching.length} matching opening(s); top hiring office: ${result.agencies_hiring[0]?.agency}.`
        : 'No openings matched these filters. Say none matched; do not invent jobs.',
      how_to_use: 'Link apply_url for each job. An office with several contract-specialist openings is adding buyers, a signal it plans to buy more.',
      key_caveats: [
        'Federal jobs only (USAJobs). Private-sector contractor jobs are not included.',
        'Clearance shows only when the posting names one.',
      ],
    };
  }
  return result;
}
