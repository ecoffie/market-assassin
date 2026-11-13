import { describe, expect, it } from 'vitest';
import { bucketAwards, fiscalYear, winsByFiscalYear, type AwardRow } from './member-wins';
import { toCustomerStats, type MemberProof } from './member-proof-format';

const row = (uei: string, id: string, agency: string, amount: number, first = '2025-03-01'): AwardRow => ({
  recipient_uei: uei, award_id: id, first_action: first, amount, awarding_agency: agency,
});

describe('public breakdown buckets', () => {
  it('shows only buckets with 3+ companies and folds the rest into Other', () => {
    const rows = [
      row('U1', 'A1', 'Defense', 100), row('U2', 'A2', 'Defense', 100), row('U3', 'A3', 'Defense', 100),
      // One company, huge: must NOT get its own labelled bucket.
      row('U4', 'A4', 'Energy', 10_000),
      row('U1', 'A5', 'Energy', 50),
    ];
    const set = bucketAwards(rows, (r) => r.awarding_agency, (k) => k);
    expect(set.buckets.map((b) => b.key)).toEqual(['Defense']);
    expect(set.buckets[0]).toMatchObject({ dollars: 300, contracts: 3, companies: 3 });
    expect(set.other).toEqual({ dollars: 10_050, contracts: 2, companies: 2 });
  });

  it('ignores non-positive awards, folds unknown keys into Other, and caps at top N', () => {
    const rows: AwardRow[] = [];
    for (const ag of ['A', 'B', 'C']) for (const u of ['U1', 'U2', 'U3']) rows.push(row(u, `${ag}${u}`, ag, ag === 'A' ? 30 : 20));
    rows.push(row('U1', 'neg', 'A', -500), row('U2', 'nul', '', 7));
    const set = bucketAwards(rows, (r) => r.awarding_agency, (k) => `L-${k}`, { top: 2 });
    expect(set.buckets.map((b) => b.label)).toEqual(['L-A', 'L-B']);
    expect(set.buckets[0].dollars).toBe(90);
    expect(set.other).toEqual({ dollars: 67, contracts: 4, companies: 3 });
  });

  it('returns other=null when nothing was folded', () => {
    const rows = ['U1', 'U2', 'U3'].map((u, i) => row(u, `x${i}`, 'Defense', 10));
    expect(bucketAwards(rows, (r) => r.awarding_agency, (k) => k).other).toBeNull();
  });

  it('assigns federal fiscal years and drops years with fewer than 3 companies', () => {
    expect(fiscalYear('2025-10-01')).toBe(2026);
    expect(fiscalYear('2025-09-30')).toBe(2025);
    expect(fiscalYear('nope')).toBeNull();
    const now = Date.parse('2026-11-13T00:00:00Z');
    const rows = [
      row('U1', 'a', 'X', 10, '2025-11-01'), row('U2', 'b', 'X', 10, '2025-12-01'), row('U3', 'c', 'X', 10, '2026-01-01'),
      row('U1', 'd', 'X', 10, '2024-11-01'), // FY2025 has a single company: hidden
      row('U1', 'e', 'X', 10, '2010-01-01'), row('U2', 'f', 'X', 10, '2010-01-01'), row('U3', 'g', 'X', 10, '2010-01-01'), // too old
    ];
    expect(winsByFiscalYear(rows, { now }).map((b) => b.label)).toEqual(['FY2026']);
  });
});

describe('toCustomerStats', () => {
  const base: MemberProof = { lifetimeDollars: 1e9, companiesWithWins: 27, contracts: 1164, members: 1700, computedAt: '2026-11-10T00:00:00Z' };

  it('is unavailable for a snapshot written before the new fields existed', () => {
    expect(toCustomerStats(null)).toBeNull();
    expect(toCustomerStats(base)).toBeNull();
  });

  it('projects aggregates only and drops anything extra', () => {
    const p = {
      ...base,
      sinceJoining: { dollars: 5e6, contracts: 40, companiesWithWins: 9 },
      companiesWithUei: 113,
      breakdowns: {
        agencies: { buckets: [{ key: 'Defense', label: 'Defense', dollars: 9, contracts: 3, companies: 3, uei: 'LEAK' }], other: null },
        naics: { buckets: [], other: { dollars: 1, contracts: 1, companies: 1 } },
        fiscalYears: [],
        minCompaniesPerBucket: 3,
      },
      emails: ['leak@x.com'],
    } as unknown as MemberProof;
    const s = toCustomerStats(p)!;
    expect(s.lifetime).toEqual({ dollars: 1e9, contracts: 1164, companiesWithWins: 27 });
    expect(JSON.stringify(s)).not.toContain('LEAK');
    expect(JSON.stringify(s)).not.toContain('leak@x.com');
  });
});
