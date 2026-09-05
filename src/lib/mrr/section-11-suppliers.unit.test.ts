/**
 * §11 Potential Supplier Information — done-tests + fail-closed mutation guards.
 *
 * Mutation targets (must FAIL CLOSED):
 * - Failed depth → unknown counts (never true_zero / "0 suppliers" as absence finding)
 * - Truncated sample_coverage < 1 → limitation; raw count is sample, not population
 * - One corporate family / two UEIs → raw=2, deduplicatedFamilyCount=1
 */
import { describe, it, expect } from 'vitest';
import { buildSection11 } from './section-11-suppliers';
import { normalizeRequirement } from './normalizer';
import type { CorporateFamilyResolution, EvidenceRef } from './types';

const REQ = normalizeRequirement({
  title: 'Janitorial Services',
  agency: 'Department of Defense',
  naics: '561720',
  keyword: 'janitorial',
  description: 'Facilities janitorial support.',
  place_of_performance_state: 'FL',
}).normalized;

const EV: EvidenceRef = {
  source: 'Mindy MCP assess_market_depth',
  retrievedAt: '2026-09-05T12:00:00.000Z',
  query: { naics: '561720', set_aside: 'Small Business', limit: 50, state: 'FL' },
};

function family(
  uei: string,
  opts: {
    familyKey?: string;
    displayName?: string;
    eligible?: boolean;
    confidence?: CorporateFamilyResolution['confidence'];
    method?: CorporateFamilyResolution['method'];
  } = {},
): CorporateFamilyResolution {
  const eligible = opts.eligible !== false;
  const key = opts.familyKey ?? `family:${uei}`;
  return {
    canonical: eligible
      ? { familyKey: key, displayName: opts.displayName ?? `Canonical ${uei}` }
      : null,
    memberUeis: [uei],
    method: opts.method ?? (eligible ? 'usaspending_parent_uei' : 'lookup_failed'),
    confidence: opts.confidence ?? (eligible ? 'high' : 'unresolved'),
    evidence: {
      source: 'injected_fixture',
      query: { uei },
      parentUeiDistinct: eligible ? ['PARENT1'] : [],
      support: [],
      retrievedAt: EV.retrievedAt,
      warehouseAsOf: '2026-09-01',
    },
    asOf: '2026-09-01',
    rawUei: uei,
    ruleOfTwoEligible: eligible,
    ...(eligible ? {} : { ineligibleReason: 'lookup failed in fixture' }),
  };
}

function biz(
  uei: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    uei,
    legalBusinessName: `Legal ${uei}`,
    cageCode: '1ABC2',
    state: 'FL',
    city: 'Tampa',
    pocName: 'Jane Doe',
    certifications: ['8(a)', 'WOSB'],
    totalObligated: 1_000_000,
    awardCount: 5,
    distinctAgencyCount: 2,
    lastActionDate: '2025-06-01',
    score: 80,
    tier: 'active_performer',
    ...overrides,
  };
}

describe('§11 missing NAICS', () => {
  it('returns unknown counts and explains the missing NAICS in efforts', async () => {
    const s = await buildSection11(REQ, undefined, {
      resolveFamily: async (uei) => family(uei),
    });
    expect(s.suppliers).toHaveLength(0);
    expect(s.rawUeiCount.state).toBe('unknown');
    expect(s.deduplicatedFamilyCount.state).toBe('unknown');
    expect(s.effortsToLocate.state).toBe('value');
    expect((s.effortsToLocate as { value: string }).value).toMatch(/primary NAICS/i);
    expect(s.calls).toHaveLength(0);
    expect(s.limitations.some((l) => /Primary NAICS missing/i.test(l))).toBe(true);
  });
});

