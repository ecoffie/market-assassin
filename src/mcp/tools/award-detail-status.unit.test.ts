/**
 * R5: get_award_detail ships status / days_until_end / successor (additive; award object unchanged).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchAwardDetail = vi.fn();
const resolvePiidToId = vi.fn();
vi.mock('@/lib/usaspending/award-detail', () => ({
  fetchAwardDetail: (...a: unknown[]) => fetchAwardDetail(...a),
  resolvePiidToId: (...a: unknown[]) => resolvePiidToId(...a),
}));
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { aiHint: false } }));

import { getAwardDetail } from './award-detail';

const NOW = new Date('2026-11-13T15:00:00Z');
const base = {
  awardId: 'N0018921F3006', generatedId: 'G', description: 'IDENTIFICATION CARD ADMINISTRATION (ICA)',
  recipientName: 'MAGELLAN', popStart: '2021-01-14', popEnd: '2026-07-31', popPotentialEnd: '2026-07-31',
  naicsCode: '541330', pscCode: 'R699',
};
const okEmpty = vi.fn(async () => ({ ok: true, json: async () => ({ results: [], page_metadata: { hasNext: false } }) })) as unknown as typeof fetch;

beforeEach(() => {
  fetchAwardDetail.mockReset();
  resolvePiidToId.mockReset().mockResolvedValue('G');
});

describe('get_award_detail status + successor', () => {
  it('expired award: status, days_until_end, and a successor probe that reports what it checked', async () => {
    fetchAwardDetail.mockResolvedValue(base);
    const r = await getAwardDetail({ piid: 'N0018921F3006' }, { now: NOW, fetcher: okEmpty });
    expect(r.award?.awardId).toBe('N0018921F3006'); // existing field intact
    expect(r.status).toBe('expired');
    expect(r.days_until_end).toBe(-105);
    expect(r.status_basis?.end_date_used).toBe('2026-07-31');
    expect(r.successor?.state).toBe('none_found');
    expect(r.successor?.checked.piid_office_prefix).toBe('N00189');
  });

  it('active award far from its end: no probe fired, says why', async () => {
    fetchAwardDetail.mockResolvedValue({ ...base, popEnd: '2029-01-01', popPotentialEnd: '2029-01-01' });
    const f = vi.fn() as unknown as typeof fetch;
    const r = await getAwardDetail({ piid: 'N0018921F3006' }, { now: NOW, fetcher: f });
    expect(r.status).toBe('active');
    expect(r.successor?.state).toBe('not_checked');
    expect(f).not.toHaveBeenCalled();
  });

  it('no award: status unknown, no successor', async () => {
    resolvePiidToId.mockResolvedValue(null);
    const r = await getAwardDetail({ piid: 'NOPE' }, { now: NOW, fetcher: okEmpty });
    expect(r._meta.grounded).toBe(false);
    expect(r.status).toBe('unknown');
    expect(r.days_until_end).toBeNull();
    expect(r.successor).toBeNull();
  });
});
