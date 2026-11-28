/**
 * SDVOSB statutory goal by fiscal year: 3% through FY2024, 5% from FY2025 (Pub. L. 118-31, FY2024 NDAA, §863,
 * amending 15 U.S.C. 644(g)). The tool hardcoded 3% for every year, so FY2025+ above/below flags were scored
 * against a stale goal. A historical year must still use 3%.
 */
import { describe, it, expect, vi } from 'vitest';
import { statutoryGoalPct, fiscalYearOf, SDVOSB_5PCT_FROM_FY, STATUTORY_GOAL_SOURCE } from '@/lib/sba/statutory-goals';

const lib = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/lib/usaspending/agency-spending-detail', async (orig) => ({
  ...(await orig<object>()),
  getAgencySpendingDetail: vi.fn(async () => lib.value),
}));

// SDVOSB at 4.0%: at/above a 3% goal, below a 5% goal. Synthetic agency.
const detailFor = (fy: number) => ({
  agency: 'Department of Example', toptier_code: '999', fiscal_year: fy, total_obligated: 1_000_000_000,
  sub_agencies: [], sub_agency_structure: 'single_self_named',
  set_aside_breakdown: [
    { label: 'Small Business set-aside (SBA/SBP)', codes: ['SBA', 'SBP'], amount: 1, pct_of_total: 10 },
    { label: '8(a)', codes: ['8A', '8AN'], amount: 1, pct_of_total: 2 },
    { label: 'SDVOSB', codes: ['SDVOSBC', 'SDVOSBS'], amount: 1, pct_of_total: 4 },
    { label: 'WOSB / EDWOSB', codes: ['WOSB', 'WOSBSS', 'EDWOSB', 'EDWOSBSS'], amount: 1, pct_of_total: 1 },
    { label: 'HUBZone', codes: ['HZC', 'HZS'], amount: 1, pct_of_total: 1 },
  ],
  small_business_share: 18, set_aside_share: 18, recipient_small_business_amount: 1, recipient_small_business_share: 20,
  requested_identity: { command: 'X', service: null, parent: 'Department of Example' },
  spending: { scope: 'REQUESTED', scope_name: 'Department of Example', total: 1_000_000_000 },
  command_spending: { status: 'NOT_APPLICABLE' }, degraded: false, trace: [],
});

describe('statutoryGoalPct', () => {
  it('SDVOSB is 3% through FY2024 and 5% from FY2025; the other goals do not move', () => {
    expect(SDVOSB_5PCT_FROM_FY).toBe(2025);
    expect(statutoryGoalPct('sdvosb', 2023)).toBe(3);
    expect(statutoryGoalPct('sdvosb', 2024)).toBe(3);
    expect(statutoryGoalPct('sdvosb', 2025)).toBe(5);
    expect(statutoryGoalPct('sdvosb', 2027)).toBe(5);
    for (const fy of [2024, 2025]) {
      expect(statutoryGoalPct('small_business', fy)).toBe(23);
      expect(statutoryGoalPct('sdb_8a', fy)).toBe(5);
      expect(statutoryGoalPct('wosb', fy)).toBe(5);
      expect(statutoryGoalPct('hubzone', fy)).toBe(3);
    }
    expect(STATUTORY_GOAL_SOURCE).toMatch(/Pub\. L\. 118-31.*§863/);
  });
  it('fiscalYearOf: the federal FY starts 1 October', () => {
    expect(fiscalYearOf(new Date('2024-09-30T12:00:00Z'))).toBe(2024);
    expect(fiscalYearOf(new Date('2024-10-01T12:00:00Z'))).toBe(2025);
    expect(fiscalYearOf(new Date('2026-11-27T12:00:00Z'))).toBe(2027);
  });
});

describe('get_sba_goaling_share scores SDVOSB against the goal of the fiscal year asked', () => {
  it('FY2024: 4% SDVOSB is at/above the 3% goal', async () => {
    lib.value = detailFor(2024);
    const { getSbaGoalingShare } = await import('./sba-goaling');
    const r = await getSbaGoalingShare({ agency: 'X', fiscal_year: 2024 });
    const row = r.goals!.find((g) => g.key === 'sdvosb')!;
    expect(row).toMatchObject({ goal_pct: 3, actual_setaside_pct: 4, gap_pct: 1, meets_goal: true });
    expect(row.status_label).toContain('3% statutory goal');
  });
  it('FY2025: the same 4% is below the 5% goal', async () => {
    lib.value = detailFor(2025);
    const { getSbaGoalingShare } = await import('./sba-goaling');
    const r = await getSbaGoalingShare({ agency: 'X', fiscal_year: 2025 });
    const row = r.goals!.find((g) => g.key === 'sdvosb')!;
    expect(row).toMatchObject({ goal_pct: 5, actual_setaside_pct: 4, gap_pct: -1, meets_goal: false });
    expect(row.status_label).toContain('below the 5% statutory goal');
    expect(r._meta.goal_source).toBe(STATUTORY_GOAL_SOURCE);
    // Every other row is unchanged by the year.
    expect(Object.fromEntries(r.goals!.map((g) => [g.key, g.goal_pct]))).toEqual({ small_business: 23, sdb_8a: 5, sdvosb: 5, wosb: 5, hubzone: 3 });
  });
  it('the tool descriptions state the FY rule, never a flat "SDVOSB 3%"', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['src/lib/mcp/tool-registry.ts', 'src/mcp/server.ts']) {
      const s = readFileSync(f, 'utf8');
      expect(s).not.toMatch(/SDVOSB 3% · HUBZone/);
      expect(s).toMatch(/SDVOSB 3% through FY2024 and 5% from FY2025 per Pub\. L\. 118-31 §863/);
    }
  });
});