describe('§11 mutation: failed / degraded depth must not become true_zero', () => {
  it('FAILED depth → unknown counts, never true_zero / fabricated empty market', async () => {
    const s = await buildSection11(REQ, '561720', {
      depthOk: false,
      depthError: 'ECONNRESET',
      depthEvidence: EV,
      resolveFamily: async (uei) => family(uei),
    });
    expect(s.suppliers).toHaveLength(0);
    expect(s.rawUeiCount.state).toBe('unknown');
    expect(s.deduplicatedFamilyCount.state).toBe('unknown');
    expect(JSON.stringify(s.rawUeiCount)).toContain('ECONNRESET');
    expect(s.rawUeiCount.state).not.toBe('true_zero');
    expect(s.deduplicatedFamilyCount.state).not.toBe('true_zero');
    expect((s.effortsToLocate as { value: string }).value).toMatch(/FAILED/);
    // Must not read like a measured "0 suppliers" finding
    expect(JSON.stringify(s)).not.toMatch(/no capable suppliers in sample/);
  });

  it('DEGRADED depth → unknown counts, empty suppliers, efforts log degradation', async () => {
    const s = await buildSection11(REQ, '561720', {
      depthResult: {
        businesses: [biz('UEIAAA111111')],
        sample_coverage: 1,
        _meta: { grounded: true, degraded: true },
      },
      depthEvidence: EV,
      resolveFamily: async (uei) => family(uei),
    });
    expect(s.suppliers).toHaveLength(0);
    expect(s.rawUeiCount.state).toBe('unknown');
    expect(s.deduplicatedFamilyCount.state).toBe('unknown');
    expect(s.rawUeiCount.state).not.toBe('true_zero');
    expect((s.effortsToLocate as { value: string }).value).toMatch(/degraded/i);
  });
});

describe('§11 measured empty sample', () => {
  it('grounded:false + empty businesses → true_zero with the sample label', async () => {
    const s = await buildSection11(REQ, '561720', {
      depthResult: {
        businesses: [],
        sample_coverage: 1,
        capable_depth: 0,
        _meta: { grounded: false, degraded: false },
      },
      depthEvidence: EV,
      resolveFamily: async (uei) => family(uei),
    });
    expect(s.rawUeiCount.state).toBe('true_zero');
    expect((s.rawUeiCount as { label: string }).label).toBe('no capable suppliers in sample');
    expect(s.deduplicatedFamilyCount.state).toBe('true_zero');
    expect(s.suppliers).toHaveLength(0);
  });
});

describe('§11 mutation: truncated sample is not a population', () => {
  it('sample_coverage < 1 adds a limitation and still reports sample UEI count as value', async () => {
    const s = await buildSection11(REQ, '561720', {
      depthResult: {
        businesses: [biz('UEIAAA111111'), biz('UEIBBB222222', { score: 60, tier: 'capable' })],
        sample_coverage: 0.05,
        eligible_population: 400,
        capable_depth: 2,
        market_depth: 2,
        _meta: { grounded: true, degraded: false },
      },
      depthEvidence: EV,
      resolveFamily: async (uei) => family(uei),
    });
    expect(s.rawUeiCount).toMatchObject({ state: 'value', value: 2 });
    expect(s.limitations.some((l) => /sample_coverage=0\.05/.test(l))).toBe(true);
    expect(s.limitations.some((l) => /not the eligible population/i.test(l))).toBe(true);
    expect((s.effortsToLocate as { value: string }).value).toMatch(/sample_coverage=0\.05/);
    // Must not claim the sample size is the population
    expect(JSON.stringify(s.limitations)).not.toMatch(/complete population/i);
  });
});

