/**
 * MarketScope retrieval-contract tests.
 *
 * Mutation targets (must FAIL CLOSED):
 * - Silent agency drop on empty history is impossible
 * - Expansion only via expandMarketScope (recorded)
 * - Office DoDAAC vs installation-context classification
 * - USSF/DAF hierarchy does not reject office-matched 30 CONS evidence
 * - CA+NAICS suppliers are labeled statewide capacity, not office supply
 * - SABER phrase coverage is not equated with the entire NAICS market
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyAwardAgainstScope,
  checkOfficeConsistency,
  buildSection9,
} from './section-9-history';
import { buildSection5 } from './section-5-taxonomy';
import { buildSection11 } from './section-11-suppliers';
import { buildSection12 } from './section-12-rule-of-two';
import { normalizeRequirement } from './normalizer';
import {
  expandMarketScope,
  extractDodaac,
  marketCapacityLabel,
  marketScopeFromRequirement,
} from './market-scope';
import type { CorporateFamilyResolution, EvidenceRef } from './types';
import { value } from './grounding';

const calls = vi.hoisted(() => ({ impl: null as null | ((t: string, a: Record<string, unknown>) => unknown) }));

vi.mock('./mindy-client', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    callTool: vi.fn(async (tool: string, args: Record<string, unknown>) => {
      const result = calls.impl ? calls.impl(tool, args) : undefined;
      const evidence = { source: `Mindy MCP ${tool}`, retrievedAt: new Date().toISOString(), query: args };
      if (result instanceof Error) return { tool, args, evidence, error: result.message, ok: false };
      return { tool, args, evidence, result, ok: true };
    }),
  };
});

beforeEach(() => { calls.impl = null; });

const VANDENBERG = normalizeRequirement({
  title: 'Small-business market for construction / SABER-type work at Vandenberg Space Force Base',
  agency: 'Department of the Air Force',
  sub_agency: 'United States Space Force',
  office: 'FA4610 / 30 CONS',
  installation: 'Vandenberg Space Force Base',
  naics: '236220',
  psc: 'Z2JZ',
  keyword: 'SABER',
  place_of_performance_state: 'CA',
  description: 'SABER-type construction at Vandenberg Space Force Base.',
}).normalized;

describe('MarketScope identity', () => {
  it('parses FA4610 from office text without treating 30 CONS as a DoDAAC', () => {
    expect(extractDodaac('FA4610 / 30 CONS')).toBe('FA4610');
    expect(extractDodaac('30 CONS')).toBeUndefined();
  });

  it('expandMarketScope records the removed dimension and does not mutate the original', () => {
    const from = marketScopeFromRequirement(VANDENBERG);
    const { scope, record } = expandMarketScope({
      from,
      remove: ['contracting_office'],
      reason: 'explicit test expansion',
      strictResultCount: 0,
      expandedResultCount: 12,
      provenance: 'unit-test',
    });
    expect(from.contractingOfficeCode).toBe('FA4610');
    expect(scope.contractingOfficeCode).toBeUndefined();
    expect(record.removed).toEqual(['contracting_office']);
    expect(record.strictResultCount).toBe(0);
  });
});

describe('buyer vs installation classification', () => {
  const scope = marketScopeFromRequirement(VANDENBERG);

  it('FA461022F0114 is in-scope buyer history', () => {
    expect(classifyAwardAgainstScope(scope, {
      awardId: 'FA461022F0114',
      awardingAgency: 'Department of Defense',
      awardingSubAgency: 'Department of the Air Force',
      awardingOffice: 'FA4610 30 CONS PK',
      description: 'Renovate Backup Satellite Operations Center, Vandenberg',
    })).toBe('in_scope');
  });

  it('W912PL26CA005 is installation-context, not DAF/30 CONS buyer history', () => {
    expect(classifyAwardAgainstScope(scope, {
      awardId: 'W912PL26CA005',
      awardingAgency: 'Department of Defense',
      awardingSubAgency: 'Department of the Army',
      awardingOffice: 'W075 ENDIST LOS ANGELES',
      description: 'AETC FTU at Vandenberg Space Force Base',
      popCity: 'Vandenberg SFB',
    })).toBe('contextual');
  });

  it('office consistency fails USACE PIID against FA4610', () => {
    const c = checkOfficeConsistency('FA4610', { awardId: 'W912PL26CA005', awardingOffice: 'W075 ENDIST LOS ANGELES' });
    expect(c?.passed).toBe(false);
  });
});

describe('§9 silent expansion is impossible', () => {
  it('does not retry search_past_contracts without agency when the agency-scoped call is empty', async () => {
    const tools: string[] = [];
    const argsLog: Array<Record<string, unknown>> = [];
    calls.impl = (t, a) => {
      tools.push(t);
      argsLog.push(a);
      if (t === 'search_past_contracts') {
        return { awards: [], _meta: { grounded: false, degraded: false, count: 0 } };
      }
      return { incumbent: null, _meta: { grounded: false, degraded: false } };
    };
    const req = normalizeRequirement({
      title: 'JOMIS',
      agency: 'Defense Health Agency',
      naics: '541512',
      psc: 'DA01',
      keyword: 'modeling',
      description: 'DHA modeling.',
      solicitation_number: 'DHA_JOMIS_JMP_20260813',
    }).normalized;
    const s = await buildSection9(req, '541512');
    const past = tools.filter((t) => t === 'search_past_contracts');
    expect(past).toHaveLength(1);
    expect(argsLog[0].agency).toBe('Defense Health Agency');
    expect(s.expansions).toEqual([]);
    expect(s.awardsFinding.state).toBe('unknown');
    expect(JSON.stringify(s.awardsFinding)).toMatch(/NOT removed/);
    expect(s.retrievalManifests.some((m) => m.consumed_scope.department === 'Defense Health Agency')).toBe(true);
  });

  it('queries awarding_office_code when a DoDAAC is present and never drops it', async () => {
    calls.impl = (t) => {
      if (t === 'search_past_contracts') {
        throw new Error('search_past_contracts must not be used as the buyer-history path when a DoDAAC is present');
      }
      return {
        incumbent: {
          awardId: 'W912PL26CA005',
          recipientName: 'Korte',
          description: 'AETC FTU at Vandenberg Space Force Base',
          awardingAgency: 'Department of Defense',
          awardingSubAgency: 'Department of the Army',
          awardingOffice: 'W075 ENDIST LOS ANGELES',
          naicsCode: '236220',
          matchConfidence: 'high',
          usaSpendingUrl: 'https://www.usaspending.gov/award/W912',
        },
        _meta: { grounded: true, degraded: false },
      };
    };
    const s = await buildSection9(VANDENBERG, '236220', {
      officeAwardLookup: async () => ({
        ok: true,
        asOf: '2026-07-23',
        retrievedAt: '2026-09-13T00:00:00.000Z',
        query: { awarding_office_code: 'FA4610' },
        rows: [{
          piid: 'FA461022F0114',
          recipientName: 'CM Construction',
          recipientUei: 'CM1234567890',
          awardAmount: 10_100_000,
          description: 'Renovate Backup Satellite Operations Center, Vandenberg',
          startDate: '2022-09-29',
          endDate: '2026-07-23',
          awardingAgency: 'Department of Defense',
          awardingSubAgency: 'Department of the Air Force',
          awardingOffice: 'FA4610 30 CONS PK',
          awardingOfficeCode: 'FA4610',
          naicsCode: '236220',
          pscCode: 'Z2JZ',
          popState: 'CA',
          popCity: 'Vandenberg SFB',
          awardType: 'DELIVERY ORDER',
          awardId: 'CONT_AWD_FA461022F0114',
          asOf: '2026-07-23',
        }],
      }),
    });
    expect(s.calls.some((c) => c.tool === 'search_past_contracts')).toBe(false);
    expect(s.awards.map((a) => a.contractNumber.state === 'value' ? a.contractNumber.value : '')).toContain('FA461022F0114');
    expect(s.awards.every((a) => a.evidenceClass === 'in_scope')).toBe(true);
    expect(s.expansions).toEqual([]);
    expect(s.predecessorEvidenceClass).toBe('contextual');
    expect(s.predecessorStatus).toBe('degraded');
    expect(JSON.stringify(s.predecessor)).toMatch(/INSTALLATION CONTEXT/);
    expect(JSON.stringify(s.predecessorCandidate)).toMatch(/W912PL26CA005/);
    const officeManifest = s.retrievalManifests.find((m) => m.tool === 'bq.awards.awarding_office_code');
    expect(officeManifest?.consumed_scope.contracting_office).toBe('FA4610');
    expect(officeManifest?.expanded_scope).toEqual({});
    expect(officeManifest?.unsupported_scope.department).toBeTruthy();
    for (const key of Object.keys(officeManifest!.requested_scope)) {
      const dim = key as keyof typeof officeManifest.consumed_scope;
      expect(
        officeManifest!.consumed_scope[dim] || officeManifest!.unsupported_scope[dim],
        `${key} disappeared from the office-history manifest`,
      ).toBeTruthy();
    }
  });

  it('office-matched DAF 30 CONS evidence is not rejected because service is USSF', async () => {
    calls.impl = () => ({
      incumbent: {
        awardId: 'FA461022F0114',
        recipientName: 'CM Construction',
        description: 'Renovate Backup Satellite Operations Center Vandenberg construction',
        awardingAgency: 'Department of Defense',
        awardingSubAgency: 'Department of the Air Force',
        awardingOffice: 'FA4610 30 CONS PK',
        naicsCode: '236220',
        matchConfidence: 'high',
        usaSpendingUrl: 'https://www.usaspending.gov/award/FA4610',
      },
      _meta: { grounded: true, degraded: false },
    });
    const s = await buildSection9(VANDENBERG, '236220', {
      officeAwardLookup: async () => ({
        ok: true, asOf: null, retrievedAt: '2026-09-13T00:00:00.000Z', query: {}, rows: [],
      }),
    });
    expect(s.predecessorEvidenceClass).toBe('in_scope');
    expect(s.predecessorChecks.find((c) => c.name === 'agency consistency')?.passed).toBe(true);
    expect(s.predecessorChecks.find((c) => c.name === 'contracting office')?.passed).toBe(true);
    expect(s.predecessorStatus).not.toBe('unknown');
  });
});

describe('§5 phrase market is not the entire NAICS market', () => {
  it('records that SABER coverage is a phrase market', async () => {
    calls.impl = (t) => {
      if (t === 'get_keyword_coverage') {
        return {
          coverage: {
            totalMarket: 96_800_000,
            coveragePct: 0.9,
            allNaics: [{ code: '236220', name: 'Commercial Building Construction', amount: 73e6, pct: 0.759 }],
            topPsc: { code: 'Z2JZ', name: 'Repair or Alteration of Other Utilities' },
          },
          _meta: { grounded: true, degraded: false },
        };
      }
      return { keywords: ['saber'], _meta: { grounded: true, degraded: false } };
    };
    const s = await buildSection5(VANDENBERG);
    expect(s.naicsBasis.state).toBe('value');
    expect((s.naicsBasis as { value: string }).value).toMatch(/PHRASE market/);
    expect((s.naicsBasis as { value: string }).value).toMatch(/not the entire NAICS 236220 federal market/);
    expect(s.marketBasis).toMatch(/not a census of the entire primary-NAICS market/);
    expect(s.retrievalManifests[0].consumed_scope.phrase).toBe('SABER');
    expect(s.retrievalManifests[0].unsupported_scope.contracting_office).toBeTruthy();
  });
});

describe('§11/§12 statewide capacity is not office supply', () => {
  const EV: EvidenceRef = {
    source: 'Mindy MCP assess_market_depth',
    retrievedAt: '2026-09-13T00:00:00.000Z',
    query: { naics: '236220', state: 'CA' },
  };

  function family(uei: string): CorporateFamilyResolution {
    return {
      canonical: { familyKey: `family:${uei}`, displayName: uei },
      memberUeis: [uei],
      method: 'self_null_or_absent_parent',
      confidence: 'medium',
      evidence: {
        source: 'injected_fixture',
        query: { uei },
        parentUeiDistinct: [],
        support: [],
        retrievedAt: EV.retrievedAt,
        warehouseAsOf: '2026-09-01',
      },
      asOf: '2026-09-01',
      rawUei: uei,
      ruleOfTwoEligible: true,
    };
  }

  it('labels CA + 236220 as statewide market-capacity and keeps RoT undetermined on a truncated sample', async () => {
    const s11 = await buildSection11(VANDENBERG, '236220', {
      depthOk: true,
      depthEvidence: EV,
      depthResult: {
        businesses: [
          { uei: 'UEI000000001', legalBusinessName: 'Alpha', tier: 'capable', state: 'CA', totalObligated: 1, awardCount: 1 },
          { uei: 'UEI000000002', legalBusinessName: 'Beta', tier: 'capable', state: 'CA', totalObligated: 1, awardCount: 1 },
        ],
        matching_uei_count: 96,
        eligible_population: 2442,
        sample_coverage: 0.039,
        _meta: { grounded: true, degraded: false },
      },
      resolveFamily: async (uei) => family(uei),
    });
    expect(s11.scopeLabel).toMatch(/California small-business capacity for NAICS 236220/);
    expect(s11.evidenceClass).toBe('contextual');
    expect(s11.observedDimensions).toEqual(['naics', 'geography']);
    expect(s11.retrievalManifests[0].unsupported_scope.contracting_office).toBeTruthy();
    expect(s11.retrievalManifests[0].consumed_scope.contracting_office).toBeUndefined();
    expect(s11.effortsToLocate.state).toBe('value');
    expect((s11.effortsToLocate as { value: string }).value).toMatch(/NOT buyer\/office-specific/);

    const s12 = await buildSection12(VANDENBERG, '236220', s11, {
      goalingOk: true,
      goalingResult: {
        agency: 'Department of the Air Force',
        fiscal_year: 2025,
        goals: [],
        _meta: { grounded: false },
      },
    });
    expect(s12.determination).toMatchObject({ state: 'value', value: 'undetermined' });
    expect(s12.recommendation.state).toBe('value');
    expect((s12.recommendation as { value: string }).value).toMatch(/Insufficient evidence to support a set-aside/);
    expect((s12.recommendation as { value: string }).value).toMatch(/California small-business capacity/);
    expect((s12.recommendation as { value: string }).value).toMatch(/FA4610 was NOT consumed/);
    expect(s12.observedDimensions).not.toContain('contracting_office');
  });

  it('marketCapacityLabel never claims an office census', () => {
    expect(marketCapacityLabel(marketScopeFromRequirement(VANDENBERG), '236220')).toBe(
      'California small-business capacity for NAICS 236220',
    );
  });
});
