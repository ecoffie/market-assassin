import { describe, it, expect } from 'vitest';
import { recompeteVehicleKey, groupRecompetesByVehicle } from './vehicle-grouping';

/**
 * Vehicle grouping collapses the N winners of ONE multiple-award IDIQ into ONE
 * recompete card (Eric: "5 winners showed as 5 recompetes"). This is the exact
 * logic behind the truthful global count on the Recompetes panel — the D-type
 * position detection (idx 7 vs 8) had a real bug (VA T4NG winners never collapsed,
 * fixed Jun 25). These lock that behavior so it can't silently regress.
 */

type Row = Parameters<typeof recompeteVehicleKey>[0] & {
  incumbent_name?: string | null;
  potential_total_value?: number | null;
  total_obligation?: number | null;
  period_of_performance_current_end?: string | null;
};

describe('recompeteVehicleKey — the IDV-root grouping key', () => {
  // NOTE ON PIID LENGTHS (verified against the actual strip logic): the root is
  // stripped ONLY when the PIID is long enough to carry a trailing task/order serial
  // (>= dIdx+6 chars, i.e. the ~16-17-char awardee/order form). The 12-13-char base
  // IDV PIIDs in the source comment (VA11816D1005) do NOT strip — real USASpending
  // recompete rows are the longer awardee-order PIIDs, which is what groups.
  it('gives two awardees of the SAME VA IDV (6-char agency, D at idx 7) the SAME key', () => {
    // VA IDV base 36C10B18D + order serials → root strips the trailing 4.
    const a = recompeteVehicleKey({ piid: '36C10B18D00010005', awarding_agency: 'VA', naics_code: '541512' });
    const b = recompeteVehicleKey({ piid: '36C10B18D00010007', awarding_agency: 'VA', naics_code: '541512' });
    expect(a).toBe(b);
  });

  it('gives two awardees of a standard 8-char-agency IDV (D at idx 8) the SAME key', () => {
    // 70B04C19D0000 base + order serials (17-char) → root 70B04C19D0000
    const a = recompeteVehicleKey({ piid: '70B04C19D00000001', awarding_agency: 'DHS', naics_code: '541519' });
    const b = recompeteVehicleKey({ piid: '70B04C19D00000042', awarding_agency: 'DHS', naics_code: '541519' });
    expect(a).toBe(b);
  });

  it('does NOT merge IDVs from different fiscal years (FY is kept in the root)', () => {
    // Different FY (18 vs 19) = genuinely different vehicles → different keys.
    const fy18 = recompeteVehicleKey({ piid: '70B04C18D00000001', awarding_agency: 'DHS', naics_code: '541519' });
    const fy19 = recompeteVehicleKey({ piid: '70B04C19D00000001', awarding_agency: 'DHS', naics_code: '541519' });
    expect(fy18).not.toBe(fy19);
  });

  it('keeps a definitive contract (no D-type char) as its own unique key', () => {
    // Type 'C'/'F' single award — no idx-7/8 'D', so root = the full PIID.
    const a = recompeteVehicleKey({ piid: 'W912DR21C0005', awarding_agency: 'ARMY', naics_code: '236220' });
    const b = recompeteVehicleKey({ piid: 'W912DR21C0006', awarding_agency: 'ARMY', naics_code: '236220' });
    expect(a).not.toBe(b);
  });

  it('separates same-root IDVs when agency OR naics differ (key includes both)', () => {
    const base = { piid: 'VA11816D1005' };
    expect(recompeteVehicleKey({ ...base, awarding_agency: 'VA', naics_code: '541512' }))
      .not.toBe(recompeteVehicleKey({ ...base, awarding_agency: 'ARMY', naics_code: '541512' }));
    expect(recompeteVehicleKey({ ...base, awarding_agency: 'VA', naics_code: '541512' }))
      .not.toBe(recompeteVehicleKey({ ...base, awarding_agency: 'VA', naics_code: '236220' }));
  });

  it('normalizes the "(+N more)" display artifact + punctuation before keying', () => {
    const clean = recompeteVehicleKey({ piid: '36C10B18D00010005', awarding_agency: 'VA', naics_code: '541512' });
    const messy = recompeteVehicleKey({ piid: '36c10b18d0001-0005 (+3 more)', awarding_agency: 'va', naics_code: '541512' });
    expect(messy).toBe(clean);
  });
});

