/**
 * Saved-search alert decision — the dedupe / new-record rules, extracted unchanged from the cron.
 * These pin the EXISTING behaviour; the migration must not invent a new notification rule.
 */
import { describe, it, expect } from 'vitest';
import { decideSavedSearchAlert, SAVED_SEARCH_SEEN_CAP } from './alert-decision';

const rec = (id: string, extra: Record<string, unknown> = {}) => ({ notice_id: id, title: `T-${id}`, ...extra });

describe('decideSavedSearchAlert', () => {
  it('first run (never alerted, nothing seen) → baseline every current id, no send', () => {
    const d = decideSavedSearchAlert({ lastAlertedAt: null, lastSeenIds: [], records: [rec('A'), rec('B'), rec('A')] });
    expect(d).toEqual({ action: 'baseline', nextSeen: ['A', 'B'] });
  });

  it('previously-seen forecast → not new (no duplicate alert)', () => {
    const d = decideSavedSearchAlert({ lastAlertedAt: '2026-09-22T11:00:00Z', lastSeenIds: ['A', 'B'], records: [rec('A'), rec('B')] });
    expect(d).toEqual({ action: 'no_new' });
  });

  it('truly new forecast → alert-eligible exactly once, then not again on the next run', () => {
    const d1 = decideSavedSearchAlert({ lastAlertedAt: '2026-09-22T11:00:00Z', lastSeenIds: ['A'], records: [rec('A'), rec('NEW')] });
    expect(d1.action).toBe('send');
    if (d1.action !== 'send') return;
    expect(d1.fresh.map((o) => o.notice_id)).toEqual(['NEW']);
    const d2 = decideSavedSearchAlert({ lastAlertedAt: '2026-09-23T11:00:00Z', lastSeenIds: d1.nextSeenAfterSend, records: [rec('A'), rec('NEW')] });
    expect(d2).toEqual({ action: 'no_new' });
  });

  it('updated / amended forecast keeps its id → NOT new (new-record-only rule preserved)', () => {
    const d = decideSavedSearchAlert({
      lastAlertedAt: '2026-09-22T11:00:00Z', lastSeenIds: ['A'],
      records: [rec('A', { title: 'Amended title', anticipated_quarter: 'Q3', set_aside_code: 'SDVOSB' })],
    });
    expect(d).toEqual({ action: 'no_new' });
  });

  it('covered zero (no records) after the first run → no_new, never a false alert', () => {
    expect(decideSavedSearchAlert({ lastAlertedAt: '2026-09-22T11:00:00Z', lastSeenIds: ['A'], records: [] })).toEqual({ action: 'no_new' });
  });

  it('seen after send = current ids first, then prior seen, deduped, capped at 500 (legacy ordering)', () => {
    const prior = Array.from({ length: 499 }, (_, i) => `P${i}`);
    const d = decideSavedSearchAlert({ lastAlertedAt: 'x', lastSeenIds: prior, records: [rec('P0'), rec('N1'), rec('N2')] });
    expect(d.action).toBe('send');
    if (d.action !== 'send') return;
    expect(d.nextSeenAfterSend.slice(0, 3)).toEqual(['P0', 'N1', 'N2']);
    expect(d.nextSeenAfterSend).toHaveLength(SAVED_SEARCH_SEEN_CAP);
    expect(new Set(d.nextSeenAfterSend).size).toBe(SAVED_SEARCH_SEEN_CAP);
  });

  it('a record without an id is never alerted and never stored', () => {
    const d = decideSavedSearchAlert({ lastAlertedAt: 'x', lastSeenIds: ['A'], records: [rec('A'), { notice_id: null, title: 'no id' }] });
    expect(d).toEqual({ action: 'no_new' });
  });

  it('a non-array stored seen list is treated as empty (legacy guard)', () => {
    expect(decideSavedSearchAlert({ lastAlertedAt: null, lastSeenIds: null, records: [rec('A')] }).action).toBe('baseline');
  });
});

describe('decideSavedSearchAlert — Open engine change re-baselines (2026-11-14)', () => {
  // The legacy engine stored only its newest-200 slice of an 8,880-row result ("Show me DOJ opportunities");
  // the canonical engine's 260 real DOJ matches were never in that slice. Without the transition rule every
  // one would be emailed as "new" on the first canonical run.
  it('engine change → baseline (current ∪ prior seen), no send, even with many unseen records', () => {
    const d = decideSavedSearchAlert({
      lastAlertedAt: '2026-11-13T12:00:00Z',
      lastSeenIds: ['OLD1', 'OLD2'],
      records: [rec('N1'), rec('N2'), rec('OLD1')],
      engineTransition: true,
    });
    expect(d).toEqual({ action: 'baseline', nextSeen: ['N1', 'N2', 'OLD1', 'OLD2'] });
  });

  it('rollback (canonical → legacy) is the same rule: the legacy broad set is not emailed', () => {
    const many = Array.from({ length: 200 }, (_, i) => rec(`L${i}`));
    const d = decideSavedSearchAlert({ lastAlertedAt: '2026-11-13T12:00:00Z', lastSeenIds: ['C1'], records: many, engineTransition: true });
    expect(d.action).toBe('baseline');
  });

  it('re-baseline respects the seen cap', () => {
    const many = Array.from({ length: SAVED_SEARCH_SEEN_CAP + 50 }, (_, i) => rec(`X${i}`));
    const d = decideSavedSearchAlert({ lastAlertedAt: '2026-11-13T12:00:00Z', lastSeenIds: ['P'], records: many, engineTransition: true });
    if (d.action !== 'baseline') throw new Error('expected baseline');
    expect(d.nextSeen.length).toBe(SAVED_SEARCH_SEEN_CAP);
  });

  it('no engine change → existing rules unchanged (new record still alerts)', () => {
    const d = decideSavedSearchAlert({ lastAlertedAt: '2026-11-13T12:00:00Z', lastSeenIds: ['A'], records: [rec('A'), rec('B')], engineTransition: false });
    expect(d.action).toBe('send');
  });
});
