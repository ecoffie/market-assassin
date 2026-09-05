/**
 * §12 Small Business Opportunities / Rule of Two — fail-closed mutation tests.
 *
 * Mutation targets (must FAIL CLOSED):
 * 1. Naive UEI counting (3 UEIs / 1 family → count 1, not met)
 * 2. Name-only: similar names stay 2 only when truly separate UEIs / no shared parent
 * 3. Ambiguous parent (ruleOfTwoEligible false) cannot be the 2nd firm making RoT met
 * 4. Failed read → unknown/insufficient, never not_met from fabricated 0
 * 5. Truncated sample_coverage < 1 with <2 families → undetermined not not_met
 * 6. Missing size → exclude (don't treat missing as small)
 * 7. One family two UEIs → at most 1 toward RoT
 */
import { describe, it, expect } from 'vitest';
import { buildSection12 } from './section-12-rule-of-two';
import type { Section11 } from './section-11-suppliers';
import { normalizeRequirement } from './normalizer';
import type {
  CorporateFamilyResolution,
  EvidenceRef,
  GroundedField,
  SupplierRow,
} from './types';
import { trueZero, unknown, value } from './grounding';
import type { ToolCall } from './mindy-client';

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

const GOALING_OK = {
  agency: 'Department of Defense',
  fiscal_year: 2025,
  total_obligated: 1e9,
  goals: [
    {
      category: 'Small Business (prime)',
      goal_pct: 23,
      actual_setaside_pct: 25,
      gap_pct: 2,
      meets_goal: true,
    },
  ],
  _meta: {
    grounded: true,
    degraded: false,
    fiscal_year: 2025,
    small_business_setaside_share: 25,
    meets_small_business_goal: true,
    basis: 'test',
  },
};

function family(
  uei: string,
  opts: {
    familyKey?: string;
    displayName?: string;
    eligible?: boolean;
    confidence?: CorporateFamilyResolution['confidence'];
    method?: CorporateFamilyResolution['method'];
    reason?: string;
  } = {},
): CorporateFamilyResolution {
  const eligible = opts.eligible !== false;
  const key = opts.familyKey ?? uei;
  return {
    canonical: eligible
      ? { familyKey: key, displayName: opts.displayName ?? `Canonical ${uei}` }
      : null,
    memberUeis: [uei],
    method:
      opts.method ??
      (eligible ? 'self_null_or_absent_parent' : 'conflicting_parent_uei'),
    confidence: opts.confidence ?? (eligible ? 'medium' : 'unresolved'),
    evidence: {
      source: 'injected_fixture',
      query: { uei },
      parentUeiDistinct: eligible ? [] : ['P1', 'P2'],
      support: [],
      retrievedAt: EV.retrievedAt,
      warehouseAsOf: '2026-09-01',
    },
    asOf: '2026-09-01',
    rawUei: uei,
    ruleOfTwoEligible: eligible,
    ...(eligible
      ? {}
      : { ineligibleReason: opts.reason ?? 'ambiguous parent_uei' }),
  };
}

function gfStr(v: string | null, reason = 'missing'): GroundedField<string> {
  return v ? value(v, EV) : unknown(reason, [EV]);
}

function supplier(opts: {
  uei: string;
  family: CorporateFamilyResolution;
  name?: string;
  size?: string | null;
  socio?: string[] | null;
  capability?: string | null;
  tier?: 'active_performer' | 'capable' | 'emerging';
}): SupplierRow {
  const tier = opts.tier ?? 'capable';
  const capability =
    opts.capability === null
      ? null
      : opts.capability ??
        `tier=${tier}; awards=3; totalObligated=$1.0M`;
  return {
    canonicalName: gfStr(opts.name ?? opts.family.canonical?.displayName ?? opts.uei),
    legalEntityName: gfStr(opts.name ?? `Legal ${opts.uei}`),
    uei: value(opts.uei, EV),
    cage: unknown('no cage', [EV]),
    businessSize:
      opts.size === null || opts.size === undefined
        ? unknown('SAM business-size status was not present', [EV])
        : value(opts.size, EV),
    socioeconomic:
      opts.socio === null
        ? unknown('no certs', [EV])
        : value(opts.socio ?? [], EV),
    location: value('Tampa, FL', EV),
    poc: unknown('no poc', [EV]),
    capabilityEvidence: capability
      ? value(capability, EV)
      : unknown('no capability', [EV]),
    relevantAwardEvidence: value('3 award(s)', EV),
    resolutionConfidence: opts.family.ruleOfTwoEligible
      ? value(opts.family.confidence, EV)
      : unknown(opts.family.ineligibleReason ?? 'unresolved', [EV]),
    family: opts.family,
  };
}

