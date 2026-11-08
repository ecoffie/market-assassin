import { describe, expect, it } from 'vitest';
import { detectClearance, detectContingentOnAward, normalizeEmployer } from './signals';
import { mapJSearchJob, mapUSAJob } from './sources';
import { jobsSyncConfig, syncContractorJobs, DEFAULT_JSEARCH_QUERIES } from './sync';

describe('signals', () => {
  it('normalizes employer names to a comparable key', () => {
    expect(normalizeEmployer('Booz Allen Hamilton Inc.')).toBe('booz allen hamilton');
    expect(normalizeEmployer('LEIDOS, INC')).toBe('leidos');
    expect(normalizeEmployer('Science Applications International Corp')).toBe('science applications international');
    expect(normalizeEmployer('Smith & Jones LLC')).toBe('smith and jones');
  });

  it('reads the highest clearance the posting states, else null', () => {
    expect(detectClearance('Active TS/SCI with polygraph required')).toBe('TS/SCI');
    expect(detectClearance('Must hold a Top Secret clearance')).toBe('Top Secret');
    expect(detectClearance('Active Secret clearance required')).toBe('Secret');
    expect(detectClearance('Ability to obtain a Public Trust')).toBe('Public Trust');
    expect(detectClearance('Keep company secrets confidential')).toBeNull();
    expect(detectClearance('Great benefits, hybrid')).toBeNull();
  });

  it('detects roles that depend on winning a contract', () => {
    expect(detectContingentOnAward('This position is contingent upon contract award.')).toBe(true);
    expect(detectContingentOnAward('Contingent on award of the C-130 program')).toBe(true);
    expect(detectContingentOnAward('Hiring is pending contract award')).toBe(true);
    expect(detectContingentOnAward('Offer contingent on background check')).toBe(false);
  });
});

describe('mapJSearchJob', () => {
  const base = {
    job_id: 'abc123',
    job_title: 'Aircraft Structures Engineer',
    employer_name: 'Ridgeline Defense LLC',
    job_city: 'Warner Robins',
    job_state: 'GA',
    job_country: 'US',
    job_description: 'Secret clearance required. Contingent upon contract award.',
    job_min_salary: 95000,
    job_max_salary: 120000,
    job_salary_period: 'YEAR',
    job_posted_at_datetime_utc: '2026-11-01T12:00:00.000Z',
  };

  it('maps a US posting into the table shape', () => {
    const r = mapJSearchJob(base, 'defense contractor')!;
    expect(r.id).toBe('jsearch:abc123');
    expect(r.employer_norm).toBe('ridgeline defense');
    expect(r.state).toBe('GA');
    expect(r.clearance).toBe('Secret');
    expect(r.contingent_on_award).toBe(true);
    expect(r.salary_min).toBe(95000);
    expect(r.search_query).toBe('defense contractor');
    expect(r).not.toHaveProperty('first_seen_at');
  });

  it('drops hourly pay from annual salary columns', () => {
    const r = mapJSearchJob({ ...base, job_min_salary: 45, job_max_salary: 60, job_salary_period: 'HOUR' }, 'q')!;
    expect(r.salary_min).toBeNull();
    expect(r.salary_max).toBeNull();
  });

  it('skips non-US and employer-less postings', () => {
    expect(mapJSearchJob({ ...base, job_country: 'CA' }, 'q')).toBeNull();
    expect(mapJSearchJob({ ...base, employer_name: '' }, 'q')).toBeNull();
  });
});

describe('mapUSAJob', () => {
  it('maps a federal posting and prefers the declared clearance', () => {
    const r = mapUSAJob(
      {
        MatchedObjectId: '800001',
        MatchedObjectDescriptor: {
          PositionTitle: 'Contract Specialist',
          OrganizationName: 'Naval Supply Systems Command',
          DepartmentName: 'Department of the Navy',
          PositionLocation: [{ CityName: 'Norfolk, Virginia', CountrySubDivisionCode: 'Virginia' }],
          PositionRemuneration: [{ MinimumRange: '72553', MaximumRange: '112240', RateIntervalCode: 'PA' }],
          PublicationStartDate: '2026-11-03T00:00:00',
          ApplicationCloseDate: '2026-11-17T23:59:59',
          PositionURI: 'https://www.usajobs.gov/job/800001',
          UserArea: { Details: { JobSummary: 'Acquisition work.', SecurityClearance: 'Secret' } },
        },
      },
      'series:1102',
    )!;
    expect(r.id).toBe('usajobs:800001');
    expect(r.employer_name).toBe('Naval Supply Systems Command');
    expect(r.department).toBe('Department of the Navy');
    expect(r.city).toBe('Norfolk');
    expect(r.state).toBe('VA');
    expect(r.clearance).toBe('Secret');
    expect(r.salary_max).toBe(112240);
  });
});

