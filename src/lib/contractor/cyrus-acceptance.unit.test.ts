import { describe, expect, it } from 'vitest';
import {
  assertCyrusAcceptanceOrThrow,
  checkCyrusThreeToolAcceptance,
  CYRUS_UEI,
  extractSamUei,
  normalizeHistoryPayload,
} from './cyrus-acceptance';
import {
  buildCountingBases,
  classifyAgencyYearObligations,
  describeCoverageTimestamp,
  summarizeHistoricalSetAsides,
  SET_ASIDE_CONTRIBUTING_UEI_SAMPLE_LIMIT,
} from './award-history-shape';

/** Passing fixture after the four review corrections. */
function goodTrio() {
  const setAside = {
    labels: ['8(A) SOLE SOURCE'],
    last_observed_action_fy_by_label: { '8(A) SOLE SOURCE': 2020 },
    first_observed_positive_action_fy_by_label: { '8(A) SOLE SOURCE': 2016 },
    last_fy_by_label: { '8(A) SOLE SOURCE': 2020 },
    deprecated: {
      last_fy_by_label: {
        status: 'deprecated',
        prefer: 'last_observed_action_fy_by_label',
        meaning: 'alias',
      },
    },
    contributing_ueis_by_label: { '8(A) SOLE SOURCE': [CYRUS_UEI] },
    contributing_ueis_unknown_labels: [] as string[],
    contributing_ueis_sample_limit: SET_ASIDE_CONTRIBUTING_UEI_SAMPLE_LIMIT,
    contributing_ueis_truncated_labels: [] as string[],
    supporting_actions_by_label: {
      '8(A) SOLE SOURCE': [
        {
          uei: CYRUS_UEI,
          award_id: 'A1',
          fiscal_year: 2020,
          obligation_amount: -100,
          action_date: '2020-01-01',
        },
      ],
    },
    null_first_positive_note:
      'A null first_observed_positive_action_fy does not prove every action was a deobligation — it only means no positive-obligation action was observed for that label in this warehouse scope.',
    scope: { kind: 'profile_rollup', uei_count: 1 },
    coverage: 'complete',
    note:
      'Historical set-aside codes observed on warehouse award actions. None of these fields is current SAM certification status or a graduation/exit reason. Award origin is not established. Contributor UEI lists are sampled at most 20 distinct UEIs per label.',
  };

  const counting = {
    unique_awards: 17,
    unique_awards_grain: 'distinct_awards' as const,
    fiscal_year_award_count_sum: 51,
    fiscal_year_award_count_sum_grain: 'sum_of_per_fy_distinct_awards' as const,
    recent_actions_returned: 5,
    recent_unique_awards: 2,
    recent_grain: 'obligation_actions' as const,
    note: 'unique_awards (grain=distinct_awards) = COUNT(DISTINCT award_id)',
  };

  const freshnessNote =
    'Three clocks: recipient last action 2026-06-16; warehouse awards reach action_date 2026-09-18; ingest freshness=healthy. freshness_evidence_available=true. coverage_completeness=not_established — attached clocks do not prove this recipient\'s history is exhaustive.';

  const coverageBlock = {
    as_of: '2026-06-16',
    warehouse_max_action_date: '2026-09-18',
    freshness_evidence_available: true,
    coverage_completeness: 'not_established' as const,
    coverage_complete_established: false as const,
    ingest: { freshness_status: 'healthy' },
    freshness_note: freshnessNote,
  };

  const profile = {
    found: true,
    enrichment_status: 'complete',
    company: {
      name: 'CYRUS MANAGEMENT SOLUTIONS LLC',
      uei: CYRUS_UEI,
      award_count: 17,
      activity_status: 'dormant',
      last_positive_obligation_fy: 2020,
    },
    counting_bases: counting,
    recent_awards: [{ award_id: 'X', grain: 'obligation_action' }],
    top_agencies: [{ awarding_agency: 'DOT', count: null, count_unavailable: true }],
    coverage: coverageBlock,
    historical_set_asides: setAside,
  };

  const history = {
    success: true,
    contractor: { company: 'CYRUS MANAGEMENT SOLUTIONS LLC' },
    match: { method: 'recipient_uei', match_status: 'unique' },
    summary: { awardCount: 17, activity_status: 'dormant' },
    counting_bases: { ...counting, recent_actions_returned: 20, recent_unique_awards: 8 },
    recentAwards: [{ id: 'X' }, { id: 'Y' }],
    coverage_timestamp: {
      last_recipient_action_date: '2026-06-16',
      warehouse_max_action_date: '2026-09-18',
      freshness_evidence_available: true,
      coverage_completeness: 'not_established',
      coverage_complete_established: false,
      ingest: { freshness_status: 'healthy' },
      freshness_note: freshnessNote,
    },
    historical_set_asides: {
      ...setAside,
      scope: { kind: 'history_single_uei', uei_count: 1 },
    },
    series: [
      {
        fiscalYear: 2021,
        agencyBreakdown: [
          {
            agency: 'GSA',
            amount: 0,
            count: 2,
            distinct_award_count: 2,
            count_grain: 'distinct_awards',
            classification: 'zero_net_obligations',
            unused_vehicle: null,
            vehicle_usage: 'not_established',
          },
        ],
      },
    ],
  };

  const sam = {
    entity: {
      ueiSAM: CYRUS_UEI,
      legalBusinessName: 'CYRUS MANAGEMENT SOLUTIONS LLC',
      has8a: false,
      hasWOSB: true,
    },
  };

  return { profile, sam, history };
}

