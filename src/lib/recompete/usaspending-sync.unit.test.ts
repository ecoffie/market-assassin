import { describe, expect, it, vi } from 'vitest';
import { AWARD_GROUPS, fetchExpiringForNaics } from './usaspending-sync';

// Fixed "today" so the end-date window is deterministic.
const TODAY = new Date('2026-07-16T00:00:00Z');

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function contractAward(overrides: Record<string, unknown> = {}) {
  return {
    'Award ID': 'PIID-1',
    'Recipient Name': 'ACME CONSTRUCTION LLC',
    'Recipient UEI': 'ABC123DEF456',
    'Awarding Agency': 'Department of Defense',
    'Award Amount': 5_000_000,
    'End Date': '2027-01-15',
    'NAICS Code': '236220',
    generated_internal_id: 'CONT_AWD_PIID-1_9700',
    ...overrides,
  };
}

describe('AWARD_GROUPS', () => {
  it('keeps contract and IDV codes in separate groups (the API rejects mixing)', () => {
    const overlap = AWARD_GROUPS.contracts.codes.filter((c) =>
      (AWARD_GROUPS.idvs.codes as readonly string[]).includes(c)
    );
    expect(overlap).toEqual([]);
  });

  it('uses the IDV-specific date field, since IDVs have no End Date', () => {
    expect(AWARD_GROUPS.contracts.dateField).toBe('End Date');
    expect(AWARD_GROUPS.idvs.dateField).toBe('Last Date to Order');
  });
});