describe('jobsSyncConfig', () => {
  it('uses defaults and caps overrides', () => {
    const d = jobsSyncConfig({} as NodeJS.ProcessEnv);
    expect(d.queries).toEqual([...DEFAULT_JSEARCH_QUERIES]);
    expect(d.pagesPerQuery).toBe(1);
    expect(d.usajobsSeries).toEqual(['1102']);
    const o = jobsSyncConfig({ JOBS_SYNC_QUERIES: 'a | b', JOBS_SYNC_PAGES: '99', JOBS_SYNC_USAJOBS_SERIES: '1102,1101' } as unknown as NodeJS.ProcessEnv);
    expect(o.queries).toEqual(['a', 'b']);
    expect(o.pagesPerQuery).toBe(10);
    expect(o.usajobsSeries).toEqual(['1102', '1101']);
  });
});

describe('syncContractorJobs', () => {
  function fakeDb(existingIds: string[], upsertCount: number | null = null, upsertError: { message: string } | null = null) {
    const upserts: Array<Record<string, unknown>[]> = [];
    const sb = {
      from: () => ({
        select: () => ({ in: async (_c: string, ids: string[]) => ({ data: ids.filter((i) => existingIds.includes(i)).map((id) => ({ id })), error: null }) }),
        upsert: async (rows: Record<string, unknown>[]) => {
          upserts.push(rows);
          return { error: upsertError, count: upsertError ? null : upsertCount ?? rows.length };
        },
      }),
    };
    return { sb, upserts };
  }

  const jsearchResponse = (ids: string[]) =>
    new Response(
      JSON.stringify({
        data: ids.map((id) => ({ job_id: id, job_title: 'Engineer', employer_name: 'Acme Corp', job_country: 'US', job_state: 'TX' })),
      }),
      { status: 200 },
    );

  const cfg = { queries: ['q1', 'q2'], pagesPerQuery: 1, usajobsSeries: [], usajobsDays: 3 };

  it('de-duplicates across queries, counts new rows, never sends first_seen_at', async () => {
    process.env.JSEARCH_API_KEY = 'test';
    delete process.env.USAJOBS_API_KEY;
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return url.includes('q1') ? jsearchResponse(['a', 'b']) : jsearchResponse(['b', 'c']);
    }) as unknown as typeof fetch;
    const { sb, upserts } = fakeDb(['jsearch:a']);
    const r = await syncContractorJobs(sb, { config: cfg, fetchImpl, now: new Date('2026-11-08T10:00:00Z') });
    expect(calls).toHaveLength(2);
    expect(r.fetched.jsearch).toBe(4);
    expect(r.unique).toBe(3);
    expect(r.newPostings).toBe(2);
    expect(r.written).toBe(3);
    expect(r.skipped.usajobs).toBe(true);
    expect(r.errors).toEqual(['usajobs: USAJOBS_API_KEY not set']);
    for (const row of upserts[0]) {
      expect(row).not.toHaveProperty('first_seen_at');
      expect(row.last_seen_at).toBe('2026-11-08T10:00:00.000Z');
    }
  });

  it('reports a failed write as unknown, not zero', async () => {
    process.env.JSEARCH_API_KEY = 'test';
    const fetchImpl = (async () => jsearchResponse(['a'])) as unknown as typeof fetch;
    const { sb } = fakeDb([], null, { message: 'relation does not exist' });
    const r = await syncContractorJobs(sb, { config: { ...cfg, queries: ['q1'] }, fetchImpl });
    expect(r.written).toBeNull();
    expect(r.errors.some((e) => e.startsWith('upsert:'))).toBe(true);
  });

  it('keeps going when one query fails', async () => {
    process.env.JSEARCH_API_KEY = 'test';
    const fetchImpl = (async (url: string) =>
      url.includes('q1') ? new Response('rate limited', { status: 429 }) : jsearchResponse(['z'])) as unknown as typeof fetch;
    const { sb } = fakeDb([]);
    const r = await syncContractorJobs(sb, { config: cfg, fetchImpl });
    expect(r.written).toBe(1);
    expect(r.errors.some((e) => e.includes('jsearch "q1": JSearch 429'))).toBe(true);
  });
});
