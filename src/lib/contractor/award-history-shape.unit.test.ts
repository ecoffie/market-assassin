import { describe, expect, it } from 'vitest';
import {
  assessDateRange,
  buildCountingBases,
  classifyAgencyYearObligations,
  classifyModNumber,
  currentFederalFiscalYear,
  dateRangeValidFlag,
  deriveActivityFromSeries,
  describeCoverageTimestamp,
  filterBlankPscList,
  isModificationAction,
  LAST_FY_BY_LABEL_DEPRECATION,
  NULL_FIRST_POSITIVE_NOTE,
  summarizeHistoricalSetAsides,
  SHORT_TOTALS_NOTE,
} from './award-history-shape';

describe('classifyModNumber / isModificationAction', () => {
  it('treats only explicit 0 as base; null/blank stay unknown', () => {
    expect(classifyModNumber(null)).toBe('unknown');
    expect(classifyModNumber('')).toBe('unknown');
    expect(classifyModNumber('   ')).toBe('unknown');
    expect(classifyModNumber('0')).toBe('base');
    expect(classifyModNumber('P00015')).toBe('modification');
    expect(classifyModNumber('17')).toBe('modification');
    expect(isModificationAction(null)).toBeNull();
    expect(isModificationAction('')).toBeNull();
    expect(isModificationAction('0')).toBe(false);
    expect(isModificationAction('P00015')).toBe(true);
  });

  it('does not infer modification from repeated PIID alone', () => {
    expect(isModificationAction('0')).toBe(false);
    expect(isModificationAction('1')).toBe(true);
  });
});

describe('assessDateRange / dateRangeValidFlag', () => {
  it('flags end before start as invalid', () => {
    expect(assessDateRange('2018-07-20', '2018-06-19')).toEqual({
      assessment: 'invalid',
      issue: 'end_before_start',
    });
    expect(dateRangeValidFlag('2018-07-20', '2018-06-19')).toBe(false);
  });

  it('marks complete ISO ranges valid', () => {
    expect(assessDateRange('2018-07-20', '2018-08-19').assessment).toBe('valid');
    expect(dateRangeValidFlag('2018-07-20', '2018-08-19')).toBe(true);
  });

  it('treats missing or malformed dates as unassessable, not valid', () => {
    expect(assessDateRange(null, '2018-06-19').assessment).toBe('unassessable');
    expect(assessDateRange('2018-07-20', null).assessment).toBe('unassessable');
    expect(assessDateRange('not-a-date', '2018-06-19').assessment).toBe('unassessable');
    expect(dateRangeValidFlag(null, '2018-06-19')).toBeNull();
    expect(dateRangeValidFlag('2018-07-20', null)).toBeNull();
  });
});

describe('filterBlankPscList', () => {
  it('drops blank-only PSC records', () => {
    expect(
      filterBlankPscList([
        { pscCode: '', pscDescription: '' },
        { pscCode: 'D307', pscDescription: 'IT' },
      ]),
    ).toEqual([{ pscCode: 'D307', pscDescription: 'IT' }]);
    expect(filterBlankPscList([{ pscCode: '', pscDescription: '' }])).toEqual([]);
  });
});

