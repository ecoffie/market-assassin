import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * getCompanyDetail / resolveCompanyDetail compose the shared UEI history service
 * into the Opportunity Map company drawer payload.
 */

let historyByUeiReturn: unknown = null;
let profileReturn: unknown = null;
let setAsideMap = new Map<string, string[]>();
let similarReturn: Array<{ recipient_uei: string; recipient_name: string; total_obligated: number }> = [];
let throwSetAside = false;
let throwSimilar = false;

vi.mock('@/lib/contractor/history-by-uei', () => ({
  getContractorHistoryByUei: vi.fn(async () => historyByUeiReturn),
}));

vi.mock('./recipients', () => ({
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

vi.mock('@/lib/agency-intelligence', () => ({
  getUnifiedAgencyIntelligence: vi.fn(async () => null),
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

function foundResult(history = HISTORY) {
  return {
    uei: 'ABC123456789',
    resolution: 'found',
    name: 'Acme Federal LLC',
    history: JSON.parse(JSON.stringify(history)),
    source: 'bigquery_normalized',
    asOf: '2025-09-01',
    aggregates_cover: 'bq_ingest',
    degraded: false,
    cache: 'warm',
  };
}

async function load() {
  return await import('./company-detail');
}

beforeEach(() => {
  vi.resetModules();
  historyByUeiReturn = foundResult();
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
    expect(c!.recentAwards.length).toBe(1);
    expect(c!.topAgencies.length).toBe(2);
    expect(c!.topNaics.length).toBe(2);
    expect(c!.similar.length).toBe(1);
    expect(c!.similar[0].name).toBe('Beta Systems Inc');
    expect(c!.historySource).toBe('bigquery_normalized');
    expect(c!.aggregatesCover).toBe('bq_ingest');
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
    historyByUeiReturn = {
      uei: 'NOPE00000000',
      resolution: 'not_found',
      name: null,
      history: null,
      source: null,
      asOf: null,
      aggregates_cover: null,
      degraded: false,
      cache: 'none',
    };
    const { getCompanyDetail } = await load();
    expect(await getCompanyDetail('NOPE00000000')).toBeNull();
  });

  it('returns null for an empty UEI', async () => {
    historyByUeiReturn = {
      uei: '',
      resolution: 'malformed',
      name: null,
      history: null,
      source: null,
      asOf: null,
      aggregates_cover: null,
      degraded: false,
      cache: 'none',
    };
    const { getCompanyDetail } = await load();
    expect(await getCompanyDetail('   ')).toBeNull();
  });

  it('returns registered-zero company (not null) when history says registered_zero', async () => {
    historyByUeiReturn = {
      uei: 'WDMBF2J6EML3',
      resolution: 'registered_zero',
      name: 'TANAQ GLOBAL LLC',
      history: {
        lastUpdated: '2026-08-01',
        contractor: { company: 'TANAQ GLOBAL LLC', totalContractValue: 0, contractCount: 0, naics: [] },
        summary: { totalObligations: 0, awardCount: 0 },
        topAgencies: [],
        topNaics: [],
        recentAwards: [],
      },
      source: 'local_registry',
      asOf: '2026-08-01',
      aggregates_cover: 'bq_ingest',
      degraded: false,
      cache: 'registry',
    };
    profileReturn = null;
    const { getCompanyDetail } = await load();
    const c = await getCompanyDetail('WDMBF2J6EML3');
    expect(c).toBeTruthy();
    expect(c!.name).toBe('TANAQ GLOBAL LLC');
    expect(c!.awardCount).toBe(0);
    expect(c!.totalObligated).toBe(0);
    expect(c!.historyResolution).toBe('registered_zero');
  });

  it('throws on unavailable so the route can 503 (never fabricates zero)', async () => {
    historyByUeiReturn = {
      uei: 'ABC123456789',
      resolution: 'unavailable',
      name: null,
      history: null,
      source: null,
      asOf: null,
      aggregates_cover: null,
      degraded: true,
      cache: 'none',
      detail: 'Cold BigQuery budget exhausted',
    };
    const { getCompanyDetail } = await load();
    await expect(getCompanyDetail('ABC123456789')).rejects.toThrow(/unavailable|budget/i);
  });

  it('degrades (empty set-asides) instead of throwing when the set-aside lookup fails', async () => {
    throwSetAside = true;
    const { getCompanyDetail } = await load();
    const c = await getCompanyDetail('ABC123456789');
    expect(c!.setAsides).toEqual([]);
  });

  it('degrades (empty similar) instead of throwing when similar lookup fails', async () => {
    throwSimilar = true;
    const { getCompanyDetail } = await load();
    const c = await getCompanyDetail('ABC123456789');
    expect(c!.similar).toEqual([]);
  });
});
