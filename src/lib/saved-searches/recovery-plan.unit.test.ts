import { describe, it, expect } from 'vitest';
import { planSavedSearchRecovery, buildRecoveryWrite } from './recovery-plan';
import { decideSavedSearchAlert } from './alert-decision';

const CREATED = '2026-10-01T01:50:15.789Z';
const n = (id: string, posted: string | null, ingested: string | null) => ({ notice_id: id, posted_date: posted, ingested_at: ingested });

describe('planSavedSearchRecovery', () => {
  const plan = planSavedSearchRecovery({
    createdAt: CREATED,
    missedRuns: ['2026-10-02T11:00:28Z', '2026-10-01T11:00:27Z'],
    cronWindow: [
      n('PRE', '2026-09-30T00:00:00Z', '2026-09-30T02:00:00Z'),
      n('NOPOST', null, '2026-09-20T00:00:00Z'),
      n('D1', '2026-10-01T05:00:00Z', '2026-10-01T06:00:00Z'),
      n('D2', '2026-10-01T20:00:00Z', '2026-10-01T21:00:00Z'),
    ],
    postedSinceAnyStatus: [
      n('D1', '2026-10-01T05:00:00Z', '2026-10-01T06:00:00Z'),
      n('CLOSED', '2026-10-01T09:00:00Z', '2026-10-01T09:30:00Z'),
      n('OLDCLOSED', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
    ],
  });

  it('baselines what existed at creation (unknown posted date counts as pre-existing)', () => {
    expect(plan.baseline_ids).toEqual(['PRE', 'NOPOST']);
    expect(plan.catch_up.map((x) => x.notice_id)).toEqual(['D1', 'D2']);
  });

  it('per missed run: proves presence in our DB, never claims more', () => {
    expect(plan.per_missed_run).toEqual([
      { run_started_at: '2026-10-01T11:00:27Z', present_and_matching_now: ['D1'], not_yet_ingested: ['D2'] },
      { run_started_at: '2026-10-02T11:00:28Z', present_and_matching_now: ['D1', 'D2'], not_yet_ingested: [] },
    ]);
  });

  it('surfaces post-creation matches that have since closed (undeliverable by the active-only alert)', () => {
    expect(plan.closed_since.map((x) => x.notice_id)).toEqual(['CLOSED']);
  });

  it('end to end: the recovery write turns the next routine run into a catch-up send, not a silent baseline', () => {
    const write = buildRecoveryWrite(
      { id: 'X', created_at: CREATED, updated_at: CREATED, filters: { naics: '541510', sapBuyer: true }, last_alerted_at: null, total_alerts_sent: 0 },
      { naics: '541510', sapBuyer: 'most' },
      plan.baseline_ids,
    );
    expect(write.where).toMatchObject({ last_alerted_at: null, total_alerts_sent: 0, updated_at: CREATED });
    expect(write.set.last_alerted_at).toBe(CREATED);

    const window = [{ notice_id: 'PRE' }, { notice_id: 'NOPOST' }, { notice_id: 'D1' }, { notice_id: 'D2' }];
    // WITHOUT the recovery write: the first routine run would consume D1/D2 silently.
    expect(decideSavedSearchAlert({ lastAlertedAt: null, lastSeenIds: [], records: window }).action).toBe('baseline');
    // WITH it: the routine run sends exactly the post-creation matches.
    const d = decideSavedSearchAlert({ lastAlertedAt: write.set.last_alerted_at, lastSeenIds: write.set.last_seen_notice_ids, records: window });
    expect(d.action).toBe('send');
    if (d.action === 'send') expect(d.fresh.map((r) => r.notice_id)).toEqual(['D1', 'D2']);
  });
});

describe('recovery for a search that was stamped daily with zero matches (invalid code, last_seen empty)', () => {
  it('guards on the state as read and still baselines as of creation — no whole-window blast', () => {
    const row = { id: 'S', created_at: CREATED, updated_at: '2026-10-04T11:00:40Z', filters: { naics: '541510' }, last_alerted_at: '2026-10-04T11:00:40Z', total_alerts_sent: 0 };
    const window = [{ notice_id: 'PRE' }, { notice_id: 'D1' }];
    // Correcting the filter alone: lastAlertedAt set + empty seen → EVERY window record is "fresh".
    const naive = decideSavedSearchAlert({ lastAlertedAt: row.last_alerted_at, lastSeenIds: [], records: window });
    expect(naive.action === 'send' && naive.fresh.map((r) => r.notice_id)).toEqual(['PRE', 'D1']);
    const write = buildRecoveryWrite(row, { naics: '541511' }, ['PRE']);
    expect(write.where).toMatchObject({ last_alerted_at: '2026-10-04T11:00:40Z', total_alerts_sent: 0 });
    const d = decideSavedSearchAlert({ lastAlertedAt: write.set.last_alerted_at, lastSeenIds: write.set.last_seen_notice_ids, records: window });
    expect(d.action === 'send' && d.fresh.map((r) => r.notice_id)).toEqual(['D1']);
  });
});
