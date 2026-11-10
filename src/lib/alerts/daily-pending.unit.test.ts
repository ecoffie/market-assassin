import { describe, it, expect } from 'vitest';
import {
  planDailyBatch,
  isDueOnUtcDay,
  isFinalRunOfWindow,
  shouldFailForPending,
  hasDailyTargeting,
  type DailyPlanUser,
} from './daily-pending';

const targeted = (i: number, freq = 'daily'): DailyPlanUser => ({
  user_email: `t${i}@x.com`, alert_frequency: freq, naics_codes: ['541512'], keywords: [],
});
const untargeted = (i: number, freq = 'daily'): DailyPlanUser => ({
  user_email: `n${i}@x.com`, alert_frequency: freq, naics_codes: [], keywords: [],
});

describe('planDailyBatch — no-targeting users never consume batch slots', () => {
  it('10 eligible, 4 no-targeting, batch 5 → batch is 5 targeted users', () => {
    // Interleave so a plain slice of the eligible list would pick up no-targeting users.
    const users = [untargeted(1), targeted(1), untargeted(2), targeted(2), untargeted(3),
      targeted(3), untargeted(4), targeted(4), targeted(5), targeted(6)];
    const plan = planDailyBatch({ users, processed: new Set(), utcDay: 2, batchSize: 5 });
    expect(plan.batch).toHaveLength(5);
    expect(plan.batch.every((u) => u.user_email.startsWith('t'))).toBe(true);
    expect(plan.noTargeting.map((u) => u.user_email)).toEqual(['n1@x.com', 'n2@x.com', 'n3@x.com', 'n4@x.com']);
    expect(plan.pending).toHaveLength(6);
  });

  it('malformed NAICS ([""] and a comma-joined single element) count as no-targeting', () => {
    const users: DailyPlanUser[] = [
      { user_email: 'a@x.com', alert_frequency: 'daily', naics_codes: [''], keywords: [] },
      { user_email: 'b@x.com', alert_frequency: 'daily', naics_codes: ['236220,337127'], keywords: null },
      { user_email: 'c@x.com', alert_frequency: 'daily', naics_codes: [], keywords: ['roofing'] },
    ];
    const plan = planDailyBatch({ users, processed: new Set(), utcDay: 2, batchSize: 70 });
    expect(plan.noTargeting.map((u) => u.user_email)).toEqual(['a@x.com', 'b@x.com']);
    expect(plan.batch.map((u) => u.user_email)).toEqual(['c@x.com']);
    expect(hasDailyTargeting({ naics_codes: [], keywords: ['roofing'] })).toBe(true);
  });

  it('already-processed users are excluded from every bucket', () => {
    const users = [targeted(1), untargeted(1), targeted(2)];
    const plan = planDailyBatch({ users, processed: new Set(['t1@x.com', 'n1@x.com']), utcDay: 2, batchSize: 5 });
    expect(plan.batch.map((u) => u.user_email)).toEqual(['t2@x.com']);
    expect(plan.noTargeting).toHaveLength(0);
  });

  it('keeps the day-of-year rotation over the targeted pending list', () => {
    const users = [targeted(1), targeted(2), targeted(3), targeted(4)];
    const plan = planDailyBatch({ users, processed: new Set(), utcDay: 2, batchSize: 2, dayOfYear: 1 });
    // rotateBy = (1*2) % 4 = 2
    expect(plan.batch.map((u) => u.user_email)).toEqual(['t3@x.com', 't4@x.com']);
  });
});

describe('day-of-week exclusion happens before batching', () => {
  it('isDueOnUtcDay matrix', () => {
    // 0 Sun .. 6 Sat
    const days = [0, 1, 2, 3, 4, 5, 6];
    expect(days.filter((d) => isDueOnUtcDay('daily', d))).toEqual(days);
    expect(days.filter((d) => isDueOnUtcDay('weekdays', d))).toEqual([1, 2, 3, 4, 5]);
    expect(days.filter((d) => isDueOnUtcDay('weekends', d))).toEqual([0, 6]);
    expect(days.filter((d) => isDueOnUtcDay('mwf', d))).toEqual([1, 3, 5]);
    expect(days.filter((d) => isDueOnUtcDay('tth', d))).toEqual([2, 4]);
  });

  it('on a Saturday, weekday/mwf/tth users are notDueToday and never batched — even untargeted ones', () => {
    const users = [targeted(1, 'weekdays'), targeted(2, 'mwf'), untargeted(1, 'tth'), targeted(3, 'weekends'), targeted(4)];
    const plan = planDailyBatch({ users, processed: new Set(), utcDay: 6, batchSize: 2 });
    expect(plan.notDueToday.map((u) => u.user_email)).toEqual(['t1@x.com', 't2@x.com', 'n1@x.com']);
    expect(plan.noTargeting).toHaveLength(0); // not owed today → no skipped row either
    expect(plan.batch.map((u) => u.user_email)).toEqual(['t3@x.com', 't4@x.com']);
  });

  it('skipDayCheck (test sends) bypasses the day gate', () => {
    const plan = planDailyBatch({ users: [targeted(1, 'weekdays')], processed: new Set(), utcDay: 6, batchSize: 5, skipDayCheck: true });
    expect(plan.batch).toHaveLength(1);
  });
});

describe('final-run failure decision', () => {
  const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 10, h, m, 5));
  it('14:50 UTC and later is the final run; earlier is not', () => {
    expect(isFinalRunOfWindow(at(14, 40))).toBe(false);
    expect(isFinalRunOfWindow(at(14, 50))).toBe(true);
    expect(isFinalRunOfWindow(at(15, 0))).toBe(true);
    expect(isFinalRunOfWindow(at(3, 50))).toBe(false);
  });
  it('fails only on the final run with recipients still pending', () => {
    expect(shouldFailForPending(at(14, 50), 3)).toBe(true);
    expect(shouldFailForPending(at(14, 50), 0)).toBe(false);
    expect(shouldFailForPending(at(14, 40), 300)).toBe(false);
  });
});
