import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * getCompanyDetail composes the EXISTING BigQuery recipient functions into the
 * one-call payload the Opportunity Map company drawer renders. This test mocks the
 * recipient layer (no BQ/network) and asserts:
 *   - the composed shape (header + agencies + naics + awards + set-asides + similar)
 *   - the honest miss: an unresolved UEI → null (never a fabricated shell)
 *   - set-aside LABELS map from bucket keys (real award-derived, never invented)
 *   - locApprox is true only when the profile is state-only (no confirmed city) —
 *     the drawer's single "(approximate)" disclosure hook
 *   - a set-aside / similar lookup failure DEGRADES (empty), never sinks the drawer
 */

let historyReturn: unknown = null;
let profileReturn: unknown = null;
let setAsideMap = new Map<string, string[]>();
let similarReturn: Array<{ recipient_uei: string; recipient_name: string; total_obligated: number }> = [];
let throwSetAside = false;
let throwSimilar = false;

vi.mock('./recipients', () => ({
  getBqContractorHistory: vi.fn(async () => historyReturn),
  getRecipientByUei: vi.fn(async () => profileReturn),
  getSetAsidesForRecipients: vi.fn(async () => {
    if (throwSetAside) throw new Error('setaside boom');
    return setAsideMap;
  }),
  getSimilarRecipients: vi.fn(async () => {
    if (throwSimilar) throw new Error('similar boom');
    return similarReturn;
  }),
  recipientSlug: (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  SET_ASIDE_BUCKET_LABEL: { SDVOSB: 'SDVOSB', SB: 'Small Biz', '8A': '8(a)', WOSB: 'WOSB', HZ: 'HUBZone' },
}));

const HISTORY = {
  lastUpdated: '2025-09-01',
  contractor: { company: 'Acme Federal LLC', totalContractValue: 12_500_000, contractCount: 42, naics: ['541512'] },
  summary: { totalObligations: 12_500_000, awardCount: 42 },
  topAgencies: [
    { agency: 'DEPT OF THE ARMY', amount: 8_000_000, share: 0.64 },
    { agency: 'DEPT OF THE NAVY', amount: 4_500_000, share: 0.36 },
  ],
  topNaics: [
    { naics: '541512', description: 'Computer Systems Design', amount: 9_000_000, count: 30 },
    { naics: '541519', description: 'Other IT Services', amount: 3_500_000, count: 12 },
  ],
  recentAwards: [
    { id: 'AWD-1', title: 'IT support services', agency: 'DEPT OF THE ARMY', subAgency: 'ACC', naics: '541512', naicsDescription: 'Computer Systems Design', amount: 2_000_000, startDate: '2024-01-01', endDate: '2025-01-01', state: 'VA', url: 'https://www.usaspending.gov/award/AWD-1' },
  ],
};

async function load() {
  return await import('./company-detail');
}

beforeEach(() => {
  vi.resetModules();
  historyReturn = JSON.parse(JSON.stringify(HISTORY));
  profileReturn = { recipient_uei: 'ABC123456789', recipient_name: 'Acme Federal LLC', cage_code: '1AB23', city: 'Reston', state: 'VA', distinct_agency_count: 2, distinct_naics_count: 2, first_action_date: '2018-03-01', last_action_date: '2025-09-01' };
  setAsideMap = new Map([['ABC123456789', ['8A', 'SB']]]);
  similarReturn = [{ recipient_uei: 'XYZ999999999', recipient_name: 'Beta Systems Inc', total_obligated: 5_000_000 }];
  throwSetAside = false;
  throwSimilar = false;
});

describe('getCompanyDetail — composition', () => {
  it('returns the full composed drawer payload (all sections present)', async () => {
    const { getCompanyDetail } = await load();
    const c = await getCompanyDetail('ABC123456789');
    expect(c).toBeTruthy();
    expect(c!.name).toBe('Acme Federal LLC');
    expect(c!.uei).toBe('ABC123456789');
    expect(c!.totalObligated).toBe(12_500_000);
    expect(c!.awardCount).toBe(42);
    // award history · agencies · naics · similar all carried through
    expect(c!.recentAwards.length).toBe(1);
    expect(c!.topAgencies.length).toBe(2);
    expect(c!.topNaics.length).toBe(2);
    expect(c!.similar.length).toBe(1);
    expect(c!.similar[0].name).toBe('Beta Systems Inc');
  });

  it('maps set-aside bucket keys to human labels (real, not fabricated)', async () => {
    const { getCompanyDetail } = await load();
    const c = await getCompanyDetail('ABC123456789');
    expect(c!.setAsides).toEqual(['8A', 'SB']);
    expect(c!.setAsideLabels).toEqual(['8(a)', 'Small Biz']);
  });

  it('resolves location from the profile HQ (city present → not approximate)', async () => {
    const { getCompanyDetail } = await load();
    const c = await getCompanyDetail('ABC123456789');
    expect(c!.location).toBe('Reston, VA');
    expect(c!.locApprox).toBe(false);
  });

  it('flags locApprox when the profile has a state but NO confirmed city', async () => {
    profileReturn = { recipient_uei: 'ABC123456789', recipient_name: 'Acme Federal LLC', cage_code: null, city: null, state: 'VA' };
    const { getCompanyDetail } = await load();
    const c = await getCompanyDetail('ABC123456789');
    expect(c!.location).toBe('VA');
    expect(c!.locApprox).toBe(true);
  });
});

describe('getCompanyDetail — honesty + resilience', () => {
  it('returns null on an unresolved UEI (honest miss, no fabricated shell)', async () => {
    historyReturn = null;
    const { getCompanyDetail } = await load();
    expect(await getCompanyDetail('NOPE000000000')).toBeNull();
  });

  it('returns null for an empty UEI', async () => {
    const { getCompanyDetail } = await load();
    expect(await getCompanyDetail('   ')).toBeNull();
  });

  it('degrades (empty set-asides) instead of throwing when the set-aside lookup fails', async () => {
    throwSetAside = true;
    const { getCompanyDetail } = await load();
    const c = await getCompanyDetail('ABC123456789');
    expect(c).toBeTruthy();
    expect(c!.setAsides).toEqual([]);
    expect(c!.setAsideLabels).toEqual([]);
  });

  it('degrades (empty similar) instead of throwing when the similar lookup fails', async () => {
    throwSimilar = true;
    const { getCompanyDetail } = await load();
    const c = await getCompanyDetail('ABC123456789');
    expect(c).toBeTruthy();
    expect(c!.similar).toEqual([]);
  });
});
