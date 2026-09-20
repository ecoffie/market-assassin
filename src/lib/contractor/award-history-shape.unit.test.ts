import { describe, expect, it } from 'vitest';
import {
  buildCountingBases,
  dateRangeIssue,
  deriveActivityFromSeries,
  describeCoverageTimestamp,
  filterBlankPscList,
  isBaseModNumber,
  isModificationAction,
  summarizeHistoricalSetAsides,
  SHORT_TOTALS_NOTE,
} from './award-history-shape';

describe('isModificationAction / isBaseModNumber', () => {
  it('treats empty/0 as base and P00015/17 as modifications', () => {
    expect(isBaseModNumber(null)).toBe(true);
    expect(isBaseModNumber('')).toBe(true);
    expect(isBaseModNumber('0')).toBe(true);
    expect(isModificationAction('0')).toBe(false);
    expect(isModificationAction('P00015')).toBe(true);
    expect(isModificationAction('17')).toBe(true);
  });

  it('does not infer modification from repeated PIID alone', () => {
    // Same PIID can be base or mod — only mod_number decides.
    expect(isModificationAction('0')).toBe(false);
    expect(isModificationAction('1')).toBe(true);
  });
});

describe('dateRangeIssue', () => {
  it('flags end before start while preserving comparison on ISO dates', () => {
    expect(dateRangeIssue('2018-07-20', '2018-06-19')).toBe('end_before_start');
    expect(dateRangeIssue('2018-07-20', '2018-08-19')).toBe(null);
    expect(dateRangeIssue(null, '2018-06-19')).toBe(null);
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
  it('finds last positive FY and marks dormant when later nets are non-positive', () => {
    const r = deriveActivityFromSeries([
      { fiscalYear: 2019, totalObligations: 800_000, positiveObligations: 800_000, deobligations: 0, awardCount: 3 },
      { fiscalYear: 2020, totalObligations: -727_600, positiveObligations: 50_000, deobligations: -777_600, awardCount: 7 },
      { fiscalYear: 2022, totalObligations: -310_540, positiveObligations: 0, deobligations: -310_540, awardCount: 3 },
      { fiscalYear: 2026, totalObligations: 0, positiveObligations: 0, deobligations: 0, awardCount: 1 },
    ]);
    expect(r.last_positive_obligation_fy).toBe(2020);
    expect(r.activity_status).toBe('dormant');
    expect(r.activity_note).toMatch(/not company revenue/i);
  });

  it('does not treat a negative net year as proof of zero positive obligations', () => {
    const r = deriveActivityFromSeries([
      {
        fiscalYear: 2020,
        totalObligations: -100,
        positiveObligations: 500,
        deobligations: -600,
        awardCount: 2,
      },
    ]);
    expect(r.last_positive_obligation_fy).toBe(2020);
    expect(r.activity_status).toBe('active');
  });

  it('labels deobligating when latest FY has only negative dollars', () => {
    const r = deriveActivityFromSeries([
      { fiscalYear: 2019, totalObligations: 100, positiveObligations: 100, deobligations: 0, awardCount: 1 },
      { fiscalYear: 2022, totalObligations: -50, positiveObligations: 0, deobligations: -50, awardCount: 1 },
    ]);
    expect(r.activity_status).toBe('deobligating');
    expect(r.last_positive_obligation_fy).toBe(2019);
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
      { setAside: '8(A) SOLE SOURCE', fiscalYear: 2019 },
      { setAside: '8(A) SOLE SOURCE', fiscalYear: 2022 },
      { setAside: 'NO SET ASIDE USED.', fiscalYear: 2026 },
      { setAside: '8A COMPETED', fiscalYear: 2023 },
    ]);
    expect(s.labels).toContain('8(A) SOLE SOURCE');
    expect(s.last_fy_by_label['8(A) SOLE SOURCE']).toBe(2022);
    expect(s.note).toMatch(/does not establish graduation/i);
  });
});

describe('describeCoverageTimestamp', () => {
  it('refuses to treat recipient last action as ingest freshness', () => {
    const d = describeCoverageTimestamp({
      lastRecipientActionDate: '2026-06-16',
      warehouseMaxActionDate: '2026-09-18',
    });
    expect(d.last_recipient_action_date).toBe('2026-06-16');
    expect(d.warehouse_max_action_date).toBe('2026-09-18');
    expect(d.freshness_note).toMatch(/does not mean the dataset is stale/i);
  });
});

describe('SHORT_TOTALS_NOTE', () => {
  it('stays short enough for customer-facing copy', () => {
    expect(SHORT_TOTALS_NOTE.length).toBeLessThan(160);
    expect(SHORT_TOTALS_NOTE).toMatch(/Do not treat the two totals/);
  });
});