function emptyS11(overrides: Partial<Section11> = {}): Section11 {
  return {
    suppliers: [],
    rawUeiCount: unknown('empty fixture'),
    deduplicatedFamilyCount: unknown('empty fixture'),
    effortsToLocate: value('fixture', EV),
    calls: [],
    limitations: [],
    ...overrides,
  };
}

function depthCall(
  result: Record<string, unknown>,
  ok = true,
): ToolCall {
  return {
    tool: 'assess_market_depth',
    args: { naics: '561720', set_aside: 'Small Business', limit: 50, state: 'FL' },
    evidence: EV,
    ok,
    ...(ok ? { result } : { error: 'ECONNRESET' }),
  };
}

describe('§12 mutation 1 — naive UEI counting', () => {
  it('3 UEIs under 1 family → capableFamilyCount 1, determination NOT met', async () => {
    const parent = 'PARENT000001';
    const s11 = emptyS11({
      suppliers: [
        supplier({
          uei: 'CHILD000000A',
          family: family('CHILD000000A', {
            familyKey: parent,
            displayName: 'Acme Holdings',
            method: 'usaspending_parent_uei',
            confidence: 'high',
          }),
          size: 'Small Business',
          socio: ['8(a)'],
          tier: 'active_performer',
        }),
        // §11 normally collapses siblings; if both rows appear, count once.
        supplier({
          uei: 'CHILD000000B',
          family: family('CHILD000000B', {
            familyKey: parent,
            displayName: 'Acme Holdings',
            method: 'usaspending_parent_uei',
            confidence: 'high',
          }),
          size: 'Small Business',
          socio: ['8(a)'],
          tier: 'capable',
        }),
        supplier({
          uei: 'CHILD000000C',
          family: family('CHILD000000C', {
            familyKey: parent,
            displayName: 'Acme Holdings',
            method: 'usaspending_parent_uei',
            confidence: 'high',
          }),
          size: 'Small Business',
          socio: [],
          tier: 'capable',
        }),
      ],
      calls: [
        depthCall({
          rule_of_two_determination: 'met',
          sample_coverage: 1,
          capable_depth: 3,
          _meta: { grounded: true, degraded: false },
        }),
      ],
    });

    const s = await buildSection12(REQ, '561720', s11, {
      goalingResult: GOALING_OK,
    });

    expect(s.capableFamilyCount).toMatchObject({ state: 'value', value: 1 });
    expect(s.countedFamilies).toHaveLength(1);
    expect(s.countedFamilies[0].familyKey).toBe(parent);
    // Tool said met on UEI count; family dedup → not supportable.
    expect(s.determination.state === 'degraded' || s.determination.state === 'value').toBe(true);
    if (s.determination.state === 'value') {
      expect(s.determination.value).not.toBe('met');
    }
    if (s.determination.state === 'degraded') {
      expect(s.determination.reason).toMatch(/UEI count inflated; parent-deduplicated capable families = 1/);
      expect(s.determination.value).not.toBe('met');
    }
    expect(JSON.stringify(s.recommendation)).toMatch(/Insufficient evidence|not supported/i);
    expect(JSON.stringify(s)).toMatch(/UEI count inflated/);
  });
});

