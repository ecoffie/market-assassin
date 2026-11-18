/**
 * DIBBS (and the same pattern on grants) treated "the job ran" as "the data is current".
 * A weekend no-data success and a control-plane row stuck at source_state=current with
 * null clocks both read as healthy. These cases fail if a run stamps the nonempty
 * ingest clock, or if `current` with no ingest clock is reported CURRENT.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCollectionClockPatch, reportedCollectionFreshness } from './collection-clocks';

const NOW = new Date('2026-11-18T18:00:00Z');
const ATTEMPT = '2026-11-18T08:00:00.000Z';

describe('buildCollectionClockPatch', () => {
  it('a failed read stamps the attempt only and does not move the nonempty ingest', () => {
    const p = buildCollectionClockPatch({
      attemptedAt: ATTEMPT,
      upstreamReadable: false,
      recordsReceived: 0,
      recordsLanded: 0,
      priorVerifiedIngest: '2026-11-02T08:00:00Z',
    });
    expect(p.sourceState).toBe('unreachable');
    expect(p.advancedNonemptyIngest).toBe(false);
    expect(p.clocks.last_poll).toBe(ATTEMPT);
    expect(p.clocks.last_verified_ingest).toBeUndefined();
    expect(p.clocks.last_successful_check).toBeUndefined();
    expect(p.clocks.last_source_advance).toBeUndefined();
    expect(p.clocks.last_data_advance).toBeUndefined();
  });

  it('a confirmed empty window does not reset the nonempty ingest clock', () => {
    const p = buildCollectionClockPatch({
      attemptedAt: ATTEMPT,
      upstreamReadable: true,
      recordsReceived: 0,
      recordsLanded: 0,
      priorVerifiedIngest: '2026-11-02T08:00:00Z',
      cadenceHours: 24,
      now: NOW.toISOString(),
    });
    expect(p.advancedNonemptyIngest).toBe(false);
    expect(p.clocks.last_verified_ingest).toBeUndefined();
    expect(p.clocks.last_successful_check).toBe(ATTEMPT);
    expect(p.clocks.last_poll).toBe(ATTEMPT);
    expect(p.sourceState).toBe('content_stale');
    expect(p.recordsReceived).toBe(0);
  });

  it('a recent prior ingest plus a confirmed empty day is quiet, not a new ingest', () => {
    const p = buildCollectionClockPatch({
      attemptedAt: ATTEMPT,
      upstreamReadable: true,
      recordsReceived: 1,
      recordsLanded: 0,
      priorVerifiedIngest: '2026-11-17T08:00:00Z',
      cadenceHours: 24,
      now: NOW.toISOString(),
    });
    expect(p.sourceState).toBe('upstream_quiet');
    expect(p.clocks.last_verified_ingest).toBeUndefined();
    expect(p.recordsReceived).toBe(1);
  });

  it('nonempty rows landed moves last_verified_ingest and not a fabricated source date', () => {
    const p = buildCollectionClockPatch({
      attemptedAt: ATTEMPT,
      upstreamReadable: true,
      recordsReceived: 400,
      recordsLanded: 400,
      sourcePublishedAt: ATTEMPT,
    });
    expect(p.advancedNonemptyIngest).toBe(true);
    expect(p.clocks.last_verified_ingest).toBe(ATTEMPT);
    expect(p.clocks.last_source_advance).toBeUndefined();
    expect(p.sourceState).toBe('current');
  });

  it('a publisher date that is not the job clock is the source advance', () => {
    const p = buildCollectionClockPatch({
      attemptedAt: ATTEMPT,
      upstreamReadable: true,
      recordsReceived: 10,
      recordsLanded: 10,
      sourcePublishedAt: '2026-11-17',
    });
    expect(p.clocks.last_source_advance).toBe('2026-11-17');
  });
});

describe('reportedCollectionFreshness', () => {
  it('source_state current with null ingest clocks is not CURRENT', () => {
    const r = reportedCollectionFreshness({
      sourceState: 'current',
      lastPoll: ATTEMPT,
      lastSuccessfulCheck: ATTEMPT,
      lastVerifiedIngest: null,
      lastDataAdvance: null,
      recordsReceived: 0,
      rowTouchAt: '2026-11-02T08:00:00Z',
      cadenceHours: 24,
      now: NOW,
    });
    expect(r.state).not.toBe('CURRENT');
    expect(r.state).toBe('STALE');
    expect(r.asOf).toBeNull();
    expect(r.lastAttempted).toBe(ATTEMPT);
    expect(r.lastNonemptyIngest).toBeNull();
    expect(r.warning).toMatch(/do not make this data current/i);
  });

  it('a fresh row-touch without a nonempty ingest is UNKNOWN, not current', () => {
    const r = reportedCollectionFreshness({
      sourceState: 'current',
      lastPoll: ATTEMPT,
      lastSuccessfulCheck: null,
      lastVerifiedIngest: null,
      lastDataAdvance: null,
      recordsReceived: null,
      rowTouchAt: '2026-11-18T07:00:00Z',
      cadenceHours: 24,
      now: NOW,
    });
    expect(r.state).toBe('UNKNOWN');
    expect(r.asOf).toBeNull();
  });

  it('a nonempty ingest inside cadence is the freshness clock', () => {
    const r = reportedCollectionFreshness({
      sourceState: 'current',
      lastPoll: ATTEMPT,
      lastSuccessfulCheck: ATTEMPT,
      lastVerifiedIngest: '2026-11-17T08:00:00Z',
      lastDataAdvance: null,
      recordsReceived: 400,
      rowTouchAt: ATTEMPT,
      cadenceHours: 24,
      now: NOW,
    });
    expect(r.state).toBe('CURRENT');
    expect(r.asOf).toBe('2026-11-17T08:00:00Z');
    expect(r.lastNonemptyIngest).toBe('2026-11-17T08:00:00Z');
    expect(r.recordsReceived).toBe(400);
    expect(r.warning).toBeNull();
  });

  it('a disabled collector with a recent nonempty ingest is not CURRENT', () => {
    const r = reportedCollectionFreshness({
      sourceState: 'current',
      lastPoll: ATTEMPT,
      lastSuccessfulCheck: ATTEMPT,
      lastVerifiedIngest: '2026-11-17T08:00:00Z',
      lastDataAdvance: null,
      recordsReceived: 400,
      rowTouchAt: ATTEMPT,
      cadenceHours: 24,
      now: NOW,
      producerEnabled: false,
    });
    expect(r.state).toBe('STALE');
    expect(r.asOf).toBe('2026-11-17T08:00:00Z');
    expect(r.warning).toMatch(/Collector is disabled/);
    expect(r.warning).toMatch(/does not make this feed current/);
  });

  it('an enabled collector with a recent nonempty ingest stays CURRENT', () => {
    const r = reportedCollectionFreshness({
      sourceState: 'current',
      lastPoll: ATTEMPT,
      lastSuccessfulCheck: ATTEMPT,
      lastVerifiedIngest: '2026-11-17T08:00:00Z',
      lastDataAdvance: null,
      recordsReceived: 400,
      rowTouchAt: ATTEMPT,
      cadenceHours: 24,
      now: NOW,
      producerEnabled: true,
    });
    expect(r.state).toBe('CURRENT');
    expect(r.warning).toBeNull();
  });

  it('an old nonempty ingest is stale even if the job ran today', () => {
    const r = reportedCollectionFreshness({
      sourceState: 'current',
      lastPoll: ATTEMPT,
      lastSuccessfulCheck: ATTEMPT,
      lastVerifiedIngest: '2026-11-02T08:00:00Z',
      lastDataAdvance: null,
      recordsReceived: 0,
      rowTouchAt: ATTEMPT,
      cadenceHours: 24,
      now: NOW,
    });
    expect(r.state).toBe('STALE');
    expect(r.asOf).toBe('2026-11-02T08:00:00Z');
    expect(r.warning).toMatch(/not describe this data as current|not current/i);
  });
});

describe('DIBBS wiring', () => {
  const sync = readFileSync(join(process.cwd(), 'src/app/api/cron/sync-dibbs/route.ts'), 'utf8');
  const api = readFileSync(join(process.cwd(), 'src/app/api/app/dibbs/route.ts'), 'utf8');

  it('a confirmed empty window does not count touched rows as a nonempty ingest', () => {
    const window = sync.slice(sync.indexOf('if (noDataWindow)'), sync.indexOf('// Healthy run'));
    expect(window).toContain('recordsLanded: 0');
    expect(window).toContain('stampDibbsClocks');
    expect(sync).toContain('buildCollectionClockPatch');
  });

  it('the customer DIBBS route returns the freshness warning instead of implying current', () => {
    expect(api).toContain('reportedCollectionFreshness');
    expect(api).toContain('freshness');
    expect(api).toContain("eq('job_name', 'sync-dibbs')");
    expect(api).toContain('producerEnabled');
  });
});
