/**
 * doj-forecast-sync — the control-plane label for a FAILED run, through the real GET.
 *
 * Regression 2026-11-23: the DOJ workbook was fetched (fingerprint present) and the
 * INSERT failed, yet the route stamped source_state='unreachable' — the label for a
 * source we could not read. It also never self-reported, so the dispatcher's
 * fire-and-forget left cron_jobs at `dispatched` while the route returned 500 daily.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { DojIngestResult } from '@/lib/forecasts/doj-ingest';
import { dojFailureSourceState } from '@/lib/forecasts/doj-instance-state';

const instanceUpdates: Array<Record<string, unknown>> = [];
const outcomes: Array<[string, string, string | undefined]> = [];
let nextResult: Partial<DojIngestResult> = {};

vi.mock('@/lib/forecasts/writer', () => ({
  forecastWriterClient: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async () => { if (table === 'data_source_instances') instanceUpdates.push(patch); return { error: null }; },
      }),
    }),
  }),
}));
vi.mock('@/lib/ops-alert', () => ({ sendOpsAlert: async () => undefined }));
vi.mock('@/lib/cron-self-report', () => ({
  reportCronOutcome: async (job: string, outcome: string, msg?: string) => { outcomes.push([job, outcome, msg]); },
}));
vi.mock('@/lib/forecasts/doj-ingest', () => ({
  runDojIngest: async (_sb: unknown, opts: { apply?: boolean }) => ({
    ok: false, applied: opts.apply === true, fingerprint: null, sourceLastModified: null,
    suspects: [], nullProtectedFields: {}, ...nextResult,
  }),
}));

import { GET } from './route';

const call = (q = '') => GET(new NextRequest(`http://local/api/cron/doj-forecast-sync?password=pw${q}`));

beforeEach(() => {
  process.env.ADMIN_PASSWORD = 'pw';
  instanceUpdates.length = 0;
  outcomes.length = 0;
  nextResult = {};
});

describe('dojFailureSourceState', () => {
  it('a READ workbook is content_stale; no workbook is unreachable', () => {
    expect(dojFailureSourceState({ fingerprint: 'abc123' })).toBe('content_stale');
    expect(dojFailureSourceState({ fingerprint: null })).toBe('unreachable');
  });
});

describe('doj-forecast-sync — failed runs', () => {
  it('fetched but the insert failed → content_stale (NOT unreachable) and self-reports error', async () => {
    nextResult = { fingerprint: 'abc123', failure: 'partial_mutation' };
    const res = await call();
    expect(res.status).toBe(500);
    expect(instanceUpdates).toHaveLength(1);
    expect(instanceUpdates[0].source_state).toBe('content_stale');
    expect(instanceUpdates[0]).not.toHaveProperty('last_successful_check');
    expect(outcomes).toEqual([['doj-forecast-sync', 'error', 'partial_mutation']]);
  });

  it('fetched but header/accounting gate refused → content_stale', async () => {
    nextResult = { fingerprint: 'abc123', failure: 'accounting: held: 1 != 2' };
    await call();
    expect(instanceUpdates[0].source_state).toBe('content_stale');
  });

  it('the source could not be read (no fingerprint) → unreachable', async () => {
    nextResult = { fingerprint: null, failure: 'http_503' };
    await call();
    expect(instanceUpdates[0].source_state).toBe('unreachable');
    expect(outcomes).toEqual([['doj-forecast-sync', 'error', 'http_503']]);
  });

  it('a dry run records no verdict and does not speak for the scheduled job', async () => {
    nextResult = { fingerprint: 'abc123', failure: 'partial_mutation' };
    const res = await call('&dry=1');
    expect(res.status).toBe(500);
    expect(instanceUpdates).toHaveLength(0);
    expect(outcomes).toHaveLength(0);
  });

  it('a successful applied run marks current and self-reports success', async () => {
    nextResult = { ok: true, fingerprint: 'abc123', safeCurrentUpstream: 446, dataAdvanced: false };
    const res = await call();
    expect(res.status).toBe(200);
    expect(instanceUpdates[0].source_state).toBe('current');
    expect(outcomes).toEqual([['doj-forecast-sync', 'success', undefined]]);
  });
});
