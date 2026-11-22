import { describe, it, expect } from 'vitest';
import { SET_ASIDE_BUCKETS } from './agency-spending-detail';

describe('set-aside buckets (VA report 2026-11-22)', () => {
  it('WOSB / EDWOSB counts the sole-source codes too', () => {
    expect(SET_ASIDE_BUCKETS.find((b) => b.label === 'WOSB / EDWOSB')!.codes).toEqual(['WOSB', 'WOSBSS', 'EDWOSB', 'EDWOSBSS']);
  });
  it('SDVOSB never absorbs the wider veteran-owned (VOSB) codes', () => {
    const sdvosb = SET_ASIDE_BUCKETS.find((b) => b.label === 'SDVOSB')!.codes;
    expect(sdvosb).toEqual(['SDVOSBC', 'SDVOSBS']);
    expect(sdvosb.some((c) => /^VS/.test(c))).toBe(false);
  });
  it('no code is counted in two buckets', () => {
    const all = SET_ASIDE_BUCKETS.flatMap((b) => b.codes);
    expect(new Set(all).size).toBe(all.length);
  });
});

import { vi, afterEach } from 'vitest';
vi.mock('@/lib/utils/agency-list-builder', () => ({
  fetchAllUSASpendingAgencies: vi.fn(async () => [{ name: 'Department of Veterans Affairs', toptierCode: '036', abbreviation: 'VA' }]),
}));

describe('a failed bucket lookup is unknown, never $0', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('the failed bucket and the combined set-aside share are null; answered buckets keep their amounts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { filters: { set_aside_type_codes?: string[] } };
      const codes = body.filters.set_aside_type_codes;
      if (codes?.includes('WOSB')) return new Response('upstream error', { status: 500 });
      const amount = codes ? 1_000_000 : 90_000_000_000;
      return new Response(JSON.stringify({ results: [{ name: 'Department of Veterans Affairs', amount }] }), { status: 200 });
    }));
    const { getAgencySpendingDetail } = await import('./agency-spending-detail');
    const r = await getAgencySpendingDetail({ agency: 'Department of Veterans Affairs', fiscalYear: 2026 });
    const wosb = r.set_aside_breakdown.find((b) => b.label === 'WOSB / EDWOSB')!;
    expect(wosb.amount).toBeNull();
    expect(wosb.pct_of_total).toBeNull();
    expect(r.set_aside_breakdown.find((b) => b.label === 'SDVOSB')!.amount).toBe(1_000_000);
    expect(r.set_aside_share).toBeNull();
  });
});