describe('§12 mutation 2 — name-only must not merge separate self-families', () => {
  it('two self-families with similar names stay 2 when separate UEIs and no shared parent', async () => {
    const s11 = emptyS11({
      suppliers: [
        supplier({
          uei: 'SOLOXXXX0001',
          family: family('SOLOXXXX0001', {
            familyKey: 'SOLOXXXX0001',
            displayName: 'Acme Cleaning LLC',
            method: 'self_null_or_absent_parent',
          }),
          name: 'Acme Cleaning LLC',
          size: 'Small Business',
          socio: ['WOSB'],
        }),
        supplier({
          uei: 'SOLOYYYY0002',
          family: family('SOLOYYYY0002', {
            familyKey: 'SOLOYYYY0002',
            displayName: 'Acme Cleaning Inc',
            method: 'self_null_or_absent_parent',
          }),
          name: 'Acme Cleaning Inc',
          size: 'Small Business',
          socio: ['HUBZone'],
        }),
      ],
      calls: [
        depthCall({
          rule_of_two_determination: 'met',
          sample_coverage: 1,
          _meta: { grounded: true, degraded: false },
        }),
      ],
    });

    const s = await buildSection12(REQ, '561720', s11, {
      goalingResult: GOALING_OK,
    });
    expect(s.capableFamilyCount).toMatchObject({ state: 'value', value: 2 });
    expect(s.determination).toMatchObject({ state: 'value', value: 'met' });
    expect((s.recommendation as { value: string }).value).toMatch(
      /Rule of Two supported: 2 distinct parent-deduplicated capable small businesses/,
    );
  });

  it('ambiguous unresolved parents do not count toward the second firm', async () => {
    const s11 = emptyS11({
      suppliers: [
        supplier({
          uei: 'SOLOXXXX0001',
          family: family('SOLOXXXX0001', {
            familyKey: 'SOLOXXXX0001',
            displayName: 'Acme Cleaning LLC',
          }),
          size: 'Small Business',
        }),
        supplier({
          uei: 'AMBIGUOUS001',
          family: family('AMBIGUOUS001', {
            eligible: false,
            method: 'conflicting_parent_uei',
            reason: 'ambiguous parent_uei: P1, P2',
          }),
          name: 'Acme Cleaning LLC',
          size: 'Small Business',
        }),
      ],
      calls: [
        depthCall({
          rule_of_two_determination: 'met',
          sample_coverage: 1,
          _meta: { grounded: true, degraded: false },
        }),
      ],
    });

    const s = await buildSection12(REQ, '561720', s11, {
      goalingResult: GOALING_OK,
    });
    expect(s.capableFamilyCount).toMatchObject({ state: 'value', value: 1 });
    expect(s.excluded.some((e) => e.uei === 'AMBIGUOUS001')).toBe(true);
    expect(s.determination.state === 'value' ? s.determination.value : s.determination).not.toEqual(
      expect.objectContaining({ value: 'met' }),
    );
    if (s.determination.state === 'value') {
      expect(s.determination.value).not.toBe('met');
    }
  });
});

describe('§12 mutation 3 — ambiguous parent cannot make RoT met', () => {
  it('one eligible + one ruleOfTwoEligible:false → not met / undetermined, never met', async () => {
    const s11 = emptyS11({
      suppliers: [
        supplier({
          uei: 'GOODUEI00001',
          family: family('GOODUEI00001', { familyKey: 'GOODUEI00001' }),
          size: 'Small Business',
          socio: ['SDVOSB'],
        }),
        supplier({
          uei: 'BADUEI000002',
          family: family('BADUEI000002', {
            eligible: false,
            method: 'conflicting_parent_uei',
          }),
          size: 'Small Business',
          socio: ['SDVOSB'],
        }),
      ],
      calls: [
        depthCall({
          rule_of_two_determination: 'met',
          sample_coverage: 1,
          capable_depth: 2,
          _meta: { grounded: true, degraded: false },
        }),
      ],
    });

    const s = await buildSection12(REQ, '561720', s11, {
      goalingResult: GOALING_OK,
    });
    expect(s.countedFamilies).toHaveLength(1);
    expect(s.determination.state === 'value' && s.determination.value === 'met').toBe(false);
    expect(s.excluded.some((e) => /ambiguous|ineligible|conflicting/i.test(e.reason))).toBe(
      true,
    );
  });
});

describe('§12 mutation 4 — failed read never becomes not_met', () => {
  it('failed depth → determination unknown, Insufficient evidence, never not_met from 0', async () => {
    const s11 = emptyS11({
      suppliers: [],
      calls: [depthCall({}, false)],
      rawUeiCount: unknown('failed', [EV]),
      deduplicatedFamilyCount: unknown('failed', [EV]),
    });

    const s = await buildSection12(REQ, '561720', s11, {
      depthOk: false,
      goalingResult: GOALING_OK,
    });

    expect(s.determination.state).toBe('unknown');
    expect(s.capableFamilyCount.state).toBe('unknown');
    expect(s.capableFamilyCount.state).not.toBe('true_zero');
    expect(s.determination.state).not.toBe('value');
    expect(JSON.stringify(s.determination)).not.toMatch(/"value":"not_met"/);
    expect((s.recommendation as { value: string }).value).toMatch(
      /Insufficient evidence to support a set-aside/,
    );
    expect(JSON.stringify(s)).not.toMatch(/no small businesses/i);
  });
});

