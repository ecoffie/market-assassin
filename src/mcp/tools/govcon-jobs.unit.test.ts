import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server-clients', () => ({ getWriteClient: () => ({}), getReadClient: () => ({}) }));
import { govconJobsSearch } from './govcon-jobs';
import type { JobPostingRow } from '@/lib/jobs/sources';

const row = (id: string, over: Partial<JobPostingRow> = {}): JobPostingRow => ({
  id: `usajobs:${id}`, source: 'usajobs', source_job_id: id, title: 'Contract Specialist',
  employer_name: 'U.S. Pacific Fleet', employer_norm: 'us pacific fleet', department: 'Department of the Navy',
  city: 'Norfolk', state: 'VA', remote: false, clearance: null, contingent_on_award: false,
  salary_min: 72553, salary_max: 94317, posted_at: '2026-11-05T00:00:00.000Z', expires_at: '2026-11-20T00:00:00.000Z',
  apply_url: `https://www.usajobs.gov/job/${id}`, description: 'Buy things', search_query: 'series:1102',
  ...over,
} as JobPostingRow);

const rows = [
  row('1'),
  row('2', { title: 'Contracting Officer', employer_name: 'Central Intelligence Agency', department: 'CIA', state: 'VA', clearance: 'TS/SCI', posted_at: '2026-11-08T00:00:00.000Z' }),
  row('3', { state: 'HI', city: 'Pearl Harbor', remote: true }),
];
const fetch = vi.fn(async () => rows);

describe('search_govcon_jobs', () => {
  it('returns jobs newest first with agencies hiring', async () => {
    const r = await govconJobsSearch({}, { fetch });
    expect(r._meta).toMatchObject({ grounded: true, degraded: false, count: 3, total_in_series: 3 });
    expect(r.jobs[0].title).toBe('Contracting Officer');
    expect(r.agencies_hiring[0]).toEqual({ agency: 'U.S. Pacific Fleet', department: 'Department of the Navy', openings: 2 });
  });

  it('filters by state name, agency, clearance and remote', async () => {
    expect((await govconJobsSearch({ state: 'Virginia' }, { fetch })).total_matching).toBe(2);
    expect((await govconJobsSearch({ agency: 'intelligence' }, { fetch })).total_matching).toBe(1);
    expect((await govconJobsSearch({ clearance: 'required' }, { fetch })).jobs[0].clearance).toBe('TS/SCI');
    expect((await govconJobsSearch({ remote_only: true }, { fetch })).jobs[0].state).toBe('HI');
  });

  it('no match is grounded=false, not degraded', async () => {
    const r = await govconJobsSearch({ keyword: 'astronaut' }, { fetch });
    expect(r._meta).toMatchObject({ grounded: false, degraded: false, count: 0 });
  });

  it('a USAJobs failure is degraded, never an empty "nobody is hiring"', async () => {
    const r = await govconJobsSearch({}, { fetch: async () => { throw new Error('503'); } });
    expect(r._meta).toMatchObject({ grounded: false, degraded: true });
    expect(r.total_matching).toBe(0);
  });

  it('rejects a malformed series and clamps days/limit', async () => {
    const f = vi.fn(async () => rows);
    const r = await govconJobsSearch({ series: 'drop table', days: 999, limit: 1 }, { fetch: f });
    expect(f).toHaveBeenCalledWith('1102', 60);
    expect(r.jobs).toHaveLength(1);
  });
});
