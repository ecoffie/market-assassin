import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Issue #292: the briefing recompete section was built from a build-time JSON
 * dump (frozen 2026-04-08, grouped/synthetic rows, NO `incumbent_uei` field at
 * all) which SHADOWED every live path. It now reads the live
 * `recompete_opportunities` table via the ONE shared query.
 *
 * The regressions locked here are the ones that would look fine in prod:
 *  - a dropped UEI (issue #280's whole complaint — the payoff of this change)
 *  - a Supabase failure rendering as a clean, empty briefing instead of falling back
 */

const queryExpiringContracts = vi.fn();
const getSAMExpiringContracts = vi.fn();

vi.mock('@/lib/recompete/query', () => ({
  queryExpiringContracts: (...args: unknown[]) => queryExpiringContracts(...args),
}));
vi.mock('@/lib/sam', () => ({
  getExpiringContracts: (...args: unknown[]) => getSAMExpiringContracts(...args),
  searchContractAwards: vi.fn(),
}));

import { fetchExpiringContractsFromDb } from './fpds-recompete';

const FAR_FUTURE = new Date(Date.now() + 200 * 86400_000).toISOString().split('T')[0];
const SOONER = new Date(Date.now() + 20 * 86400_000).toISOString().split('T')[0];

function row(over: Record<string, unknown> = {}) {
  return {
    contract_id: 'CONT_AWD_1',
    piid: 'W52P1J20C0005',
    incumbent_name: 'ACCENTURE FEDERAL SERVICES LLC',
    incumbent_uei: 'C47BNA8GM833',
    awarding_agency: 'Department of Defense',
    awarding_sub_agency: 'Department of the Army',
    naics_code: '541512',
    naics_description: 'Computer Systems Design Services',
    psc_code: 'D302',
    total_obligation: 823189867.08,
    potential_total_value: 900000000,
    period_of_performance_start: '2020-01-01',
    period_of_performance_current_end: FAR_FUTURE,
    place_of_performance_state: 'VA',
    set_aside_type: null,
    competition_type: 'Full and Open Competition',
    number_of_offers: 3,
    ...over,
  };
}

const ok = (contracts: unknown[]) => ({ contracts, total: contracts.length, degraded: false });

beforeEach(() => {
  queryExpiringContracts.mockReset();
  getSAMExpiringContracts.mockReset();
});

describe('fetchExpiringContractsFromDb — the live table replaces the frozen JSON', () => {
  it('carries incumbent_uei through to the briefing (issue #280 payoff)', async () => {
    queryExpiringContracts.mockResolvedValue(ok([row()]));

    const result = await fetchExpiringContractsFromDb({ naicsCodes: ['541512'] });

    expect(result.contracts).toHaveLength(1);
    // The old JSON path hardcoded `incumbentUei: null` — it had no such field.
    expect(result.contracts[0].incumbentUei).toBe('C47BNA8GM833');
    expect(result.contracts[0].piid).toBe('W52P1J20C0005');
    expect(result.contracts[0].incumbentName).toBe('ACCENTURE FEDERAL SERVICES LLC');
    expect(result.contracts[0].agency).toBe('Department of Defense');
    expect(result.contracts[0].naicsCode).toBe('541512');
  });

  it('queries the shared lib per NAICS code, passing the expiry window through', async () => {
    queryExpiringContracts.mockResolvedValue(ok([]));

    await fetchExpiringContractsFromDb({ naicsCodes: ['541512', '236220'], monthsToExpiration: 18 });

    expect(queryExpiringContracts).toHaveBeenCalledTimes(2);
    expect(queryExpiringContracts).toHaveBeenCalledWith(
      expect.objectContaining({ naics: '541512', monthsWindow: 18 })
    );
    expect(queryExpiringContracts).toHaveBeenCalledWith(
      expect.objectContaining({ naics: '236220', monthsWindow: 18 })
    );
  });

  it('dedupes a contract that surfaces under more than one of the user\'s codes', async () => {
    queryExpiringContracts.mockResolvedValue(ok([row()]));

    const result = await fetchExpiringContractsFromDb({ naicsCodes: ['541512', '5415'] });

    expect(result.contracts).toHaveLength(1);
    expect(result.totalCount).toBe(1);
  });

  it('sorts soonest-expiring first', async () => {
    queryExpiringContracts
      .mockResolvedValueOnce(ok([row()]))
      .mockResolvedValueOnce(
        ok([row({ contract_id: 'CONT_AWD_2', piid: 'SOON1', period_of_performance_current_end: SOONER })])
      );

    const result = await fetchExpiringContractsFromDb({ naicsCodes: ['541512', '236220'] });

    expect(result.contracts.map((c) => c.piid)).toEqual(['SOON1', 'W52P1J20C0005']);
  });

  it('a DEGRADED query must NOT render as an empty briefing — it falls back to the live API', async () => {
    // The whole #292 defect class: succeeding while doing nothing.
    queryExpiringContracts.mockResolvedValue({ contracts: [], total: 0, degraded: true });
    getSAMExpiringContracts.mockResolvedValue([]);

    const result = await fetchExpiringContractsFromDb({ naicsCodes: ['541512'] });

    expect(getSAMExpiringContracts).toHaveBeenCalled();
    expect(result.contracts).toHaveLength(0);
  });

  it('a genuinely empty window returns empty WITHOUT hitting the fallback API', async () => {
    queryExpiringContracts.mockResolvedValue(ok([]));

    const result = await fetchExpiringContractsFromDb({ naicsCodes: ['541512'] });

    expect(getSAMExpiringContracts).not.toHaveBeenCalled();
    expect(result.contracts).toHaveLength(0);
  });

  it('respects the limit and caps the NAICS fan-out at 10 codes', async () => {
    queryExpiringContracts.mockResolvedValue(ok([]));

    await fetchExpiringContractsFromDb({
      naicsCodes: Array.from({ length: 14 }, (_, i) => `54151${i}`),
      limit: 50,
    });

    expect(queryExpiringContracts).toHaveBeenCalledTimes(10);
    expect(queryExpiringContracts).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });
});
