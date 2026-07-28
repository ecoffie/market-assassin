/**
 * Follow-on capture (Eric 2026-07-27, NRWA case). The lib finds an expired contract's already-awarded
 * successor anchored on the recipient UEI (NOT phrase/title matching, which returned confident garbage
 * — NRWA → Radiance/Group-W). These tests pin the anti-garbage GUARDS with a mocked USASpending.
 */
import { describe, it, expect } from 'vitest';
import { findFollowOnAward } from './find-followon';

const parent = {
  piid: '12SAD121C0001',
  incumbent_uei: 'FHNNYNLC22N3',
  naics_code: '541611',
  awarding_agency: 'Department of Agriculture',
  period_of_performance_current_end: '2026-04-30',
};
const NOW = '2026-07-28T00:00:00Z';

// A mock fetch that returns a fixed results set.
function mockFetch(results: unknown[], ok = true) {
  return async () => ({ ok, json: async () => ({ results }) }) as unknown as Response;
}
const followOnRow = {
  'Award ID': '12RADA26C0001', 'Recipient Name': 'NATIONAL RURAL WATER ASSOCIATION',
  'Start Date': '2026-05-01', 'End Date': '2030-12-31', 'Award Amount': 14581150.41,
  'Awarding Agency': 'Department of Agriculture', 'NAICS': '541611', 'generated_internal_id': 'CONT_AWD_X',
  'Contract Award Type': 'DEFINITIVE CONTRACT',
};

describe('findFollowOnAward — UEI-anchored, no-guess', () => {
  it('returns the successor + predecessor link when a genuine later award exists', async () => {
    const r = await findFollowOnAward(parent, { fetchImpl: mockFetch([followOnRow]) as typeof fetch, nowIso: NOW });
    expect(r).not.toBeNull();
    expect(r!.piid).toBe('12RADA26C0001');
    expect(r!.predecessor_piid).toBe('12SAD121C0001');
    expect(r!.period_of_performance_current_end).toBe('2030-12-31');
    expect(r!.data_source).toBe('usaspending_followon');
    expect(r!.followon_captured_at).toBe(NOW);
  });
  it('null when the parent has no UEI (cannot anchor safely → never guesses)', async () => {
    const r = await findFollowOnAward({ ...parent, incumbent_uei: null }, { fetchImpl: mockFetch([followOnRow]) as typeof fetch, nowIso: NOW });
    expect(r).toBeNull();
  });
  it('null when the only match is the parent PIID itself (same award ≠ a follow-on)', async () => {
    const self = { ...followOnRow, 'Award ID': '12SAD121C0001', 'End Date': '2030-12-31' };
    const r = await findFollowOnAward(parent, { fetchImpl: mockFetch([self]) as typeof fetch, nowIso: NOW });
    expect(r).toBeNull();
  });
  it('null when the candidate does NOT extend beyond the parent (older/equal end date)', async () => {
    const older = { ...followOnRow, 'Award ID': 'SOME_OLD', 'End Date': '2026-04-30' };
    const r = await findFollowOnAward(parent, { fetchImpl: mockFetch([older]) as typeof fetch, nowIso: NOW });
    expect(r).toBeNull();
  });
  it('null on zero results, and never throws on a fetch/HTTP failure', async () => {
    expect(await findFollowOnAward(parent, { fetchImpl: mockFetch([]) as typeof fetch, nowIso: NOW })).toBeNull();
    const boom = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await findFollowOnAward(parent, { fetchImpl: boom, nowIso: NOW })).toBeNull();
    expect(await findFollowOnAward(parent, { fetchImpl: mockFetch([followOnRow], false) as typeof fetch, nowIso: NOW })).toBeNull();
  });
  it('picks the LATEST-start successor when several later awards exist', async () => {
    const older = { ...followOnRow, 'Award ID': 'OLD', 'Start Date': '2026-05-01', 'End Date': '2029-01-01' };
    const newer = { ...followOnRow, 'Award ID': 'NEW', 'Start Date': '2026-06-15', 'End Date': '2031-01-01' };
    const r = await findFollowOnAward(parent, { fetchImpl: mockFetch([older, newer]) as typeof fetch, nowIso: NOW });
    expect(r!.piid).toBe('NEW');
  });
});