describe('deriveActivityFromSeries', () => {
  it('marks dormant only when the reference window has adequate coverage', () => {
    const r = deriveActivityFromSeries(
      [
        { fiscalYear: 2019, totalObligations: 800_000, positiveObligations: 800_000, deobligations: 0, awardCount: 3 },
        { fiscalYear: 2020, totalObligations: -727_600, positiveObligations: 50_000, deobligations: -777_600, awardCount: 7 },
        { fiscalYear: 2022, totalObligations: -310_540, positiveObligations: 0, deobligations: -310_540, awardCount: 3 },
        { fiscalYear: 2025, totalObligations: 0, positiveObligations: 0, deobligations: 0, awardCount: 2 },
        { fiscalYear: 2026, totalObligations: 0, positiveObligations: 0, deobligations: 0, awardCount: 1 },
      ],
      { referenceFiscalYear: 2026, lookbackYears: 2 },
    );
    expect(r.last_positive_obligation_fy).toBe(2020);
    expect(r.activity_status).toBe('dormant');
    expect(r.observation_period.series_coverage).toBe('adequate');
    expect(r.observation_period.window_start_fy).toBe(2025);
    expect(r.activity_note).toMatch(/Period-scoped observation/i);
    expect(r.activity_note).toMatch(/not company revenue/i);
  });

  it('does not claim active from an old sole positive FY outside the window', () => {
    const r = deriveActivityFromSeries(
      [
        {
          fiscalYear: 2020,
          totalObligations: -100,
          positiveObligations: 500,
          deobligations: -600,
          awardCount: 2,
        },
      ],
      { referenceFiscalYear: 2026, lookbackYears: 2 },
    );
    expect(r.last_positive_obligation_fy).toBe(2020);
    expect(r.activity_status).toBe('unknown');
    expect(r.observation_period.series_coverage).toBe('missing');
    expect(r.activity_note).toMatch(/not established/i);
  });

  it('never infers positive/deobligation components from net totals', () => {
    const r = deriveActivityFromSeries(
      [
        { fiscalYear: 2025, totalObligations: 1_000_000, awardCount: 1 },
        { fiscalYear: 2026, totalObligations: 500_000, awardCount: 1 },
      ],
      { referenceFiscalYear: 2026, lookbackYears: 2 },
    );
    expect(r.last_positive_obligation_fy).toBeNull();
    expect(r.activity_status).toBe('unknown');
    expect(r.activity_note).toMatch(/not used|not fully established|Components are never inferred/i);
  });

  it('labels deobligating only inside an adequately covered window', () => {
    const r = deriveActivityFromSeries(
      [
        { fiscalYear: 2019, totalObligations: 100, positiveObligations: 100, deobligations: 0, awardCount: 1 },
        { fiscalYear: 2025, totalObligations: 0, positiveObligations: 0, deobligations: 0, awardCount: 1 },
        { fiscalYear: 2026, totalObligations: -50, positiveObligations: 0, deobligations: -50, awardCount: 1 },
      ],
      { referenceFiscalYear: 2026, lookbackYears: 2 },
    );
    expect(r.activity_status).toBe('deobligating');
    expect(r.last_positive_obligation_fy).toBe(2019);
  });

  it('refuses current inactivity claims when recent years are missing from the series', () => {
    const r = deriveActivityFromSeries(
      [
        { fiscalYear: 2019, totalObligations: 100, positiveObligations: 100, deobligations: 0, awardCount: 1 },
        { fiscalYear: 2022, totalObligations: -50, positiveObligations: 0, deobligations: -50, awardCount: 1 },
      ],
      { referenceFiscalYear: 2026, lookbackYears: 2 },
    );
    expect(r.activity_status).toBe('unknown');
    expect(r.observation_period.years_missing).toEqual([2025, 2026]);
  });

  it('defaults reference FY to the current federal fiscal year', () => {
    expect(currentFederalFiscalYear(new Date('2026-09-20T12:00:00Z'))).toBe(2026);
    expect(currentFederalFiscalYear(new Date('2026-10-02T12:00:00Z'))).toBe(2027);
  });
});

describe('buildCountingBases', () => {
  it('explains 17 vs series-sum vs recent sample without forcing them equal', () => {
    const bases = buildCountingBases({
      uniqueAwards: 17,
      series: [
        { fiscalYear: 2019, totalObligations: 1, awardCount: 9 },
        { fiscalYear: 2020, totalObligations: -1, awardCount: 7 },
      ],
      recentActions: [
        { awardId: 'A' },
        { awardId: 'A' },
        { awardId: 'B' },
        { awardId: 'C' },
      ],
    });
    expect(bases.unique_awards).toBe(17);
    expect(bases.fiscal_year_award_count_sum).toBe(16);
    expect(bases.recent_actions_returned).toBe(4);
    expect(bases.recent_unique_awards).toBe(3);
    expect(bases.recent_grain).toBe('obligation_actions');
    expect(bases.note).toMatch(/modifications/i);
  });
});