describe('groupRecompetesByVehicle — collapse + rollup', () => {
  const idvAwardees: Row[] = [
    { piid: '36C10B18D00010005', awarding_agency: 'VA', naics_code: '541512', incumbent_name: 'Alpha Inc', potential_total_value: 30_000_000, period_of_performance_current_end: '2026-09-01' },
    { piid: '36C10B18D00010007', awarding_agency: 'VA', naics_code: '541512', incumbent_name: 'Beta LLC', potential_total_value: 50_000_000, period_of_performance_current_end: '2026-12-01' },
    { piid: '36C10B18D00010009', awarding_agency: 'VA', naics_code: '541512', incumbent_name: 'Gamma Corp', potential_total_value: 20_000_000, period_of_performance_current_end: '2026-06-01' },
  ];

  it('collapses 3 awardees of one IDV into 1 vehicle (the "5 winners = 1 recompete" fix)', () => {
    const groups = groupRecompetesByVehicle(idvAwardees);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
    expect(groups[0].incumbentCount).toBe(3);
    expect(groups[0].incumbentNames.sort()).toEqual(['Alpha Inc', 'Beta LLC', 'Gamma Corp']);
  });

  it('picks the highest-ceiling awardee as the lead (the prime everyone knows)', () => {
    const groups = groupRecompetesByVehicle(idvAwardees);
    expect(groups[0].lead.incumbent_name).toBe('Beta LLC'); // $50M, the max
  });

  it('sums combinedCeiling and takes the LATEST expiry across awardees', () => {
    const groups = groupRecompetesByVehicle(idvAwardees);
    expect(groups[0].combinedCeiling).toBe(100_000_000); // 30 + 50 + 20
    expect(groups[0].latestExpiry).toBe('2026-12-01');   // the max date
  });

  it('keeps distinct definitive contracts as separate vehicles (no over-merge)', () => {
    const rows: Row[] = [
      { piid: 'W912DR21C0005', awarding_agency: 'ARMY', naics_code: '236220', incumbent_name: 'One' },
      { piid: 'W912DR21C0006', awarding_agency: 'ARMY', naics_code: '236220', incumbent_name: 'Two' },
    ];
    expect(groupRecompetesByVehicle(rows)).toHaveLength(2);
  });

  it('handles a mixed set: 1 IDV (3 awardees) + 2 standalones → 3 vehicles', () => {
    const rows: Row[] = [
      ...idvAwardees,
      { piid: 'W912DR21C0005', awarding_agency: 'ARMY', naics_code: '236220', incumbent_name: 'Solo A' },
      { piid: 'SP070023F1234', awarding_agency: 'DLA', naics_code: '332710', incumbent_name: 'Solo B' },
    ];
    const groups = groupRecompetesByVehicle(rows);
    expect(groups).toHaveLength(3);
    // the IDV group has 3 members; the standalones have 1 each
    expect(groups.map((g) => g.members.length).sort()).toEqual([1, 1, 3]);
  });

  it('falls back to member count for incumbentCount when names are blank', () => {
    const rows: Row[] = [
      { piid: '36C10B18D00010005', awarding_agency: 'VA', naics_code: '541512', incumbent_name: '' },
      { piid: '36C10B18D00010007', awarding_agency: 'VA', naics_code: '541512', incumbent_name: null },
    ];
    const groups = groupRecompetesByVehicle(rows);
    expect(groups[0].incumbentCount).toBe(2); // no names → count members
  });

  it('returns [] for empty input (no crash)', () => {
    expect(groupRecompetesByVehicle([])).toEqual([]);
  });
});
