/**
 * Reads the stored job postings for the /jobs page (and, later, contractor pages and the MCP).
 *
 * Every count is exact or null. A failed or missing table returns `state: 'unavailable'`, which
 * the page renders as "can't load", never as "0 jobs" (Bug Prevention Rule #11).
 */
import { categorizeJob, type JobRoleSlug } from './categories';

export interface JobListing {
  id: string;
  source: 'jsearch' | 'usajobs';
  title: string;
  employer_name: string;
  department: string | null;
  city: string | null;
  state: string | null;
  remote: boolean;
  clearance: string | null;
  contingent_on_award: boolean;
  salary_min: number | null;
  salary_max: number | null;
  posted_at: string | null;
  first_seen_at: string;
  apply_url: string | null;
  role: JobRoleSlug;
}

export interface JobBoardFilters {
  source?: 'jsearch' | 'usajobs';
  role?: string;
  clearance?: 'any' | 'required' | 'none-stated';
  state?: string;
}

export interface JobBoardData {
  state: 'ok' | 'unavailable';
  error?: string;
  /** Postings seen by a sync in the last `activeDays` days. */
  totals: { active: number | null; contractor: number | null; federal: number | null; cleared: number | null; contingent: number | null };
  listings: JobListing[];
  topEmployers: Array<{ name: string; count: number }>;
  agenciesHiring: Array<{ name: string; department: string | null; count: number }>;
  lastSyncedAt: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

const COLS =
  'id, source, title, employer_name, department, city, state, remote, clearance, contingent_on_award, salary_min, salary_max, posted_at, first_seen_at, apply_url, last_seen_at';

export const ACTIVE_DAYS = 14;
/** Rows read to build the employer / agency rollups. Rollup labels say "in the latest N postings". */
export const ROLLUP_SAMPLE = 1000;

export async function readJobBoard(sb: Sb, filters: JobBoardFilters = {}, opts: { limit?: number; now?: Date } = {}): Promise<JobBoardData> {
  const limit = opts.limit ?? 60;
  const since = new Date((opts.now ?? new Date()).getTime() - ACTIVE_DAYS * 86_400_000).toISOString();
  const empty: JobBoardData = {
    state: 'unavailable',
    totals: { active: null, contractor: null, federal: null, cleared: null, contingent: null },
    listings: [],
    topEmployers: [],
    agenciesHiring: [],
    lastSyncedAt: null,
  };

  const active = () => sb.from('contractor_job_postings').select('id', { count: 'exact', head: true }).gte('last_seen_at', since);
  const countOf = async (q: Sb): Promise<number | null> => {
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? null;
  };

  try {
    const [all, contractor, federal, cleared, contingent] = await Promise.all([
      countOf(active()),
      countOf(active().eq('source', 'jsearch')),
      countOf(active().eq('source', 'usajobs')),
      countOf(active().not('clearance', 'is', null)),
      countOf(active().eq('contingent_on_award', true)),
    ]);

    let list = sb.from('contractor_job_postings').select(COLS).gte('last_seen_at', since);
    if (filters.source) list = list.eq('source', filters.source);
    if (filters.state) list = list.eq('state', filters.state);
    if (filters.clearance === 'required') list = list.not('clearance', 'is', null);
    if (filters.clearance === 'none-stated') list = list.is('clearance', null);
    // Role is derived from the title; read a wider window and filter after so the page still fills.
    const { data: rows, error: listErr } = await list
      .order('posted_at', { ascending: false, nullsFirst: false })
      .limit(filters.role ? ROLLUP_SAMPLE : limit);
    if (listErr) throw new Error(listErr.message);

    const { data: sample, error: sampleErr } = await sb
      .from('contractor_job_postings')
      .select('source, employer_name, department, last_seen_at')
      .gte('last_seen_at', since)
      .order('last_seen_at', { ascending: false })
      .limit(ROLLUP_SAMPLE);
    if (sampleErr) throw new Error(sampleErr.message);

    const listings: JobListing[] = ((rows ?? []) as Array<Omit<JobListing, 'role'> & { last_seen_at: string }>)
      .map((r) => ({ ...r, role: categorizeJob(r.title) }))
      .filter((r) => !filters.role || r.role === filters.role)
      .slice(0, limit);

    const tally = new Map<string, { name: string; department: string | null; count: number; source: string }>();
    let lastSyncedAt: string | null = null;
    for (const r of (sample ?? []) as Array<{ source: string; employer_name: string; department: string | null; last_seen_at: string }>) {
      if (!lastSyncedAt || r.last_seen_at > lastSyncedAt) lastSyncedAt = r.last_seen_at;
      const k = `${r.source}|${r.employer_name.toLowerCase()}`;
      const t = tally.get(k) ?? { name: r.employer_name, department: r.department, count: 0, source: r.source };
      t.count++;
      tally.set(k, t);
    }
    const ranked = [...tally.values()].sort((a, b) => b.count - a.count);

    return {
      state: 'ok',
      totals: { active: all, contractor, federal, cleared, contingent },
      listings,
      topEmployers: ranked.filter((t) => t.source === 'jsearch').slice(0, 10).map(({ name, count }) => ({ name, count })),
      agenciesHiring: ranked.filter((t) => t.source === 'usajobs').slice(0, 10).map(({ name, department, count }) => ({ name, department, count })),
      lastSyncedAt,
    };
  } catch (e) {
    return { ...empty, error: (e as Error).message };
  }
}
