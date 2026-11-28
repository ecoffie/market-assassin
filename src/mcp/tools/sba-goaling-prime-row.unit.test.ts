/**
 * SBA is "Total Small Business Set-Aside (FAR 19.5)": total vs partial (SBP), not an aggregate. The bucket was
 * labelled "Small Business (total set-aside)" and get_sba_goaling_share scored the 23% prime goal on it via
 * /small business/i: VA FY2026 production showed prime actual 0.6% (gap −22.4) beside
 * _meta.small_business_setaside_share 9.4% in the same output. The prime row is the combined set-aside share.
 */
import { describe, it, expect, vi } from 'vitest';
import { SET_ASIDE_BUCKETS } from '@/lib/usaspending/agency-spending-detail';

const lib = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/lib/usaspending/agency-spending-detail', async (orig) => ({
  ...(await orig<object>()),
  getAgencySpendingDetail: vi.fn(async () => lib.value),
}));

// VA FY2026 as served live 2026-11-22 (#2365).
const VA_BREAKDOWN = [
  { label: 'Small Business set-aside (SBA/SBP)', codes: ['SBA', 'SBP'], amount: 536_760_447.19, pct_of_total: 0.6 },
  { label: '8(a)', codes: ['8A', '8AN'], amount: 4_968_126.4, pct_of_total: 0.01 },
  { label: 'SDVOSB', codes: ['SDVOSBC', 'SDVOSBS'], amount: 7_969_480_362.56, pct_of_total: 8.8 },
  { label: 'WOSB / EDWOSB', codes: ['WOSB', 'WOSBSS', 'EDWOSB', 'EDWOSBSS'], amount: 8_631_143.65, pct_of_total: 0.01 },
  { label: 'HUBZone', codes: ['HZC', 'HZS'], amount: 4_798_057.06, pct_of_total: 0.01 },
  { label: 'VOSB (VA only)', codes: ['VSA', 'VSS'], amount: 30_803_237.47, pct_of_total: 0.03 },
];
const detail = (over: Record<string, unknown> = {}) => ({
  agency: 'Department of Veterans Affairs', toptier_code: '036', fiscal_year: 2026, total_obligated: 90_611_196_127.75,
  sub_agencies: [], sub_agency_structure: 'single_self_named', set_aside_breakdown: VA_BREAKDOWN,
  small_business_share: 9.4, set_aside_share: 9.4, recipient_small_business_amount: 1, recipient_small_business_share: 15.6,
  requested_identity: { command: 'VA', service: null, parent: 'Department of Veterans Affairs' },
  spending: { scope: 'REQUESTED', scope_name: 'Department of Veterans Affairs', total: 90_611_196_127.75 },
  command_spending: { status: 'NOT_APPLICABLE' }, degraded: false, trace: [], ...over,
});

describe('set-aside bucket label', () => {
  it('SBA/SBP is labelled for what it is; no label claims to be a total', () => {
    expect(SET_ASIDE_BUCKETS[0]).toEqual({ label: 'Small Business set-aside (SBA/SBP)', codes: ['SBA', 'SBP'] });
    expect(SET_ASIDE_BUCKETS.some((b) => /total/i.test(b.label))).toBe(false);
  });
});

describe('get_sba_goaling_share prime row', () => {
  it('VA: the 23% row is the combined set-aside share (9.4), not the SBA/SBP slice (0.6)', async () => {
    lib.value = detail();
    const { getSbaGoalingShare } = await import('./sba-goaling');
    const r = await getSbaGoalingShare({ agency: 'VA', fiscal_year: 2026 });
    const prime = r.goals!.find((g) => g.key === 'small_business')!;
    expect(prime).toMatchObject({ key: 'small_business', goal_pct: 23, actual_setaside_pct: 9.4, gap_pct: -13.6, meets_goal: false });
    expect(prime.actual_setaside_pct).toBe(r._meta.small_business_setaside_share);
    expect(r._meta.meets_small_business_goal).toBe(false);
  });

  it('the four program rows are unchanged, matched by code (VOSB never counted as SDVOSB)', async () => {
    lib.value = detail();
    const { getSbaGoalingShare } = await import('./sba-goaling');
    const r = await getSbaGoalingShare({ agency: 'VA', fiscal_year: 2026 });
    const row = (c: string) => r.goals!.find((g) => g.category === c)!;
    expect(row('8(a) / SDB')).toMatchObject({ goal_pct: 5, actual_setaside_pct: 0.01 });
    expect(row('SDVOSB')).toMatchObject({ goal_pct: 5, actual_setaside_pct: 8.8, meets_goal: true }); // FY2026: 5% (Pub. L. 118-31 §863)
    expect(row('WOSB / EDWOSB')).toMatchObject({ goal_pct: 5, actual_setaside_pct: 0.01 });
    expect(row('HUBZone')).toMatchObject({ goal_pct: 3, actual_setaside_pct: 0.01 });
    expect(r.goals!.map((g) => g.category)).toEqual(['Small Business (prime): combined set-aside-code share', '8(a) / SDB', 'SDVOSB', 'WOSB / EDWOSB', 'HUBZone']);
    expect(r.goals!.map((g) => g.key)).toEqual(['small_business', 'sdb_8a', 'sdvosb', 'wosb', 'hubzone']);
  });

  it('a bucket label change cannot re-point the prime row at a single bucket', async () => {
    lib.value = detail({ set_aside_breakdown: VA_BREAKDOWN.map((b) => (b.codes.includes('SBA') ? { ...b, label: 'Small Business anything' } : b)) });
    const { getSbaGoalingShare } = await import('./sba-goaling');
    const r = await getSbaGoalingShare({ agency: 'VA', fiscal_year: 2026 });
    expect(r.goals!.find((g) => g.key === 'small_business')!.actual_setaside_pct).toBe(9.4);
  });

  it('a failed bucket: prime row unknown (null) and meets_small_business_goal null, never 0/false', async () => {
    lib.value = detail({
      set_aside_share: null, small_business_share: null,
      set_aside_breakdown: VA_BREAKDOWN.map((b) => (b.codes.includes('WOSB') ? { ...b, amount: null, pct_of_total: null } : b)),
    });
    const { getSbaGoalingShare } = await import('./sba-goaling');
    const r = await getSbaGoalingShare({ agency: 'VA', fiscal_year: 2026 });
    expect(r.goals!.find((g) => g.key === 'small_business')).toMatchObject({ actual_setaside_pct: null, gap_pct: null, meets_goal: null });
    expect(r.goals!.find((g) => g.category === 'WOSB / EDWOSB')).toMatchObject({ actual_setaside_pct: null, meets_goal: null });
    expect(r.goals!.find((g) => g.category === 'SDVOSB')!.actual_setaside_pct).toBe(8.8);
    expect(r._meta.meets_small_business_goal).toBeNull();
  });

  it('BASIS stays a floor and never claims SBA Scorecard achievement', async () => {
    lib.value = detail();
    const { getSbaGoalingShare } = await import('./sba-goaling');
    const r = await getSbaGoalingShare({ agency: 'VA', fiscal_year: 2026 });
    expect(r._meta.basis).toMatch(/FLOOR on true small-business achievement/);
    expect(r._meta.basis).toMatch(/NOT the official SBA Scorecard/);
    expect(r._meta.basis).toMatch(/prime\) row is the COMBINED set-aside-code share/);
    expect(r._meta.basis).toMatch(/recipient_small_business_share is a separate, broader read of who won/);
    expect(r._meta.basis.match(/recipient_small_business_share/g)).toHaveLength(1);
  });
});