describe('§12 mutation 5 — truncated sample is undetermined', () => {
  it('sample_coverage < 1 with <2 families → undetermined NOT not_met', async () => {
    const s11 = emptyS11({
      suppliers: [
        supplier({
          uei: 'ONLYONE00001',
          family: family('ONLYONE00001', { familyKey: 'ONLYONE00001' }),
          size: 'Small Business',
        }),
      ],
      calls: [
        depthCall({
          rule_of_two_determination: 'not_met',
          sample_coverage: 0.05,
          capable_depth: 1,
          _meta: { grounded: true, degraded: false },
        }),
      ],
      limitations: ['sample_coverage=0.05 (< 1): raw UEI count is the size of the scored SAMPLE'],
    });

    const s = await buildSection12(REQ, '561720', s11, {
      goalingResult: GOALING_OK,
    });

    expect(s.capableFamilyCount).toMatchObject({ state: 'value', value: 1 });
    expect(s.determination).toMatchObject({ state: 'value', value: 'undetermined' });
    expect(s.determination.state === 'value' && s.determination.value === 'not_met').toBe(false);
    expect((s.recommendation as { value: string }).value).toMatch(
      /Insufficient evidence to support a set-aside/,
    );
    expect(s.sampleCoverage).toMatchObject({ state: 'value', value: 0.05 });
  });
});

describe('§12 mutation 6 — missing size is not small', () => {
  it('family with unknown businessSize is excluded from RoT count', async () => {
    const s11 = emptyS11({
      suppliers: [
        supplier({
          uei: 'SIZEDUEI0001',
          family: family('SIZEDUEI0001', { familyKey: 'SIZEDUEI0001' }),
          size: 'Small Business',
        }),
        supplier({
          uei: 'NOSIZEUEI002',
          family: family('NOSIZEUEI002', { familyKey: 'NOSIZEUEI002' }),
          size: null, // missing — must NOT count as small
        }),
      ],
      calls: [
        depthCall({
          rule_of_two_determination: 'met',
          sample_coverage: 1,
          _meta: { grounded: true, degraded: false },
        }),
      ],
    });

    const s = await buildSection12(REQ, '561720', s11, {
      goalingResult: GOALING_OK,
    });
    expect(s.capableFamilyCount).toMatchObject({ state: 'value', value: 1 });
    expect(s.excluded.some((e) => e.uei === 'NOSIZEUEI002' && /size/i.test(e.reason))).toBe(
      true,
    );
    expect(s.determination.state === 'value' && s.determination.value === 'met').toBe(false);
  });
});

describe('§12 mutation 7 — one family two UEIs counts once', () => {
  it('sibling UEIs under one parent → at most 1 toward RoT', async () => {
    const parent = 'PARENTFAMILY1';
    const s11 = emptyS11({
      suppliers: [
        supplier({
          uei: 'SIBUIEI000A1',
          family: family('SIBUIEI000A1', {
            familyKey: parent,
            displayName: 'Parent Co',
            method: 'usaspending_parent_uei',
            confidence: 'high',
          }),
          size: 'Small Business',
          socio: ['8(a)', 'WOSB'],
          tier: 'active_performer',
        }),
        supplier({
          uei: 'SIBUIEI000B2',
          family: family('SIBUIEI000B2', {
            familyKey: parent,
            displayName: 'Parent Co',
            method: 'usaspending_parent_uei',
            confidence: 'high',
          }),
          size: 'Small Business',
          socio: ['8(a)'],
          tier: 'capable',
        }),
      ],
      calls: [
        depthCall({
          rule_of_two_determination: 'met',
          sample_coverage: 1,
          capable_depth: 2,
          _meta: { grounded: true, degraded: false },
        }),
      ],
    });

    const s = await buildSection12(REQ, '561720', s11, {
      goalingResult: GOALING_OK,
    });
    expect(s.capableFamilyCount).toMatchObject({ state: 'value', value: 1 });
    expect(s.countedFamilies).toHaveLength(1);
    expect(s.excluded.some((e) => /already counted once/i.test(e.reason))).toBe(true);
  });
});

