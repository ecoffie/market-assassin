/**
 * Eric (via Agent 4, 2026-11-23): the 23% comparison must read unmistakably as a SET-ASIDE-BASED INDICATOR, not an
 * official SBA goaling scorecard — on every ROW, not only in _meta.basis / the tool description (_ai_hint is off
 * by default, so a host may see nothing but the rows).
 */
import { describe, it, expect, vi } from 'vitest';
import { goalingStatusLabel, GOALING_INDICATOR } from './sba-goaling';

const lib = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/lib/usaspending/agency-spending-detail', async (orig) => ({
  ...(await orig<object>()),
  getAgencySpendingDetail: vi.fn(async () => lib.value),
}));

const BREAKDOWN = [
  { label: 'Small Business set-aside (SBA/SBP)', codes: ['SBA', 'SBP'], amount: 536_760_447, pct_of_total: 0.6 },
  { label: '8(a)', codes: ['8A', '8AN'], amount: 4_968_126, pct_of_total: 0.01 },
  { label: 'SDVOSB', codes: ['SDVOSBC', 'SDVOSBS'], amount: 7_969_480_363, pct_of_total: 8.8 },
  { label: 'WOSB / EDWOSB', codes: ['WOSB', 'WOSBSS', 'EDWOSB', 'EDWOSBSS'], amount: null, pct_of_total: null },
  { label: 'HUBZone', codes: ['HZC', 'HZS'], amount: 4_798_057, pct_of_total: 0.01 },
];
const detail = {
  agency: 'Department of Veterans Affairs', toptier_code: '036', fiscal_year: 2026, total_obligated: 90_611_196_128,
  sub_agencies: [], sub_agency_structure: 'single_self_named', set_aside_breakdown: BREAKDOWN,
  small_business_share: 9.4, set_aside_share: 9.4, recipient_small_business_amount: 1, recipient_small_business_share: 15.6,
  requested_identity: { command: 'VA', service: null, parent: 'Department of Veterans Affairs' },
  spending: { scope: 'REQUESTED', scope_name: 'Department of Veterans Affairs', total: 90_611_196_128 },
  command_spending: { status: 'NOT_APPLICABLE' }, degraded: false, trace: [],
};

describe('every goaling row says it is a set-aside indicator', () => {
  it('measure, indicator and status label on every row; the prime row names the combined set-aside-code share', async () => {
    lib.value = detail;
    const { getSbaGoalingShare } = await import('./sba-goaling');
    const r = await getSbaGoalingShare({ agency: 'VA', fiscal_year: 2026 });
    for (const g of r.goals!) {
      expect(g.measure).toBe('set_aside_code_share');
      expect(g.indicator).toBe('Set-aside indicator, not the SBA Scorecard');
      expect(g.status_label).toMatch(/^Set-aside indicator /);
    }
    const prime = r.goals!.find((g) => g.key === 'small_business')!;
    expect(prime.category).toMatch(/combined set-aside-code share/);
    expect(prime.status_label).toBe('Set-aside indicator below the 23% statutory goal (not SBA Scorecard achievement)');
    expect(r.goals!.find((g) => g.key === 'sdvosb')!.status_label).toBe('Set-aside indicator at or above the 5% statutory goal (not SBA Scorecard achievement)'); // FY2026: 5% (Pub. L. 118-31 §863)
    expect(r.goals!.find((g) => g.key === 'wosb')!.status_label).toBe('Set-aside indicator unavailable (unknown, not below the 5% goal)');
  });

  it('no wording anywhere in the result says "meets the SBA goal" without "indicator"', async () => {
    lib.value = detail;
    const { getSbaGoalingShare } = await import('./sba-goaling');
    const text = JSON.stringify(await getSbaGoalingShare({ agency: 'VA', fiscal_year: 2026 }));
    expect(text).not.toMatch(/meets the SBA goal/i);
    for (const m of text.matchAll(/"status_label":"([^"]+)"/g)) expect(m[1]).toMatch(/indicator/i);
    expect(text).toMatch(/SET-ASIDE INDICATOR/);
  });

  it('goalingStatusLabel always names the indicator', () => {
    for (const meets of [true, false, null]) expect(goalingStatusLabel(23, meets)).toMatch(/Set-aside indicator/);
    expect(GOALING_INDICATOR).toMatch(/not the SBA Scorecard/);
  });
});

describe('MRR section 12 still drops the combined row from "By program"', () => {
  it('keys on key, so the new category text still works; /prime/i remains the fallback for an old payload', async () => {
    lib.value = detail;
    const { getSbaGoalingShare } = await import('./sba-goaling');
    const r = await getSbaGoalingShare({ agency: 'VA', fiscal_year: 2026 });
    const programs = r.goals!.filter((g) => (g.key ? g.key !== 'small_business' : !/prime/i.test(g.category)));
    expect(programs.map((g) => g.category)).toEqual(['8(a) / SDB', 'SDVOSB', 'WOSB / EDWOSB', 'HUBZone']);
    // old payload shape: no key, old category text
    const old = [{ category: 'Small Business (prime)' }, { category: 'SDVOSB' }] as Array<{ key?: string; category: string }>;
    expect(old.filter((g) => (g.key ? g.key !== 'small_business' : !/prime/i.test(g.category))).map((g) => g.category)).toEqual(['SDVOSB']);
  });
});
