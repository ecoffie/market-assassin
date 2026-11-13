import { beforeEach, describe, expect, it, vi } from 'vitest';

const read = vi.fn();
vi.mock('@/lib/admin/member-wins-snapshot', () => ({ readMemberProof: () => read() }));

import { GET } from '../route';

describe('GET /api/public/customer-stats', () => {
  beforeEach(() => read.mockReset());

  it('returns available:false (never zeros) when there is no fresh snapshot', async () => {
    read.mockResolvedValue(null);
    const body = await (await GET()).json();
    expect(body).toEqual({ available: false });
  });

  it('returns available:false for an old snapshot without the new fields', async () => {
    read.mockResolvedValue({ lifetimeDollars: 1e9, companiesWithWins: 2, contracts: 3, members: 10, computedAt: '2026-11-10T00:00:00Z' });
    expect(await (await GET()).json()).toEqual({ available: false });
  });

  it('returns the aggregates when the snapshot is complete', async () => {
    read.mockResolvedValue({
      lifetimeDollars: 1e9, companiesWithWins: 27, contracts: 1164, members: 1700, computedAt: '2026-11-10T00:00:00Z',
      sinceJoining: { dollars: 5e6, contracts: 40, companiesWithWins: 9 }, companiesWithUei: 113,
      breakdowns: { agencies: { buckets: [], other: null }, naics: { buckets: [], other: null }, fiscalYears: [], minCompaniesPerBucket: 3 },
    });
    const body = await (await GET()).json();
    expect(body.available).toBe(true);
    expect(body.sinceJoining.contracts).toBe(40);
    expect(body.lifetime.dollars).toBe(1e9);
  });
});
