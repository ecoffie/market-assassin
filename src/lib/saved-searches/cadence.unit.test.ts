import { describe, expect, it } from 'vitest';
import { dueSavedSearchFrequenciesAt, isSavedSearchDueAt } from './cadence';

const monday = new Date('2026-08-31T11:00:00Z');
const tuesday = new Date('2026-09-01T11:00:00Z');

describe('saved-search alert cadence', () => {
  it('evaluates daily schedules on every daily cron run', () => {
    expect(isSavedSearchDueAt('daily', monday)).toBe(true);
    expect(isSavedSearchDueAt('daily', tuesday)).toBe(true);
  });

  it('throttles weekly schedules to Monday UTC', () => {
    expect(isSavedSearchDueAt('weekly', monday)).toBe(true);
    expect(isSavedSearchDueAt('weekly', tuesday)).toBe(false);
    expect(dueSavedSearchFrequenciesAt(monday)).toEqual(['daily', 'weekly']);
    expect(dueSavedSearchFrequenciesAt(tuesday)).toEqual(['daily']);
  });

  it('never evaluates paused schedules', () => {
    expect(isSavedSearchDueAt('paused', monday)).toBe(false);
    expect(isSavedSearchDueAt('paused', tuesday)).toBe(false);
  });

  it('fails closed for unknown cadence values', () => {
    expect(isSavedSearchDueAt('hourly', monday)).toBe(false);
  });
});