describe('checkCyrusThreeToolAcceptance', () => {
  it('passes a well-formed Cyrus trio after the four corrections', () => {
    const r = checkCyrusThreeToolAcceptance(goodTrio());
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.flags.freshness_evidence_available).toBe(true);
    expect(r.flags.coverage_completeness_not_established).toBe(true);
    expect(r.flags.counting_distinct_award_grain).toBe(true);
    expect(r.flags.zero_dollar_vehicle_usage_not_established).toBe(true);
    expect(r.flags.set_aside_contributor_truncation_disclosed).toBe(true);
  });

  it('normalizeHistoryPayload unwraps nested history', () => {
    const inner = { summary: { awardCount: 1 } };
    expect(normalizeHistoryPayload({ history: inner })).toEqual(inner);
    expect(normalizeHistoryPayload(inner)).toEqual(inner);
  });

  it('extractSamUei reads entity.ueiSAM', () => {
    expect(extractSamUei({ entity: { ueiSAM: 'n1n9jpdyhvc7' } })).toBe(CYRUS_UEI);
  });

  it('assertCyrusAcceptanceOrThrow throws on failure', () => {
    const bad = goodTrio();
    bad.profile.company.uei = 'WRONG';
    const r = checkCyrusThreeToolAcceptance(bad);
    expect(r.ok).toBe(false);
    expect(() => assertCyrusAcceptanceOrThrow(r, 'test')).toThrow(/test FAILED/);
  });
});

