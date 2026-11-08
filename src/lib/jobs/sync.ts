/**
 * Daily job-posting sync → contractor_job_postings.
 *
 * Runs every configured query against JSearch and every configured series against USAJobs,
 * de-duplicates by posting id, and upserts. first_seen_at is never sent (the table default sets
 * it on insert, an update leaves it alone); last_seen_at is stamped on every row seen this run.
 *
 * One source failing does not stop the other: its error is returned in `errors` and the caller
 * reports a partial run. A run that writes nothing is the caller's to treat as a failure.
 */
import { fetchJSearch, fetchUSAJobs, jsearchKey, usajobsKey, type JobPostingRow } from './sources';

/** Default JSearch queries: postings that name federal-contract work. Override with JOBS_SYNC_QUERIES ("a|b|c"). */
export const DEFAULT_JSEARCH_QUERIES = [
  'government contractor',
  'federal contractor security clearance',
  'contingent upon contract award',
  'defense contractor',
  'DoD contractor',
  'federal government contract support',
] as const;

/** Default USAJobs series: 1102 Contracting. Override with JOBS_SYNC_USAJOBS_SERIES ("1102,1101"). */
export const DEFAULT_USAJOBS_SERIES = ['1102'] as const;

export interface JobsSyncConfig {
  queries: string[];
  pagesPerQuery: number;
  usajobsSeries: string[];
  usajobsDays: number;
}

export function jobsSyncConfig(env: NodeJS.ProcessEnv = process.env): JobsSyncConfig {
  const list = (v: string | undefined, sep: string, dflt: readonly string[]) => {
    const parts = (v || '').split(sep).map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts : [...dflt];
  };
  const int = (v: string | undefined, dflt: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? Math.min(n, max) : dflt;
  };
  return {
    queries: list(env.JOBS_SYNC_QUERIES, '|', DEFAULT_JSEARCH_QUERIES),
    pagesPerQuery: int(env.JOBS_SYNC_PAGES, 2, 10),
    usajobsSeries: list(env.JOBS_SYNC_USAJOBS_SERIES, ',', DEFAULT_USAJOBS_SERIES),
    usajobsDays: int(env.JOBS_SYNC_USAJOBS_DAYS, 3, 60),
  };
}

export interface JobsSyncResult {
  fetched: { jsearch: number; usajobs: number };
  unique: number;
  newPostings: number | null;
  written: number | null;
  skipped: { jsearch: boolean; usajobs: boolean };
  errors: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

const CHUNK = 500;

export async function syncContractorJobs(
  sb: Sb,
  opts: { config?: JobsSyncConfig; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<JobsSyncResult> {
  const cfg = opts.config ?? jobsSyncConfig();
  const f = opts.fetchImpl ?? fetch;
  const nowIso = (opts.now ?? new Date()).toISOString();
  const errors: string[] = [];
  const byId = new Map<string, JobPostingRow>();
  const fetched = { jsearch: 0, usajobs: 0 };
  const skipped = { jsearch: !jsearchKey(), usajobs: !usajobsKey() };
  if (skipped.jsearch) errors.push('jsearch: JSEARCH_API_KEY not set');
  if (skipped.usajobs) errors.push('usajobs: USAJOBS_API_KEY not set');

  if (!skipped.jsearch) {
    for (const q of cfg.queries) {
      try {
        const rows = await fetchJSearch(q, cfg.pagesPerQuery, f);
        fetched.jsearch += rows.length;
        for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
      } catch (e) {
        errors.push(`jsearch "${q}": ${(e as Error).message}`);
      }
    }
  }
  if (!skipped.usajobs) {
    for (const s of cfg.usajobsSeries) {
      try {
        const rows = await fetchUSAJobs(s, cfg.usajobsDays, f);
        fetched.usajobs += rows.length;
        for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
      } catch (e) {
        errors.push(`usajobs ${s}: ${(e as Error).message}`);
      }
    }
  }

  const rows = [...byId.values()];
  let newPostings: number | null = 0;
  let written: number | null = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const ids = chunk.map((r) => r.id);

    const { data: existing, error: readErr } = await sb.from('contractor_job_postings').select('id').in('id', ids);
    if (readErr) {
      errors.push(`read existing: ${readErr.message}`);
      newPostings = null; // unknown, never a guessed zero
    } else if (newPostings !== null) {
      newPostings += chunk.length - (existing?.length ?? 0);
    }

    const { error: writeErr, count } = await sb
      .from('contractor_job_postings')
      .upsert(chunk.map((r) => ({ ...r, last_seen_at: nowIso })), { onConflict: 'id', count: 'exact' });
    if (writeErr) {
      errors.push(`upsert: ${writeErr.message}`);
      written = null;
    } else if (written !== null) {
      if (count == null) written = null;
      else written += count;
    }
  }

  return { fetched, unique: rows.length, newPostings, written, skipped, errors };
}
