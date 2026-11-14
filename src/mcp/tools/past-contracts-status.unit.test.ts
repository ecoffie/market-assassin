/** "Is X still active / who replaced it" in ONE call: include_status checks the top matches. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchMock = vi.hoisted(() => vi.fn());
const detailMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/usaspending/awards-search', async (orig) => {
  const real = await orig<typeof import('@/lib/usaspending/awards-search')>();
  return { ...real, searchAwardsByLocation: searchMock };
});
vi.mock('@/lib/usaspending/freshness', async (orig) => {
  const real = await orig<typeof import('@/lib/usaspending/freshness')>();
  return { ...real, fetchUsaSpendingLastUpdated: vi.fn(async () => '2026-11-13') };
});
vi.mock('./award-detail', () => ({ getAwardDetail: detailMock }));
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { aiHint: false } }));

import { searchPastContracts, STATUS_CHECK_MAX } from './past-contracts';

const row = (id: string) => ({ awardId: id, recipientName: 'MAGELLAN', recipientUei: 'X', awardAmount: 1, description: 'identification card services', startDate: '2021-08-01', endDate: '2026-07-31', agency: 'Department of Defense', subAgency: 'Department of the Navy', awardingOffice: 'NAVSUP', naicsCode: '561110', naicsDescription: '', pscCode: 'R699', pscDescription: '', recipientState: 'TN', popState: 'TN', awardType: 'D', generatedInternalId: `CONT_${id}` });
const result = (rows: unknown[]) => ({ awards: rows, total: rows.length, degraded: false, requestsFired: 1, stateScope: 'pop', textFilters: {} });

beforeEach(() => { searchMock.mockReset(); detailMock.mockReset(); });

describe('include_status', () => {
  it('attaches status, end date and the successor result for the top matches', async () => {
    searchMock.mockResolvedValue(result([row('N0018921F3006')]));
    detailMock.mockResolvedValue({ status: 'expired', days_until_end: -105, status_basis: { end_date_used: '2026-07-31' }, successor: { state: 'candidates', candidates: [{ award_id: 'N0018926FD111' }] } });
    const r = await searchPastContracts({ keyword: 'identification card', agency: 'Navy', state: 'TN', include_status: true });
    expect(detailMock).toHaveBeenCalledWith({ piid: 'N0018921F3006' });
    expect(r.status_checks).toEqual([{ award_id: 'N0018921F3006', status: 'expired', days_until_end: -105, end_date: '2026-07-31', successor: { state: 'candidates', candidates: [{ award_id: 'N0018926FD111' }] } }]);
    expect(r._meta.applied_filters).toMatchObject({ include_status: true });
  });
  it('checks at most STATUS_CHECK_MAX awards and isolates a failed check', async () => {
    searchMock.mockResolvedValue(result(['A1', 'A2', 'A3', 'A4', 'A5'].map(row)));
    detailMock.mockImplementation(async ({ piid }: { piid: string }) => {
      if (piid === 'A2') throw new Error('usaspending down');
      return { status: 'active', days_until_end: 10, status_basis: { end_date_used: '2026-11-24' }, successor: null };
    });
    const r = await searchPastContracts({ keyword: 'x', include_status: true });
    expect(r.status_checks).toHaveLength(STATUS_CHECK_MAX);
    expect(r.status_checks![1]).toMatchObject({ award_id: 'A2', status: 'unknown', error: 'usaspending down' });
  });
  it('does nothing extra when not requested', async () => {
    searchMock.mockResolvedValue(result([row('A1')]));
    const r = await searchPastContracts({ keyword: 'x' });
    expect(r.status_checks).toBeUndefined();
    expect(detailMock).not.toHaveBeenCalled();
  });
});
