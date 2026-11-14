/**
 * R10: search_past_contracts reports applied_filters, as_of and a lag_note; a lagged empty window is
 * never a verified zero. R3: piid_prefix / keyword are passed through and reported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const searchMock = vi.fn();
vi.mock('@/lib/usaspending/awards-search', async (orig) => {
  const real = await orig<typeof import('@/lib/usaspending/awards-search')>();
  return { ...real, searchAwardsByLocation: (a: unknown) => searchMock(a) };
});
const lastUpdated = vi.fn();
vi.mock('@/lib/usaspending/freshness', async (orig) => {
  const real = await orig<typeof import('@/lib/usaspending/freshness')>();
  return { ...real, fetchUsaSpendingLastUpdated: () => lastUpdated() };
});
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { aiHint: false } }));

import { searchPastContracts } from './past-contracts';
import { annotateResultContract, isVerifiedNone } from '@/lib/mcp/result-contract';

const empty = { awards: [], count: 0, totalEstimate: 0, degraded: false, requestsFired: 1 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T15:00:00Z'));
  searchMock.mockReset();
  lastUpdated.mockReset().mockResolvedValue('2026-11-13');
});
afterEach(() => vi.useRealTimers());

describe('freshness disclosure', () => {
  it('Navy October window: lag_note + as_of + partial state, and no state filter that was not asked for', async () => {
    searchMock.mockResolvedValue({ ...empty, textFilters: { keyword: { value: 'business management support', applied: 'server_keyword' } } });
    const r = await searchPastContracts({ keyword: 'business management support', agency: 'Navy', date_from: '2026-10-01', date_to: '2026-10-31', state_scope: 'pop' });
    expect(r._meta.as_of).toBe('2026-11-13');
    expect(r._meta.lag_note).toContain('not yet published');
    expect(r._meta.lag_note).toContain('2026-08-15');
    expect(r._meta.result_state).toBe('partial');
    expect(r._meta.applied_filters).toEqual({
      agency: { type: 'awarding', tier: 'subtier', name: 'Department of the Navy' },
      date_from: '2026-10-01',
      date_to: '2026-10-31',
      keyword: { value: 'business management support', applied: 'server_keyword' },
    });
    expect(r._meta.applied_filters).not.toHaveProperty('state');
    // Through the shared contract it is NOT a verified zero.
    annotateResultContract(r, { keyword: 'x' }, { properties: { keyword: { type: 'string' } } });
    expect(isVerifiedNone(r._meta)).toBe(false);
    expect(r._meta.result_state).toBe('partial');
  });

  it('a window older than the lag: no lag_note, a real zero stays a verified zero', async () => {
    searchMock.mockResolvedValue(empty);
    const r = await searchPastContracts({ agency: 'Navy', date_from: '2021-01-01', date_to: '2021-12-31', state_scope: 'pop' });
    expect(r._meta.lag_note).toBeUndefined();
    expect(r._meta.result_state).toBeUndefined();
    annotateResultContract(r, {}, { properties: {} });
    expect(r._meta.result_state).toBe('none_found');
  });

  it('no date window: no freshness fetch at all', async () => {
    searchMock.mockResolvedValue(empty);
    const r = await searchPastContracts({ naics: '541611', state_scope: 'pop' });
    expect(lastUpdated).not.toHaveBeenCalled();
    expect(r._meta.as_of).toBeUndefined();
  });
});

describe('keyword / piid_prefix pass-through', () => {
  it('normalizes piid_prefix, forwards keyword, reports both + scan in applied_filters', async () => {
    searchMock.mockResolvedValue({
      awards: [{ awardId: 'W912EQ23P0063', awardAmount: 1 }], count: 1, totalEstimate: 1, degraded: false, requestsFired: 1,
      textFilters: { piid_prefix: { value: 'W912EQ', applied: 'server_keyword_plus_client_prefix_check' }, keyword: { value: 'temporary', applied: 'client_side_description_recipient' }, scanned_rows: 1389, scan_truncated: false },
    });
    const r = await searchPastContracts({ piid_prefix: 'w912eq', keyword: 'temporary', date_from: '2019-01-01', date_to: '2024-12-31' });
    expect(searchMock.mock.calls[0][0]).toMatchObject({ piidPrefix: 'W912EQ', keyword: 'temporary' });
    expect(r.queried.piid_prefix).toBe('W912EQ');
    expect(r._meta.applied_filters?.prefix_scan).toEqual({ scanned_rows: 1389, truncated: false });
  });

  it('invalid piid_prefix / state are reported as ignored, not silently dropped', async () => {
    searchMock.mockResolvedValue(empty);
    const r = await searchPastContracts({ piid_prefix: '!', state: 'Narnia', state_scope: 'pop' });
    expect(searchMock.mock.calls[0][0].piidPrefix).toBeUndefined();
    expect(r._meta.ignored_args?.map((i) => i.arg).sort()).toEqual(['piid_prefix', 'state']);
  });

  it('a truncated prefix scan is reported as incomplete', async () => {
    searchMock.mockResolvedValue({ ...empty, textFilters: { piid_prefix: { value: 'W912EQ', applied: 'server_keyword_plus_client_prefix_check' }, keyword: { value: 'x', applied: 'client_side_description_recipient' }, scanned_rows: 1500, scan_truncated: true } });
    const r = await searchPastContracts({ piid_prefix: 'W912EQ', keyword: 'x', state_scope: 'pop' });
    expect(r._meta.incomplete_reason).toContain('1500 rows scanned');
    expect(r._meta.result_state).toBe('partial');
  });
});