describe('summarizeHistoricalSetAsides', () => {
  it('records historical set-aside labels without claiming graduation', () => {
    const s = summarizeHistoricalSetAsides([
      { setAside: '8(A) SOLE SOURCE', lastActionFy: 2022, firstObservedPositiveActionFy: 2019 },
      { setAside: 'NO SET ASIDE USED.', lastActionFy: 2026 },
      { setAside: '8A COMPETED', lastActionFy: 2023, firstObservedPositiveActionFy: 2023 },
    ]);
    expect(s.labels).toContain('8(A) SOLE SOURCE');
    expect(s.last_observed_action_fy_by_label['8(A) SOLE SOURCE']).toBe(2022);
    expect(s.first_observed_positive_action_fy_by_label['8(A) SOLE SOURCE']).toBe(2019);
    expect(s.last_fy_by_label['8(A) SOLE SOURCE']).toBe(2022);
    expect(s.deprecated.last_fy_by_label).toEqual(LAST_FY_BY_LABEL_DEPRECATION);
    expect(s.note).toMatch(/does not establish graduation|not.*certification/i);
    expect(s.note).toMatch(/not award origin/i);
    expect(s.note).toMatch(/deprecated alias/i);
    expect(s).not.toHaveProperty('award_origin_fy_by_label');
  });

  it('does not treat a later deobligation FY as award origin or certification', () => {
    const s = summarizeHistoricalSetAsides([
      {
        setAside: '8(A) SOLE SOURCE',
        lastActionFy: 2023,
        firstObservedPositiveActionFy: 2019,
      },
    ]);
    expect(s.last_observed_action_fy_by_label['8(A) SOLE SOURCE']).toBe(2023);
    expect(s.first_observed_positive_action_fy_by_label['8(A) SOLE SOURCE']).toBe(2019);
    expect(s.note).toMatch(/deobligation|last_observed_action_fy/i);
    expect(s.note).not.toMatch(/graduated|certification status is/i);
  });

  it('older award + later positive modification is first_observed_positive_action_fy, not award origin', () => {
    // Award created FY2016; first warehouse positive action observed is a FY2021
    // modification — that MIN(positive) must not be labeled award origin.
    const s = summarizeHistoricalSetAsides([
      {
        setAside: '8(A) SOLE SOURCE',
        lastActionFy: 2021,
        firstObservedPositiveActionFy: 2021,
      },
    ]);
    expect(s.first_observed_positive_action_fy_by_label['8(A) SOLE SOURCE']).toBe(2021);
    expect(s.last_observed_action_fy_by_label['8(A) SOLE SOURCE']).toBe(2021);
    expect(s.note).toMatch(/not award origin/i);
    expect(s.note).toMatch(/Award origin is unknown/i);
    expect(JSON.stringify(s)).not.toMatch(/award_origin_fy/);
  });

  it('keeps first_observed_positive_action_fy null when only action FY is present', () => {
    const s = summarizeHistoricalSetAsides([
      { setAside: '8(A) SOLE SOURCE', lastActionFy: 2023 },
    ]);
    expect(s.last_observed_action_fy_by_label['8(A) SOLE SOURCE']).toBe(2023);
    expect(s.first_observed_positive_action_fy_by_label['8(A) SOLE SOURCE']).toBeNull();
    expect(s.null_first_positive_note).toBe(NULL_FIRST_POSITIVE_NOTE);
    expect(s.null_first_positive_note).toMatch(/does not prove every action was a deobligation/i);
  });

  it('uses null — not fiscal year 0 — when the year is unknown', () => {
    const s = summarizeHistoricalSetAsides([{ setAside: '8(A) SOLE SOURCE', fiscalYear: null }]);
    expect(s.last_observed_action_fy_by_label['8(A) SOLE SOURCE']).toBeNull();
    expect(s.first_observed_positive_action_fy_by_label['8(A) SOLE SOURCE']).toBeNull();
    expect(Object.values(s.last_fy_by_label)).not.toContain(0);
  });

  it('surfaces unavailable coverage so empty labels are not treated as none', () => {
    const s = summarizeHistoricalSetAsides([], { coverage: 'unavailable' });
    expect(s.labels).toEqual([]);
    expect(s.coverage).toBe('unavailable');
    expect(s.note).toMatch(/not retrieved/i);
  });

  it('appends scopeNote so capped samples cannot claim complete history', () => {
    const s = summarizeHistoricalSetAsides([], {
      coverage: 'partial',
      scopeNote: 'Sampled from recent_awards — not a full-history census.',
    });
    expect(s.note).toMatch(/not a full-history census/i);
  });

  it('exposes contributing UEIs, supporting actions, and machine-readable scope', () => {
    const s = summarizeHistoricalSetAsides(
      [
        {
          setAside: '8A COMPETED',
          lastActionFy: 2023,
          firstObservedPositiveActionFy: null,
          contributingUeis: ['uei-a', 'uei-b'],
          supportingActions: [
            {
              uei: 'uei-a',
              award_id: 'AW1',
              fiscal_year: 2023,
              obligation_amount: -100,
              action_date: '2023-04-01',
            },
          ],
        },
      ],
      { scope: { kind: 'profile_rollup', uei_count: 2 } },
    );
    expect(s.scope).toEqual({ kind: 'profile_rollup', uei_count: 2 });
    expect(s.contributing_ueis_by_label['8A COMPETED']).toEqual(['UEI-A', 'UEI-B']);
    expect(s.supporting_actions_by_label['8A COMPETED'][0]).toMatchObject({
      uei: 'UEI-A',
      award_id: 'AW1',
      fiscal_year: 2023,
      obligation_amount: -100,
    });
    expect(s.first_observed_positive_action_fy_by_label['8A COMPETED']).toBeNull();
  });
});

