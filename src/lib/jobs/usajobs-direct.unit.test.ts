import { describe, expect, it } from 'vitest';
import { buildUsaJobsBoard, usajobsRowToListing } from './usajobs-direct';
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
].map((i) => usajobsRowToListing(mapUSAJob(i as never, 'series:1102')!));

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

  it('applies filters: a contractor-only filter shows no federal rows', () => {
    expect(buildUsaJobsBoard(rows, { source: 'jsearch' }).listings).toHaveLength(0);
    expect(buildUsaJobsBoard(rows, { clearance: 'none-stated' }).listings).toHaveLength(0);
  });
});
