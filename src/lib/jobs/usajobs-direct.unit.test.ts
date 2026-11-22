import { describe, expect, it, vi } from 'vitest';
import { buildUsaJobsBoard, customerJobBoardChoice, readJobBoardFromUsaJobs, usajobsRowToListing } from './usajobs-direct';
import { fetchUSAJobs } from './sources';

// The 6-hour cache is a pass-through here, so each test drives the real fetch path.
vi.mock('next/cache', () => ({ unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }));
import { mapUSAJob } from './sources';

const item = (id: string, title: string, org: string, extra: Record<string, unknown> = {}) => ({
  MatchedObjectId: id,
  MatchedObjectDescriptor: {
    PositionTitle: title,
    OrganizationName: org,
    DepartmentName: 'Department of Defense',
    PositionURI: `https://www.usajobs.gov/job/${id}`,
    PositionLocation: [{ CityName: 'Norfolk, Virginia', CountrySubDivisionCode: 'Virginia' }],
    PositionRemuneration: [{ MinimumRange: '72553', MaximumRange: '94317', RateIntervalCode: 'PA' }],
    PublicationStartDate: '2026-11-05T00:00:00',
    ApplicationCloseDate: '2026-11-20T23:59:59',
    UserArea: { Details: { JobSummary: 'Contract specialist', SecurityClearance: 'Secret' } },
    ...extra,
  },
});

const rows = [
  item('1', 'Contract Specialist', 'U.S. Pacific Fleet'),
  item('2', 'Contracting Officer', 'Central Intelligence Agency'),
  item('3', 'Contract Specialist', 'U.S. Pacific Fleet'),
].map((i) => usajobsRowToListing(mapUSAJob(i as never, 'series:1102')!, '2026-11-21T12:00:00.000Z'));

describe('USAJobs direct board', () => {
  it('counts federal jobs and leaves contractor jobs unknown, never zero', () => {
    const b = buildUsaJobsBoard(rows);
    expect(b.state).toBe('ok');
    expect(b.source).toBe('usajobs');
    expect(b.totals.federal).toBe(3);
    expect(b.totals.active).toBe(3);
    expect(b.totals.contractor).toBeNull();
    expect(b.totals.contingent).toBeNull();
  });

  it('ranks agencies hiring by postings', () => {
    const b = buildUsaJobsBoard(rows);
    expect(b.agenciesHiring[0]).toMatchObject({ name: 'U.S. Pacific Fleet', count: 2 });
  });

  it('maps location, pay and clearance from the USAJobs record', () => {
    expect(rows[0]).toMatchObject({ source: 'usajobs', state: 'VA', city: 'Norfolk', salary_min: 72553, clearance: 'Secret' });
  });

  it('does not invent a 1970 date when USAJobs omits the posted date', () => {
    const mapped = mapUSAJob(item('9', 'Contract Specialist', 'Defense Logistics Agency', {
      PublicationStartDate: '',
    }) as never, 'series:1102')!;
    const row = usajobsRowToListing(mapped, '2026-11-21T12:00:00.000Z');
    expect(row.posted_at).toBeNull();
    expect(row.first_seen_at).toBe('2026-11-21T12:00:00.000Z');
  });

  it('a confirmed empty USAJobs read stays empty, and an error does not fall through', () => {
    const empty = buildUsaJobsBoard([]);
    expect(empty.state).toBe('ok');
    expect(empty.totals.active).toBe(0);
    expect(empty.totals.federal).toBe(0);
    expect(empty.totals.contractor).toBeNull();
    expect(customerJobBoardChoice(false, empty)).toBe('direct');
    expect(customerJobBoardChoice(false, {
      ...empty,
      state: 'unavailable',
      totals: { active: null, contractor: null, federal: null, cleared: null, contingent: null },
    })).toBe('direct');
    expect(customerJobBoardChoice(false, null)).toBe('funnels');
  });

  it('applies filters: a contractor-only filter shows no federal rows', () => {
    expect(buildUsaJobsBoard(rows, { source: 'jsearch' }).listings).toHaveLength(0);
    expect(buildUsaJobsBoard(rows, { clearance: 'none-stated' }).listings).toHaveLength(0);
  });
});

describe('an unproven USAJobs response is unavailable, never a confirmed zero', () => {
  const json = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

  it('fetchUSAJobs throws on a 200 with no SearchResult.SearchResultItems array', async () => {
    vi.stubEnv('USAJOBS_API_KEY', 'test-key');
    try {
      await expect(fetchUSAJobs('1102', 30, json({}) as never)).rejects.toThrow(/SearchResultItems/);
      await expect(fetchUSAJobs('1102', 30, json({ SearchResult: {} }) as never)).rejects.toThrow(/SearchResultItems/);
      await expect(fetchUSAJobs('1102', 30, json({ SearchResult: { SearchResultItems: 'x' } }) as never)).rejects.toThrow(/SearchResultItems/);
    } finally { vi.unstubAllEnvs(); }
  });

  it('a real empty search (an empty array) is a confirmed zero', async () => {
    vi.stubEnv('USAJOBS_API_KEY', 'test-key');
    try {
      const rows = await fetchUSAJobs('1102', 30, json({ SearchResult: { SearchResultItems: [], UserArea: { NumberOfPages: '1' } } }) as never);
      expect(rows).toEqual([]);
    } finally { vi.unstubAllEnvs(); }
  });

  it('`{}` never yields state ok with totals.active === 0', async () => {
    vi.stubEnv('USAJOBS_API_KEY', 'test-key');
    vi.stubGlobal('fetch', json({}));
    try {
      const board = await readJobBoardFromUsaJobs();
      expect(board).not.toBeNull();
      expect(board!.state).toBe('unavailable');
      expect(board!.totals.active).toBeNull();
      expect(board!.state === 'ok' && board!.totals.active === 0).toBe(false);
    } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
  });
});