describe('§11 corporate-family dedup', () => {
  it('one family / two UEIs → rawUeiCount 2, deduplicatedFamilyCount 1, one table row', async () => {
    const s = await buildSection11(REQ, '561720', {
      depthResult: {
        businesses: [
          biz('UEIAAA111111', { score: 90, awardCount: 10, totalObligated: 5_000_000 }),
          biz('UEIBBB222222', {
            score: 55,
            tier: 'capable',
            awardCount: 2,
            totalObligated: 100_000,
            legalBusinessName: 'Sister Co',
          }),
        ],
        sample_coverage: 1,
        capable_depth: 2,
        _meta: { grounded: true, degraded: false },
      },
      depthEvidence: EV,
      resolveFamily: async (uei) =>
        family(uei, {
          familyKey: 'family:PARENT1',
          displayName: 'Parent Holdings LLC',
          eligible: true,
          confidence: 'high',
        }),
    });
    expect(s.rawUeiCount).toMatchObject({ state: 'value', value: 2 });
    expect(s.deduplicatedFamilyCount).toMatchObject({ state: 'value', value: 1 });
    expect(s.suppliers).toHaveLength(1);
    // Richest member kept
    expect(s.suppliers[0].uei).toMatchObject({ state: 'value', value: 'UEIAAA111111' });
    expect(s.suppliers[0].canonicalName).toMatchObject({
      state: 'value',
      value: 'Parent Holdings LLC',
    });
  });

  it('unresolved family still appears as a UEI row but is excluded from dedup count', async () => {
    const s = await buildSection11(REQ, '561720', {
      depthResult: {
        businesses: [
          biz('UEIGOOD11111'),
          biz('UEIBAD222222', { score: 50, tier: 'capable' }),
        ],
        sample_coverage: 1,
        _meta: { grounded: true, degraded: false },
      },
      depthEvidence: EV,
      resolveFamily: async (uei) => {
        if (uei === 'UEIBAD222222') {
          return family(uei, { eligible: false, confidence: 'unresolved', method: 'lookup_failed' });
        }
        return family(uei, { familyKey: 'family:GOOD', eligible: true });
      },
    });
    expect(s.rawUeiCount).toMatchObject({ state: 'value', value: 2 });
    expect(s.deduplicatedFamilyCount).toMatchObject({ state: 'value', value: 1 });
    expect(s.suppliers).toHaveLength(2);
    const bad = s.suppliers.find((r) => r.uei.state === 'value' && r.uei.value === 'UEIBAD222222');
    expect(bad).toBeTruthy();
    expect(bad!.resolutionConfidence.state).toBe('unknown');
  });

  it('fleet-wide resolve failure → deduplicatedFamilyCount unknown', async () => {
    const s = await buildSection11(REQ, '561720', {
      depthResult: {
        businesses: [biz('UEIAAA111111'), biz('UEIBBB222222', { tier: 'capable', score: 50 })],
        sample_coverage: 1,
        _meta: { grounded: true, degraded: false },
      },
      depthEvidence: EV,
      resolveFamily: async (uei) =>
        family(uei, { eligible: false, method: 'lookup_failed', confidence: 'unresolved' }),
    });
    expect(s.rawUeiCount).toMatchObject({ state: 'value', value: 2 });
    expect(s.deduplicatedFamilyCount.state).toBe('unknown');
    expect(s.suppliers).toHaveLength(2);
  });
});

describe('§11 field honesty', () => {
  it('missing CAGE / POC / size are unknown — never empty string or false', async () => {
    const s = await buildSection11(REQ, '561720', {
      depthResult: {
        businesses: [
          biz('UEIAAA111111', {
            cageCode: null,
            pocName: null,
            certifications: ['HUBZone'],
          }),
        ],
        sample_coverage: 1,
        _meta: { grounded: true, degraded: false },
      },
      depthEvidence: EV,
      resolveFamily: async (uei) => family(uei),
    });
    expect(s.suppliers).toHaveLength(1);
    const row = s.suppliers[0];
    expect(row.cage.state).toBe('unknown');
    expect(row.poc.state).toBe('unknown');
    expect(row.businessSize.state).toBe('unknown');
    expect(JSON.stringify(row.cage)).not.toContain('"value":""');
    expect(JSON.stringify(row.businessSize)).not.toMatch(/"value":false/);
    expect(row.socioeconomic).toMatchObject({ state: 'value', value: ['HUBZone'] });
    expect(row.capabilityEvidence.state).toBe('value');
    expect(row.relevantAwardEvidence.state).toBe('value');
  });

  it('emerging-only sample does not invent capable suppliers in the table', async () => {
    const s = await buildSection11(REQ, '561720', {
      depthResult: {
        businesses: [biz('UEIEMERGE001', { tier: 'emerging', score: 30 })],
        sample_coverage: 1,
        capable_depth: 0,
        _meta: { grounded: true, degraded: false },
      },
      depthEvidence: EV,
      resolveFamily: async (uei) => family(uei),
    });
    expect(s.rawUeiCount).toMatchObject({ state: 'value', value: 1 });
    expect(s.suppliers).toHaveLength(0);
    expect(s.limitations.some((l) => /emerging\/registered_only/i.test(l))).toBe(true);
  });

  it('records exact tool args in effortsToLocate', async () => {
    const s = await buildSection11(REQ, '561720', {
      depthResult: {
        businesses: [biz('UEIAAA111111')],
        sample_coverage: 1,
        capable_depth: 1,
        market_depth: 1,
        _meta: { grounded: true, degraded: false },
      },
      depthEvidence: EV,
      resolveFamily: async (uei) => family(uei),
    });
    const efforts = (s.effortsToLocate as { value: string }).value;
    expect(efforts).toContain('assess_market_depth');
    expect(efforts).toContain('"naics":"561720"');
    expect(efforts).toContain('"set_aside":"Small Business"');
    expect(efforts).toContain('"limit":50');
    expect(efforts).toContain('"state":"FL"');
    expect(efforts).toMatch(/1 UEI/);
  });
});