describe('fetchExpiringForNaics', () => {
  it('throws instead of silently returning [] when the API errors', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: "'award_type_codes' must only contain types from one group." }, false, 400)
    );
    await expect(
      fetchExpiringForNaics({ naics: '236220', monthsAhead: 18, minValue: 0, fetchImpl })
    ).rejects.toThrow(/must only contain types from one group/);
  });

  it('surfaces a non-JSON 500 rather than treating it as no results', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => '<!doctype html><h1>Server Error (500)</h1>',
    }) as unknown as Response);
    await expect(
      fetchExpiringForNaics({ naics: '236220', monthsAhead: 18, minValue: 0, fetchImpl })
    ).rejects.toThrow(/HTTP 500/);
  });

  it('requests only one award-type group per call', async () => {
    const bodies: any[] = [];
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      return jsonResponse({ results: [], page_metadata: { hasNext: false } });
    });
    await fetchExpiringForNaics({ naics: '236220', monthsAhead: 18, minValue: 0, includeIdvs: true, fetchImpl });

    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      const codes: string[] = body.filters.award_type_codes;
      const hasContract = codes.some((c) => ['A', 'B', 'C', 'D'].includes(c));
      const hasIdv = codes.some((c) => c.startsWith('IDV_'));
      expect(hasContract && hasIdv).toBe(false);
    }
  });

  it('always includes the sort field in the requested fields (API requires it)', async () => {
    const bodies: any[] = [];
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      return jsonResponse({ results: [], page_metadata: { hasNext: false } });
    });
    await fetchExpiringForNaics({ naics: '236220', monthsAhead: 18, minValue: 0, includeIdvs: true, fetchImpl });
    for (const body of bodies) expect(body.fields).toContain(body.sort);
  });

  it('excludes IDVs by default', async () => {
    const bodies: any[] = [];
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      return jsonResponse({ results: [], page_metadata: { hasNext: false } });
    });
    await fetchExpiringForNaics({ naics: '236220', monthsAhead: 18, minValue: 0, fetchImpl });
    const anyIdv = bodies.some((b) => b.filters.award_type_codes.some((c: string) => c.startsWith('IDV_')));
    expect(anyIdv).toBe(false);
  });

  it('keeps awards inside the window and maps UEI', async () => {
    vi.setSystemTime(TODAY);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ results: [contractAward()], page_metadata: { hasNext: false } })
    );
    const { contracts: rows } = await fetchExpiringForNaics({ naics: '236220', monthsAhead: 18, minValue: 100_000, fetchImpl });
    expect(rows).toHaveLength(1);
    expect(rows[0].incumbent_uei).toBe('ABC123DEF456');
    expect(rows[0].contract_id).toBe('CONT_AWD_PIID-1_9700');
    expect(rows[0].period_of_performance_current_end).toBe('2027-01-15');
    vi.useRealTimers();
  });

  it('drops awards that already expired and awards beyond the horizon', async () => {
    vi.setSystemTime(TODAY);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        results: [
          contractAward({ 'Award ID': 'PAST', generated_internal_id: 'PAST', 'End Date': '2026-01-01' }),
          contractAward({ 'Award ID': 'FAR', generated_internal_id: 'FAR', 'End Date': '2035-01-01' }),
          contractAward({ 'Award ID': 'OK', generated_internal_id: 'OK', 'End Date': '2027-01-15' }),
        ],
        page_metadata: { hasNext: false },
      })
    );
    const { contracts: rows } = await fetchExpiringForNaics({ naics: '236220', monthsAhead: 18, minValue: 0, fetchImpl });
    expect(rows.map((r) => r.contract_id)).toEqual(['OK']);
    vi.useRealTimers();
  });

  it('never writes set_aside_type or competition_type (endpoint returns null for them)', async () => {
    vi.setSystemTime(TODAY);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ results: [contractAward()], page_metadata: { hasNext: false } })
    );
    const { contracts: rows } = await fetchExpiringForNaics({ naics: '236220', monthsAhead: 18, minValue: 0, fetchImpl });
    expect(rows[0]).not.toHaveProperty('set_aside_type');
    expect(rows[0]).not.toHaveProperty('competition_type');
    expect(rows[0]).not.toHaveProperty('number_of_offers');
    vi.useRealTimers();
  });

  it('applies the value floor to contracts but exempts IDVs (IDV Award Amount is 0)', async () => {
    vi.setSystemTime(TODAY);
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      const isIdv = body.filters.award_type_codes[0].startsWith('IDV_');
      if (isIdv) {
        return jsonResponse({
          results: [{
            'Award ID': 'IDV-1',
            'Recipient Name': 'VEHICLE HOLDER INC',
            'Recipient UEI': 'IDVUEI000001',
            'Awarding Agency': 'GSA',
            'Award Amount': 0,
            'Last Date to Order': '2027-03-01',
            naics_code: '236220',
            generated_internal_id: 'CONT_IDV_IDV-1_4700',
          }],
          page_metadata: { hasNext: false },
        });
      }
      return jsonResponse({
        results: [contractAward({ 'Award Amount': 500, 'Award ID': 'CHEAP', generated_internal_id: 'CHEAP' })],
        page_metadata: { hasNext: false },
      });
    });

    const { contracts: rows } = await fetchExpiringForNaics({
      naics: '236220', monthsAhead: 18, minValue: 100_000, includeIdvs: true, fetchImpl,
    });

    // The $500 contract is below the floor and dropped; the $0 IDV survives.
    expect(rows.map((r) => r.contract_id)).toEqual(['CONT_IDV_IDV-1_4700']);
    expect(rows[0].data_source).toBe('usaspending-sync-idv');
    vi.useRealTimers();
  });

  it('stops paging once a page is entirely older than today', async () => {
    vi.setSystemTime(TODAY);
    let page = 0;
    const fetchImpl = vi.fn(async () => {
      page++;
      if (page === 1) {
        return jsonResponse({ results: [contractAward({ 'End Date': '2027-01-15' })], page_metadata: { hasNext: true } });
      }
      return jsonResponse({
        results: [contractAward({ 'Award ID': 'OLD', generated_internal_id: 'OLD', 'End Date': '2020-01-01' })],
        page_metadata: { hasNext: true },
      });
    });
    await fetchExpiringForNaics({ naics: '236220', monthsAhead: 18, minValue: 0, fetchImpl });
    // Page 2 was entirely in the past -> stop, do not walk all 60 pages.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('truncation reporting', () => {
  it('reports truncatedGroups when the page budget runs out before today', async () => {
    vi.setSystemTime(TODAY);
    // Every page stays in the future, so the walk never reaches today.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ results: [contractAward({ 'End Date': '2027-06-01' })], page_metadata: { hasNext: true } })
    );
    const { truncatedGroups } = await fetchExpiringForNaics({
      naics: '236220', monthsAhead: 18, minValue: 0, maxPages: 3, fetchImpl,
    });
    expect(truncatedGroups).toEqual(['contracts']);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('reports no truncation when the walk reaches today', async () => {
    vi.setSystemTime(TODAY);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ results: [contractAward({ 'End Date': '2020-01-01' })], page_metadata: { hasNext: true } })
    );
    const { truncatedGroups } = await fetchExpiringForNaics({
      naics: '236220', monthsAhead: 18, minValue: 0, maxPages: 10, fetchImpl,
    });
    expect(truncatedGroups).toEqual([]);
    vi.useRealTimers();
  });
});