describe('four review corrections — fail-before / pass-after', () => {
  it('1 freshness: coverage_complete_established=true (old) fails; clocks≠completeness passes', () => {
    // BEFORE — clocks conflated with completeness
    const beforeClocks = {
      lastRecipientActionDate: '2026-06-16',
      warehouseMaxActionDate: '2026-09-18',
      ingest: {
        last_built: '2026-09-20',
        freshness: { status: 'healthy' as const, sourceAgeDays: 3, runAgeDays: 0 },
      },
    };
    // Simulate old checker rejection: boolean true for completeness when only clocks exist
    const oldPayload = goodTrio();
    oldPayload.profile.coverage.coverage_complete_established = true as unknown as false;
    oldPayload.history.coverage_timestamp.coverage_complete_established =
      true as unknown as false;
    (oldPayload.profile.coverage as { coverage_completeness?: string }).coverage_completeness =
      'complete';
    (oldPayload.history.coverage_timestamp as { coverage_completeness?: string }).coverage_completeness =
      'complete';
    delete (oldPayload.profile.coverage as { freshness_evidence_available?: boolean })
      .freshness_evidence_available;
    delete (oldPayload.history.coverage_timestamp as { freshness_evidence_available?: boolean })
      .freshness_evidence_available;
    const before = checkCyrusThreeToolAcceptance(oldPayload);
    expect(before.flags.coverage_completeness_not_established).toBe(false);
    expect(before.flags.freshness_evidence_available).toBe(false);
    expect(before.ok).toBe(false);

    // AFTER — shape helper separates the fields
    const afterShape = describeCoverageTimestamp(beforeClocks);
    expect(afterShape.freshness_evidence_available).toBe(true);
    expect(afterShape.coverage_complete_established).toBe(false);
    expect(afterShape.coverage_completeness).toBe('not_established');

    const after = checkCyrusThreeToolAcceptance(goodTrio());
    expect(after.flags.freshness_evidence_available).toBe(true);
    expect(after.flags.coverage_completeness_not_established).toBe(true);
  });

  it('2 vehicle: unused_vehicle=false (old caveat) fails; null/not_established passes', () => {
    const oldCell = classifyAgencyYearObligations({ amount: 0, count: 2 });
    // Shape always emits null now — assert that, and that checker rejects boolean false
    expect(oldCell.unused_vehicle).toBeNull();
    expect(oldCell.vehicle_usage).toBe('not_established');
    expect(oldCell.distinct_award_count).toBe(2);
    expect(oldCell.count_grain).toBe('distinct_awards');

    const beforePayload = goodTrio();
    beforePayload.history.series[0].agencyBreakdown[0] = {
      agency: 'GSA',
      amount: 0,
      count: 2,
      classification: 'zero_net_obligations',
      unused_vehicle: false as unknown as null,
      // missing vehicle_usage + distinct grain
    } as (typeof beforePayload.history.series)[0]['agencyBreakdown'][0];
    const before = checkCyrusThreeToolAcceptance(beforePayload);
    expect(before.flags.zero_dollar_vehicle_usage_not_established).toBe(false);
    expect(before.ok).toBe(false);

    const after = checkCyrusThreeToolAcceptance(goodTrio());
    expect(after.flags.zero_dollar_vehicle_usage_not_established).toBe(true);
  });

  it('3 distinct-award grain: unlabeled counts fail; unique_awards_grain=distinct_awards passes', () => {
    const beforePayload = goodTrio();
    delete (beforePayload.profile.counting_bases as { unique_awards_grain?: string })
      .unique_awards_grain;
    delete (beforePayload.history.counting_bases as { unique_awards_grain?: string })
      .unique_awards_grain;
    delete (beforePayload.profile.counting_bases as { fiscal_year_award_count_sum_grain?: string })
      .fiscal_year_award_count_sum_grain;
    beforePayload.profile.counting_bases.note = 'modifications';
    beforePayload.history.series[0].agencyBreakdown[0] = {
      ...beforePayload.history.series[0].agencyBreakdown[0],
      count_grain: undefined as unknown as 'distinct_awards',
      distinct_award_count: undefined as unknown as number,
    };
    const before = checkCyrusThreeToolAcceptance(beforePayload);
    expect(before.flags.counting_distinct_award_grain).toBe(false);
    expect(before.ok).toBe(false);

    const bases = buildCountingBases({
      uniqueAwards: 17,
      series: [{ fiscalYear: 2020, totalObligations: 1, awardCount: 6 }],
      recentActions: [{ awardId: 'A' }, { awardId: 'A' }, { awardId: 'B' }],
    });
    expect(bases.unique_awards_grain).toBe('distinct_awards');
    expect(bases.fiscal_year_award_count_sum_grain).toBe('sum_of_per_fy_distinct_awards');
    expect(bases.note).toMatch(/distinct_awards/);

    const after = checkCyrusThreeToolAcceptance(goodTrio());
    expect(after.flags.counting_distinct_award_grain).toBe(true);
    expect(after.flags.agency_cell_distinct_award_grain).toBe(true);
  });

  it('4 contributors: substituting queried UEI when unknown fails; null + truncation disclosure passes', () => {
    // BEFORE shape behavior: inventing the queried UEI when contributingUeis is null
    const substituted = summarizeHistoricalSetAsides(
      [
        {
          setAside: '8A COMPETED',
          lastActionFy: 2019,
          firstObservedPositiveActionFy: 2016,
          contributingUeis: null,
          supportingActions: [],
        },
      ],
      { scope: { kind: 'history_single_uei', uei_count: 1 } },
    );
    // Correct: null preserved — NOT [queried UEI]
    expect(substituted.contributing_ueis_by_label['8A COMPETED']).toBeNull();
    expect(substituted.contributing_ueis_unknown_labels).toContain('8A COMPETED');
    expect(substituted.contributing_ueis_sample_limit).toBe(SET_ASIDE_CONTRIBUTING_UEI_SAMPLE_LIMIT);

    // Truncation disclosure when sample hits LIMIT
    const many = Array.from({ length: SET_ASIDE_CONTRIBUTING_UEI_SAMPLE_LIMIT }, (_, i) =>
      `UEI${String(i).padStart(8, '0')}`,
    );
    const truncated = summarizeHistoricalSetAsides(
      [
        {
          setAside: '8(A) SOLE SOURCE',
          lastActionFy: 2020,
          contributingUeis: many,
          supportingActions: [],
        },
      ],
      { contributingUeiSampleLimit: SET_ASIDE_CONTRIBUTING_UEI_SAMPLE_LIMIT },
    );
    expect(truncated.contributing_ueis_truncated_labels).toContain('8(A) SOLE SOURCE');
    expect(truncated.note).toMatch(/truncated|sampled/i);

    // Checker BEFORE: missing truncation disclosure fields
    const beforePayload = goodTrio();
    delete (beforePayload.profile.historical_set_asides as { contributing_ueis_sample_limit?: number })
      .contributing_ueis_sample_limit;
    delete (beforePayload.profile.historical_set_asides as { contributing_ueis_truncated_labels?: string[] })
      .contributing_ueis_truncated_labels;
    delete (beforePayload.profile.historical_set_asides as { contributing_ueis_unknown_labels?: string[] })
      .contributing_ueis_unknown_labels;
    delete (beforePayload.history.historical_set_asides as { contributing_ueis_sample_limit?: number })
      .contributing_ueis_sample_limit;
    delete (beforePayload.history.historical_set_asides as { contributing_ueis_truncated_labels?: string[] })
      .contributing_ueis_truncated_labels;
    delete (beforePayload.history.historical_set_asides as { contributing_ueis_unknown_labels?: string[] })
      .contributing_ueis_unknown_labels;
    // Also invent substituted UEI for an "unknown" label without disclosure
    beforePayload.profile.historical_set_asides.contributing_ueis_by_label['PHANTOM'] = [
      CYRUS_UEI,
    ];
    const before = checkCyrusThreeToolAcceptance(beforePayload);
    expect(before.flags.set_aside_contributor_truncation_disclosed).toBe(false);
    expect(before.ok).toBe(false);

    const after = checkCyrusThreeToolAcceptance(goodTrio());
    expect(after.flags.set_aside_contributor_truncation_disclosed).toBe(true);
    expect(after.flags.set_aside_unknown_contributors_preserved).toBe(true);
  });
});