describe('describeCoverageTimestamp', () => {
  it('refuses to treat recipient last action as ingest freshness', () => {
    const d = describeCoverageTimestamp({
      lastRecipientActionDate: '2026-06-16',
      warehouseMaxActionDate: '2026-09-18',
      ingest: {
        last_built: '2026-09-20',
        acquired_at: '2026-09-20T18:16:56.112Z',
        merged_at: '2026-09-20T18:18:56.743Z',
        recipients_rebuilt_at: '2026-09-20T18:19:35.838Z',
        freshness: { status: 'healthy', sourceAgeDays: 3, runAgeDays: 0 },
      },
    });
    expect(d.last_recipient_action_date).toBe('2026-06-16');
    expect(d.warehouse_max_action_date).toBe('2026-09-18');
    expect(d.ingest.freshness_status).toBe('healthy');
    expect(d.coverage_complete_established).toBe(true);
    expect(d.coverage_complete_established_meaning).toMatch(/Does NOT mean/i);
    expect(d.freshness_note).toMatch(/Three clocks/i);
    expect(d.freshness_note).toMatch(/does not mean the dataset is stale/i);
    expect(d.freshness_note).toMatch(/not that this recipient's history is exhaustive/i);
  });

  it('keeps coverage unknown when only recipient last action is present', () => {
    const d = describeCoverageTimestamp({
      lastRecipientActionDate: '2026-06-16',
    });
    expect(d.warehouse_max_action_date).toBeNull();
    expect(d.ingest.freshness_status).toBe('unknown');
    expect(d.coverage_complete_established).toBe(false);
    expect(d.freshness_note).toMatch(/Missing evidence stays unknown/i);
  });
});

describe('classifyAgencyYearObligations', () => {
  it('never labels a zero-dollar row as unused vehicle', () => {
    const z = classifyAgencyYearObligations({ amount: 0, count: 2 });
    expect(z.classification).toBe('zero_net_obligations');
    expect(z.unused_vehicle).toBe(false);
    expect(z.note).toMatch(/not classified as an unused vehicle/i);
  });

  it('still refuses unused_vehicle even when award-type codes are present', () => {
    const z = classifyAgencyYearObligations({
      amount: 0,
      count: 1,
      awardTypeCodes: ['IDV_B'],
    });
    expect(z.unused_vehicle).toBe(false);
    expect(z.note).toMatch(/Zero-dollar rows alone do not establish/i);
  });
});

describe('SHORT_TOTALS_NOTE', () => {
  it('stays short enough for customer-facing copy', () => {
    expect(SHORT_TOTALS_NOTE.length).toBeLessThan(160);
    expect(SHORT_TOTALS_NOTE).toMatch(/Do not treat the two totals/);
  });
});