describe('§12 happy path + socio + goaling', () => {
  it('two eligible small capable families → met + socio true_zero/value + goaling context', async () => {
    const s11 = emptyS11({
      suppliers: [
        supplier({
          uei: 'FIRMALPHA001',
          family: family('FIRMALPHA001', {
            familyKey: 'FIRMALPHA001',
            displayName: 'Alpha SB',
          }),
          size: 'Small Business',
          socio: ['8(a)', 'WOSB'],
          tier: 'active_performer',
        }),
        supplier({
          uei: 'FIRMBETA0002',
          family: family('FIRMBETA0002', {
            familyKey: 'FIRMBETA0002',
            displayName: 'Beta SB',
          }),
          size: 'Small Business',
          socio: ['HUBZone'],
          tier: 'capable',
        }),
      ],
      calls: [
        depthCall({
          rule_of_two_determination: 'met',
          sample_coverage: 1,
          _meta: { grounded: true, degraded: false },
        }),
      ],
    });

    const s = await buildSection12(REQ, '561720', s11, {
      goalingResult: GOALING_OK,
    });

    expect(s.determination).toMatchObject({ state: 'value', value: 'met' });
    expect(s.capableFamilyCount).toMatchObject({ state: 'value', value: 2 });
    expect((s.recommendation as { value: string }).value).toMatch(
      /^Rule of Two supported: 2 distinct parent-deduplicated capable small businesses/,
    );
    expect(s.goalingContext.state).toBe('value');
    expect(JSON.stringify(s.goalingContext)).toMatch(/Department of Defense/);

    const byDes = Object.fromEntries(
      s.socioCounts.map((c) => [c.designation, c.familyCount]),
    );
    expect(byDes['8(a)']).toMatchObject({ state: 'value', value: 1 });
    expect(byDes.HUBZone).toMatchObject({ state: 'value', value: 1 });
    expect(byDes.WOSB).toMatchObject({ state: 'value', value: 1 });
    expect(byDes.SDVOSB.state).toBe('true_zero');
    expect(byDes.EDWOSB.state).toBe('true_zero');
  });

  it('exhaustive coverage + 0 capable families → conclusive not_met', async () => {
    const s11 = emptyS11({
      suppliers: [],
      rawUeiCount: trueZero('no capable suppliers in sample', EV),
      deduplicatedFamilyCount: trueZero('no capable suppliers in sample', EV),
      calls: [
        depthCall({
          rule_of_two_determination: 'not_met',
          sample_coverage: 1,
          capable_depth: 0,
          _meta: { grounded: false, degraded: false },
        }),
      ],
    });

    const s = await buildSection12(REQ, '561720', s11, {
      goalingResult: GOALING_OK,
    });
    expect(s.capableFamilyCount.state).toBe('true_zero');
    expect(s.determination).toMatchObject({ state: 'value', value: 'not_met' });
    expect((s.recommendation as { value: string }).value).toMatch(
      /Rule of Two not supported/,
    );
  });

  it('missing socio on counted families → designation count unknown, not 0', async () => {
    const s11 = emptyS11({
      suppliers: [
        supplier({
          uei: 'FIRMALPHA001',
          family: family('FIRMALPHA001', { familyKey: 'FIRMALPHA001' }),
          size: 'Small Business',
          socio: null,
        }),
        supplier({
          uei: 'FIRMBETA0002',
          family: family('FIRMBETA0002', { familyKey: 'FIRMBETA0002' }),
          size: 'Small Business',
          socio: null,
        }),
      ],
      calls: [
        depthCall({
          rule_of_two_determination: 'met',
          sample_coverage: 1,
          _meta: { grounded: true, degraded: false },
        }),
      ],
    });

    const s = await buildSection12(REQ, '561720', s11, {
      goalingResult: GOALING_OK,
    });
    expect(s.determination).toMatchObject({ state: 'value', value: 'met' });
    for (const row of s.socioCounts) {
      expect(row.familyCount.state).toBe('unknown');
      expect(row.familyCount.state).not.toBe('true_zero');
      expect(row.familyCount.state).not.toBe('value');
    }
  });
});
