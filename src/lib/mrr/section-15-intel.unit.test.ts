/**
 * §15 Market Intelligence — hermetic unit tests.
 *
 * Mutation guard (required): ungrounded pricing is NEVER labeled as the IGE.
 * Grounded pricing MUST carry the phrase "supporting data, not the Government estimate".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroundedField, Requirement } from './types';
import { evidence, value, unknown, degraded, trueZero } from './grounding';

const calls = vi.hoisted(() => ({
  impl: null as null | ((t: string, a: Record<string, unknown>) => unknown),
}));

vi.mock('./mindy-client', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    callTool: vi.fn(async (tool: string, args: Record<string, unknown>) => {
      const result = calls.impl ? calls.impl(tool, args) : undefined;
      const ev = { source: `Mindy MCP ${tool}`, retrievedAt: new Date().toISOString(), query: args };
      if (result instanceof Error) return { tool, args, evidence: ev, error: result.message, ok: false };
      return { tool, args, evidence: ev, result, ok: true };
    }),
  };
});

import { buildSection15 } from './section-15-intel';

const REQ: Requirement = {
  title: 'JOMIS Joint Medical Planning, Modeling and Simulation Capabilities',
  agency: 'Defense Health Agency',
  naics: '541512',
  psc: 'DA01',
  keyword: 'modeling and simulation',
  description: 'DHA seeks joint medical planning, modeling and simulation capabilities.',
};

const EV = evidence('test fixture', { section: 15 });

const S5_OK = {
  marketTotal: value(412_600_000, EV) as GroundedField<number>,
  cumulativeCoveragePct: value(0.9, EV) as GroundedField<number>,
  coverageSet: value(
    [
      { code: '541715', name: 'R&D Physical/Engineering/Life Sciences', pct: 0.48 },
      { code: '541512', name: 'Computer Systems Design Services', pct: 0.047 },
    ],
    EV,
  ) as GroundedField<Array<{ code: string; pct: number; name?: string }>>,
  marketBasis:
    'Federal prime-contract obligations matching the exact keyword phrase, as measured by Mindy get_keyword_coverage over USASpending.',
};

const S12_OK = {
  capableFamilyCount: value(3, EV) as GroundedField<number>,
  determination: value('met' as const, EV) as GroundedField<'met' | 'not_met' | 'undetermined'>,
  recommendation: value('Rule of Two supported: 3 capable small-business families identified.', EV) as GroundedField<string>,
  socioCounts: [
    { designation: '8(a)', familyCount: value(1, EV) as GroundedField<number> },
    { designation: 'HUBZone', familyCount: value(0, EV) as GroundedField<number> },
    { designation: 'SDVOSB', familyCount: value(2, EV) as GroundedField<number> },
    { designation: 'WOSB', familyCount: trueZero('no WOSB families in sample', EV) as GroundedField<number> },
  ],
};

const PRICING_OK = {
  queried: { naics: '541512' },
  pricing: {
    laborCategories: [
      {
        category: 'Software Engineer',
        recordCount: 120,
        median: 95.5,
        percentile25: 80,
        percentile75: 110,
        min: 50,
        max: 200,
        avg: 96,
        nextYearMedian: null,
      },
    ],
    businessSizeComparison: {
      smallBusiness: { median: 90, count: 40, avg: 91 },
      largeBusiness: { median: 100, count: 80, avg: 101 },
      gapPercent: 10,
    },
    rateDistribution: [],
    priceToWinGuidance: { aggressiveRate: 80, competitiveRate: 95.5, premiumRate: 110 },
    topVendors: [],
    naicsCode: '541512',
    naicsDescription: 'Computer Systems Design Services',
    searchTermsUsed: ['software engineer'],
    totalRecordsAnalyzed: 120,
    queryDate: '2026-09-05',
  },
  _meta: { grounded: true, degraded: false, records_analyzed: 120, categories: 1, vendors: 0, from_cache: false },
};

beforeEach(() => {
  calls.impl = null;
});

describe('§15 Market Intelligence', () => {
  it('reuses §5 market total and basis without re-calling coverage', async () => {
    const tools: string[] = [];
    calls.impl = (t) => {
      tools.push(t);
      return PRICING_OK;
    };
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(s.totalMarket).toMatchObject({ state: 'value', value: 412_600_000 });
    expect(s.marketBasis).toBe(S5_OK.marketBasis);
    expect(tools).toEqual(['get_pricing_intel']);
    expect(tools).not.toContain('get_keyword_coverage');
  });

  it('derives supplier concentration from the largest NAICS share', async () => {
    calls.impl = () => PRICING_OK;
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(s.supplierConcentration.state).toBe('value');
    if (s.supplierConcentration.state === 'value') {
      expect(s.supplierConcentration.value).toMatch(/Largest NAICS share 48\.0%/);
      expect(s.supplierConcentration.value).toContain('541715');
    }
  });

  it('derives market diversity from NAICS count in the coverage set', async () => {
    calls.impl = () => PRICING_OK;
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(s.marketDiversity).toMatchObject({ state: 'value' });
    if (s.marketDiversity.state === 'value') {
      expect(s.marketDiversity.value).toMatch(/2 NAICS codes/);
    }
  });

  it('reuses §12 capable-family count and determination for SB footprint', async () => {
    calls.impl = () => PRICING_OK;
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(s.sbFootprint.state).toBe('value');
    if (s.sbFootprint.state === 'value') {
      expect(s.sbFootprint.value).toMatch(/Rule of Two met/);
      expect(s.sbFootprint.value).toMatch(/3 capable/);
      expect(s.sbFootprint.value).toContain('Recommendation (from §12)');
    }
  });

  it('formats socioeconomic footprint from §12 socioCounts', async () => {
    calls.impl = () => PRICING_OK;
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(s.socioeconomicFootprint.state).toBe('value');
    if (s.socioeconomicFootprint.state === 'value') {
      expect(s.socioeconomicFootprint.value).toContain('8(a): 1 family');
      expect(s.socioeconomicFootprint.value).toContain('SDVOSB: 2 families');
      expect(s.socioeconomicFootprint.value).toContain('WOSB: 0 families');
    }
  });

  it('calls get_pricing_intel with the primary NAICS when present', async () => {
    const seen: Record<string, unknown>[] = [];
    calls.impl = (t, a) => {
      seen.push({ tool: t, ...a });
      return PRICING_OK;
    };
    await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(seen).toEqual([{ tool: 'get_pricing_intel', naics: '541512' }]);
  });

  it('skips the pricing call when no primary NAICS is available', async () => {
    const tools: string[] = [];
    calls.impl = (t) => {
      tools.push(t);
      return PRICING_OK;
    };
    const s = await buildSection15(REQ, undefined, S5_OK, S12_OK);
    expect(tools).toEqual([]);
    expect(s.pricingEvidence.state).toBe('unknown');
    expect(s.pricingIsIge).toBe(false);
  });

  it('pricingIsIge is always the compile-time constant false', async () => {
    calls.impl = () => PRICING_OK;
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(s.pricingIsIge).toBe(false);
    // Structural: must remain the literal false, never a dynamic boolean.
    expect(s.pricingIsIge).toBe(false as const);
  });

  it('when pricing succeeds, evidence contains the supporting-data disclaimer', async () => {
    calls.impl = () => PRICING_OK;
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(s.pricingEvidence.state).toBe('value');
    if (s.pricingEvidence.state === 'value') {
      expect(s.pricingEvidence.value).toContain('supporting data, not the Government estimate');
      expect(s.pricingEvidence.value).toMatch(/competitive \$95\.50\/hr/);
      // Mentions Phase 2 / KO-owned when referring to the Independent Government Estimate role.
      expect(s.pricingEvidence.value).toMatch(/Phase 2/);
      expect(s.pricingEvidence.value).toMatch(/KO-owned/);
    }
  });

  it('section-15: ungrounded pricing never labeled as IGE', async () => {
    calls.impl = () => ({
      queried: { naics: '541512' },
      pricing: null,
      _meta: {
        grounded: false,
        degraded: false,
        records_analyzed: 0,
        categories: 0,
        vendors: 0,
        from_cache: false,
      },
    });
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(['unknown', 'degraded']).toContain(s.pricingEvidence.state);
    expect(s.pricingIsIge).toBe(false);

    const blob = JSON.stringify(s.pricingEvidence);
    // Must not claim Independent Government Estimate *dollars* as a Mindy product.
    expect(blob).not.toMatch(/Independent Government Estimate \$/);
    expect(blob).not.toMatch(/\$[\d,]+\s*(is|as)\s*(the\s+)?(IGE|Independent Government Estimate)/i);
    expect(blob).not.toMatch(/\bIGE\b(?!.*Phase 2)/); // if "IGE" appears, it must be in Phase-2/KO context
    // Explicit: no fabricated rate figures in the ungrounded field.
    expect(blob).not.toMatch(/\$\d+\.\d{2}\/hr/);
    if (s.pricingEvidence.state === 'unknown') {
      expect(s.pricingEvidence.reason).toMatch(/grounded:false|no GSA CALC/i);
    }
  });

  it('degraded pricing becomes degraded evidence — never fabricated rates', async () => {
    calls.impl = () => ({
      queried: { naics: '541512' },
      pricing: null,
      _meta: {
        grounded: false,
        degraded: true,
        records_analyzed: 0,
        categories: 0,
        vendors: 0,
        from_cache: false,
      },
    });
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(s.pricingEvidence.state).toBe('degraded');
    expect(JSON.stringify(s.pricingEvidence)).not.toMatch(/\$\d+\.\d{2}\/hr/);
    expect(s.pricingIsIge).toBe(false);
  });

  it('failed pricing call becomes unknown WITH the attempt recorded', async () => {
    calls.impl = () => new Error('CALC_TIMEOUT');
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(s.pricingEvidence.state).toBe('unknown');
    expect(JSON.stringify(s.pricingEvidence)).toContain('CALC_TIMEOUT');
    expect(JSON.stringify(s.pricingEvidence)).toContain('attemptedEvidence');
  });

  it('accepts injected pricing opts without calling the live tool', async () => {
    const tools: string[] = [];
    calls.impl = (t) => {
      tools.push(t);
      return PRICING_OK;
    };
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK, {
      pricingOk: true,
      pricingResult: PRICING_OK,
    });
    expect(tools).toEqual([]);
    expect(s.pricingEvidence.state).toBe('value');
    if (s.pricingEvidence.state === 'value') {
      expect(s.pricingEvidence.value).toContain('supporting data, not the Government estimate');
    }
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].ok).toBe(true);
  });

  it('propagates unknown coverage into concentration/diversity unknowns', async () => {
    calls.impl = () => PRICING_OK;
    const s5 = {
      ...S5_OK,
      coverageSet: unknown('no grounded coverage', [EV]) as GroundedField<
        Array<{ code: string; pct: number; name?: string }>
      >,
      marketTotal: unknown('no market', [EV]) as GroundedField<number>,
    };
    const s = await buildSection15(REQ, '541512', s5, S12_OK);
    expect(s.supplierConcentration.state).toBe('unknown');
    expect(s.marketDiversity.state).toBe('unknown');
    expect(s.totalMarket.state).toBe('unknown');
  });

  it('separates measured facts, estimates/proxies, and unknowns in limitations', async () => {
    calls.impl = () => PRICING_OK;
    const s = await buildSection15(REQ, '541512', S5_OK, S12_OK);
    expect(s.limitations.length).toBeGreaterThanOrEqual(3);
    expect(s.limitations.some((l) => l.startsWith('Measured facts:'))).toBe(true);
    expect(s.limitations.some((l) => l.startsWith('Estimates / proxies:'))).toBe(true);
    expect(s.limitations.some((l) => l.startsWith('Unknowns:'))).toBe(true);
    expect(s.limitations.join(' ')).toMatch(/supporting data, not the Government estimate/);
  });

  it('does not invent concentration from a degraded coverage set', async () => {
    calls.impl = () => PRICING_OK;
    const s5 = {
      ...S5_OK,
      coverageSet: degraded('upstream conflict', [EV]) as GroundedField<
        Array<{ code: string; pct: number; name?: string }>
      >,
    };
    const s = await buildSection15(REQ, '541512', s5, S12_OK);
    expect(s.supplierConcentration.state).toBe('degraded');
    expect(s.marketDiversity.state).toBe('degraded');
  });
});
