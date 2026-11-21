import { describe, expect, it, vi } from 'vitest';

const loaders = vi.hoisted(() => ({
  bidder: {} as Record<string, unknown>,
  vault: { has_any: false } as Record<string, unknown>,
  calls: [] as Array<{ fn: string; args: unknown[] }>,
}));
vi.mock('@/lib/proposal/loaders', () => ({
  ALL_VAULT_SECTIONS: ['identity', 'past_performance', 'capabilities', 'team'],
  loadBidderProfile: async (...args: unknown[]) => { loaders.calls.push({ fn: 'loadBidderProfile', args }); return loaders.bidder; },
  loadVaultContext: async (...args: unknown[]) => { loaders.calls.push({ fn: 'loadVaultContext', args }); return loaders.vault; },
}));

import { buildCompanyProfile, loadCompanyProfile, parseMoney } from './company-profile';

// Test values only (no real customer): shaped like the existing loaders' output.
const VAULT = {
  has_any: true,
  identity: {
    user_email: 'x@example.com', legal_name: 'Example Staffing LLC', uei: 'abcdefgh1234',
    certifications: ['WOSB', 'HUBZone'], primary_naics: ['561320'], hq_state: 'tn',
    service_states: ['TN', 'MS', 'Tennessee'], contract_vehicles: ['GSA MAS'],
  },
  past_performance: [
    { agency: 'Department of Veterans Affairs', office: 'Memphis VA Medical Center', contract_value: '$1,200,000', role: 'Prime', naics_codes: ['561320'], relevance_keywords: ['lab staffing'] },
    { agency: 'Department of the Army', sub_agency: 'Fort Campbell', contract_value: '450K', role: 'Subcontractor', naics_codes: ['561320'], relevance_keywords: ['clerical'] },
    { agency: 'Shelby County', contract_value: 'TBD', role: '' },
  ],
  capabilities: [{ capability_name: 'Clerical staffing' }, { capability_name: 'clerical staffing' }],
  team: [],
};
const BIDDER = { naicsCodes: ['561320', '561311'], agencies: ['Department of Veterans Affairs'], setAsides: ['SDVOSB'], locationStates: ['AL'] };

describe('buildCompanyProfile', () => {
  const p = buildCompanyProfile({ bidder: BIDDER, vault: VAULT });

  it('maps identity, merges settings, and de-duplicates', () => {
    expect(p.companyName).toBe('Example Staffing LLC');
    expect(p.uei).toBe('ABCDEFGH1234');
    expect(p.naicsCodes).toEqual(['561320', '561311']);
    expect(p.states).toEqual(['TN', 'MS', 'AL']); // "Tennessee" is not a two-letter code and is dropped, not guessed
    expect(p.vehiclesHeld).toEqual(['GSA MAS']);
    expect(p.keywords).toEqual(['Clerical staffing', 'lab staffing', 'clerical']);
  });

  it('set-aside preferences are targets, never certifications', () => {
    expect(p.targetSetAsides).toEqual(['SDVOSB']);
    expect(p.certifications?.map((c) => c.name)).toEqual(['WOSB', 'HUBZone']);
    expect(p.certifications?.some((c) => c.name === 'SDVOSB')).toBe(false);
  });

  it('Vault certifications are labelled self-reported (SBA status is unknown until the SBA lookup exists)', () => {
    expect(p.certifications?.every((c) => c.source === 'self_reported')).toBe(true);
  });

  it('keeps prime and subcontract work apart; unparseable values are not zero', () => {
    expect(p.pastPerformance).toEqual({
      buyerAgencies: ['Department of Veterans Affairs', 'Department of the Army', 'Fort Campbell', 'Shelby County'],
      buyerOffices: ['Memphis VA Medical Center'],
      naicsCodes: ['561320'],
      largestAward: 1_200_000,
      primeCount: 1, subCount: 1, otherRoleCount: 1,
    });
  });

  it('nothing known → every field absent and listed as unknown (no empty arrays standing in for "none")', () => {
    const empty = buildCompanyProfile({ bidder: { naicsCodes: [], agencies: [], setAsides: [], locationStates: [] }, vault: { has_any: false } });
    expect(Object.keys(empty)).toEqual(['unknown']);
    expect(empty.unknown).toEqual(['companyName', 'uei', 'naicsCodes', 'states', 'targetAgencies', 'targetSetAsides', 'certifications', 'vehiclesHeld', 'keywords', 'pastPerformance']);
  });

  it('a partial profile lists exactly what is missing', () => {
    const partial = buildCompanyProfile({ bidder: {}, vault: { has_any: true, identity: { legal_name: 'Acme', primary_naics: ['541512'] } } });
    expect(partial).toMatchObject({ companyName: 'Acme', naicsCodes: ['541512'] });
    expect(partial.unknown).toEqual(['uei', 'states', 'targetAgencies', 'targetSetAsides', 'certifications', 'vehiclesHeld', 'keywords', 'pastPerformance']);
  });

  it('past performance with no parseable value leaves largestAward absent', () => {
    const q = buildCompanyProfile({ bidder: {}, vault: { has_any: true, past_performance: [{ agency: 'GSA', contract_value: 'see CPARS', role: 'prime' }] } });
    expect(q.pastPerformance).not.toHaveProperty('largestAward');
    expect(q.pastPerformance?.primeCount).toBe(1);
  });
});

describe('parseMoney', () => {
  it('reads common forms and returns undefined (never 0) otherwise', () => {
    expect(parseMoney('$1,200,000')).toBe(1_200_000);
    expect(parseMoney('1.2M')).toBe(1_200_000);
    expect(parseMoney('850k')).toBe(850_000);
    expect(parseMoney(42_000)).toBe(42_000);
    for (const v of ['TBD', '', '0', 0, -5, null, undefined, NaN]) expect(parseMoney(v)).toBeUndefined();
  });
});

describe('loadCompanyProfile', () => {
  it('reads only through the two existing loaders, all Vault sections, and maps the result', async () => {
    loaders.bidder = BIDDER; loaders.vault = VAULT; loaders.calls = [];
    const p = await loadCompanyProfile('x@example.com');
    expect(loaders.calls.map((c) => c.fn).sort()).toEqual(['loadBidderProfile', 'loadVaultContext']);
    expect(loaders.calls.find((c) => c.fn === 'loadVaultContext')?.args[2]).toEqual({ sections: ['identity', 'past_performance', 'capabilities', 'team'] });
    expect(p.companyName).toBe('Example Staffing LLC');
  });
});
