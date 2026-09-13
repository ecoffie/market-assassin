import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasAlertTargeting, isAlertDueToday, isSendableToday } from './sendable-today';

const ROUTE = readFileSync(
  join(process.cwd(), 'src/app/api/cron/daily-alerts/route.ts'),
  'utf8',
);

describe('hasAlertTargeting', () => {
  it('counts NAICS or keywords, not agencies-only', () => {
    // daily-alerts skip is NAICS OR keywords. Agencies-only is 1 user and is
    // a digest/cron mismatch — do not silently widen the cron here.
    expect(hasAlertTargeting({ naics_codes: ['541512'] })).toBe(true);
    expect(hasAlertTargeting({ keywords: ['janitorial'] })).toBe(true);
    expect(hasAlertTargeting({ naics_codes: [], keywords: [] })).toBe(false);
    expect(hasAlertTargeting({})).toBe(false);
  });
});

describe('isAlertDueToday', () => {
  it('sends daily every UTC day', () => {
    for (let d = 0; d <= 6; d++) expect(isAlertDueToday('daily', d)).toBe(true);
  });

  it('does not send weekdays on Sunday or Saturday', () => {
    expect(isAlertDueToday('weekdays', 0)).toBe(false);
    expect(isAlertDueToday('weekdays', 6)).toBe(false);
    expect(isAlertDueToday('weekdays', 1)).toBe(true);
  });

  it('sends weekends only Sat-Sun', () => {
    expect(isAlertDueToday('weekends', 0)).toBe(true);
    expect(isAlertDueToday('weekends', 6)).toBe(true);
    expect(isAlertDueToday('weekends', 3)).toBe(false);
  });

  it('honors mwf and tth', () => {
    expect(isAlertDueToday('mwf', 1)).toBe(true);
    expect(isAlertDueToday('mwf', 0)).toBe(false);
    expect(isAlertDueToday('tth', 2)).toBe(true);
    expect(isAlertDueToday('tth', 0)).toBe(false);
  });
});

describe('isSendableToday — the Sunday batch clog', () => {
  const SUN = 0;
  const WED = 3;

  it('Sunday: weekdays and unmatchable do not occupy a batch slot', () => {
    const pending = [
      { user_email: 'daily@x.com', alert_frequency: 'daily', naics_codes: ['541512'] },
      { user_email: 'weekdays@x.com', alert_frequency: 'weekdays', naics_codes: ['541512'] },
      { user_email: 'empty@x.com', alert_frequency: 'daily', naics_codes: [], keywords: [] },
    ];
    const sendable = pending.filter((u) => isSendableToday(u, SUN));
    expect(sendable.map((u) => u.user_email)).toEqual(['daily@x.com']);
  });

  it('Wednesday: weekdays users ARE due, unmatchable still are not', () => {
    const pending = [
      { user_email: 'daily@x.com', alert_frequency: 'daily', naics_codes: ['541512'] },
      { user_email: 'weekdays@x.com', alert_frequency: 'weekdays', naics_codes: ['541512'] },
      { user_email: 'empty@x.com', alert_frequency: 'daily', naics_codes: [] },
    ];
    const sendable = pending.filter((u) => isSendableToday(u, WED));
    expect(sendable.map((u) => u.user_email)).toEqual(['daily@x.com', 'weekdays@x.com']);
  });

  it('a BATCH_SIZE slice of mixed pending on Sunday is 100% sendable after the filter', () => {
    // Measured 2026-09-13: 501 of 774 pending (65%) would immediately continue.
    // Taking BATCH_SIZE from unfiltered pending is how 252 sendable users starved.
    const pending = [
      ...Array.from({ length: 45 }, (_, i) => ({
        user_email: `wd${i}@x.com`, alert_frequency: 'weekdays' as const, naics_codes: ['541512'],
      })),
      ...Array.from({ length: 25 }, (_, i) => ({
        user_email: `d${i}@x.com`, alert_frequency: 'daily' as const, naics_codes: ['541512'],
      })),
    ];
    const BATCH = 20;
    const stolen = pending.slice(0, BATCH);
    expect(stolen.filter((u) => isSendableToday(u, SUN))).toHaveLength(0);

    const sendable = pending.filter((u) => isSendableToday(u, SUN));
    expect(sendable.slice(0, BATCH)).toHaveLength(BATCH);
    expect(sendable.slice(0, BATCH).every((u) => u.alert_frequency === 'daily')).toBe(true);
  });
});

describe('daily-alerts spends BATCH_SIZE on sendable users only', () => {
  it('filters through isSendableToday before slicing the batch', () => {
    expect(ROUTE).toContain("import { isSendableToday } from '@/lib/alerts/sendable-today'");
    expect(ROUTE).toContain('pending.filter((u) => isSendableToday(u, utcDay))');
    expect(ROUTE).toContain('sendable.length > 0 ? (dayOfYear * BATCH_SIZE) % sendable.length');
  });
});
