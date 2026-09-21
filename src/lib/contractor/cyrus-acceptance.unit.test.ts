import { describe, expect, it } from 'vitest';
import {
  assertCyrusAcceptanceOrThrow,
  checkCyrusThreeToolAcceptance,
  CYRUS_UEI,
  extractSamUei,
  normalizeHistoryPayload,
} from './cyrus-acceptance';

/** Frozen fixture — not live totals. */
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
      'Historical set-aside codes observed on warehouse award actions. None of these fields is current SAM certification status or a graduation/exit reason. Award origin is not established.',
  };

  const counting = {
    unique_awards: 17,
    fiscal_year_award_count_sum: 51,
    recent_actions_returned: 5,
    recent_unique_awards: 2,
    recent_grain: 'obligation_actions',
    note: 'modifications',
  };

  const freshnessNote =
    'Three clocks: recipient last action 2026-06-16; warehouse awards reach action_date 2026-09-18; ingest freshness=healthy. A contractor\'s quieter last_action_date does not mean the dataset is stale, and a recent recipient action alone does not establish complete warehouse coverage.';

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
    coverage: {
      as_of: '2026-06-16',
      warehouse_max_action_date: '2026-09-18',
      coverage_complete_established: true,
      ingest: { freshness_status: 'healthy' },
      freshness_note: freshnessNote,
    },
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
      coverage_complete_established: true,
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
            classification: 'zero_net_obligations',
            unused_vehicle: false,
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

  return { profile, history, sam };
}

describe('cyrus-acceptance shared checker', () => {
  it('passes a frozen good three-tool fixture', () => {
    const { profile, history, sam } = goodTrio();
    const r = checkCyrusThreeToolAcceptance({ profile, history, sam });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.flags.identity_profile_uei).toBe(true);
    expect(r.flags.restored_profile_awards).toBe(true);
    expect(r.flags.counting_unique_awards).toBe(true);
    expect(r.flags.scope_history_single_uei).toBe(true);
    expect(r.flags.set_aside_null_first_positive_note).toBe(true);
    expect(r.flags.zero_dollar_not_unused_vehicle).toBe(true);
  });

  it('fails when profile recent awards are empty while award_count > 0', () => {
    const { profile, history, sam } = goodTrio();
    (profile as { recent_awards: unknown[] }).recent_awards = [];
    const r = checkCyrusThreeToolAcceptance({ profile, history, sam });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.id === 'restored_profile_awards')).toBe(true);
    expect(() => assertCyrusAcceptanceOrThrow(r)).toThrow(/restored_profile_awards/);
  });

  it('fails when UEIs disagree across tools', () => {
    const { profile, history, sam } = goodTrio();
    (sam as { entity: { ueiSAM: string } }).entity.ueiSAM = 'AAAAAAAAAAAA';
    const r = checkCyrusThreeToolAcceptance({ profile, history, sam });
    expect(r.flags.identity_sam_uei).toBe(false);
  });

  it('fails when unused_vehicle is true on a zero-dollar cell', () => {
    const { profile, history, sam } = goodTrio();
    const series = (history as { series: Array<{ agencyBreakdown: Array<Record<string, unknown>> }> })
      .series;
    series[0].agencyBreakdown[0].unused_vehicle = true;
    const r = checkCyrusThreeToolAcceptance({ profile, history, sam });
    expect(r.flags.zero_dollar_not_unused_vehicle).toBe(false);
  });

  it('fails when award_origin_fy_by_label is present', () => {
    const { profile, history, sam } = goodTrio();
    (profile.historical_set_asides as Record<string, unknown>).award_origin_fy_by_label = {
      '8(A) SOLE SOURCE': 2016,
    };
    const r = checkCyrusThreeToolAcceptance({ profile, history, sam });
    expect(r.flags.set_aside_no_award_origin).toBe(false);
  });

  it('fails when freshness note claims recipient-exhaustive coverage', () => {
    const { profile, history, sam } = goodTrio();
    const bad =
      'Three clocks. This contractor\'s award history is exhaustive.';
    (profile.coverage as { freshness_note: string }).freshness_note = bad;
    (history.coverage_timestamp as { freshness_note: string }).freshness_note = bad;
    const r = checkCyrusThreeToolAcceptance({ profile, history, sam });
    expect(r.flags.coverage_complete_established_not_overclaim).toBe(false);
  });

  it('fails when counting grains are missing', () => {
    const { profile, history, sam } = goodTrio();
    delete (profile as { counting_bases?: unknown }).counting_bases;
    const r = checkCyrusThreeToolAcceptance({ profile, history, sam });
    expect(r.flags.counting_unique_awards).toBe(false);
  });

  it('normalizeHistoryPayload unwraps MCP history wrapper', () => {
    const inner = { summary: { awardCount: 17 } };
    expect(normalizeHistoryPayload({ history: inner })).toEqual(inner);
    expect(normalizeHistoryPayload(inner)).toEqual(inner);
  });

  it('extractSamUei reads ueiSAM', () => {
    expect(extractSamUei({ entity: { ueiSAM: 'n1n9jpdyhvc7' } })).toBe(CYRUS_UEI);
  });
});
