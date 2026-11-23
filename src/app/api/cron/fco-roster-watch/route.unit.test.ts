/**
 * fco-roster-watch run truth: a partial census is NOT a successful run.
 *
 * Before: the route returned HTTP 200 `success: true` for every census, complete or not, and the
 * dispatcher records `success` on any 2xx JSON — so a census that never finished (13,464 listings
 * vs a 240 s budget) looked green on every run.
 *
 * Convention reused (not invented): saved-search-alerts — `reportCronOutcome` self-report for this
 * fire-and-forget long job, plus `cronOutcomeHttpStatus` on the response (success 200 · partial 503
 * · error 500), resolved by src/lib/cron/dispatch-final-status.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resolveDispatchFinal } from '@/lib/cron/dispatch-final-status';

const reports: Array<[string, string, string | undefined]> = [];
const alerts: unknown[] = [];
let runResult: unknown;
let runThrows: Error | null = null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/cron-self-report', async (orig) => ({
  ...(await orig<typeof import('@/lib/cron-self-report')>()),
  reportCronOutcome: async (job: string, outcome: string, msg?: string) => { reports.push([job, outcome, msg]); },
}));
vi.mock('@/lib/ops-alert', () => ({ sendOpsAlert: async (a: unknown) => { alerts.push(a); } }));
vi.mock('@/lib/ops-alert-dedup', () => ({
  shouldSendAlert: async () => ({ send: true, reason: 'new' }),
  fingerprint: (keys: string[]) => keys.join('|'),
}));
vi.mock('@/lib/forecasts/fco-watch-run', () => ({
  runFcoWatch: async () => { if (runThrows) throw runThrows; return runResult; },
}));

import { GET } from './route';

const census = (over: Record<string, unknown> = {}) => ({
  reportedTotal: 13_464, uniqueRows: 13_464, uniqueListingIds: 13_450, maxChanged: '2026-11-20',
  fingerprint: 'abc:13464', complete: true, pagesFetched: 540, pagesFailed: 0, departments: 10, ...over,
});
const watchRun = (c: Record<string, unknown>, events: unknown[] = []) => ({
  census: census(c), events, heldCanonical: 13_000, clocksWritten: {}, dry: false,
});

const dispatched = (qs = '') => new NextRequest(`http://local/api/cron/fco-roster-watch${qs}`, {
  headers: { authorization: 'Bearer cron-secret', 'x-cron-dispatch': '1' },
});

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret';
  process.env.ADMIN_PASSWORD = 'pw';
  reports.length = 0;
  alerts.length = 0;
  runThrows = null;
});

describe('fco-roster-watch — success only when the census is complete', () => {
  it('a complete census is HTTP 200, success, self-reported success', async () => {
    runResult = watchRun({});
    const res = await GET(dispatched());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, outcome: 'success' });
    expect(reports).toEqual([['fco-roster-watch', 'success', undefined]]);
  });

  it('a partial census is HTTP 503, success:false, self-reported partial', async () => {
    runResult = watchRun({ complete: false, uniqueRows: 1_725, pagesFetched: 69 }, [
      { type: 'enumeration_incomplete', severity: 'warn', message: 'degraded', dedupeKey: 'enumeration_incomplete:1725' },
    ]);
    const res = await GET(dispatched());
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.outcome).toBe('partial');
    expect(body.note).toMatch(/1725 of 13464 rows, 69 pages read/);
    expect(reports).toHaveLength(1);
    expect(reports[0][0]).toBe('fco-roster-watch');
    expect(reports[0][1]).toBe('partial');
    // The incomplete-enumeration alert still goes out — the status change does not swallow it.
    expect(alerts).toHaveLength(1);
  });

  it('a census that read nothing is HTTP 500, self-reported error', async () => {
    runResult = watchRun({ complete: false, uniqueRows: 0, reportedTotal: 0, pagesFetched: 0, pagesFailed: 1 });
    const res = await GET(dispatched());
    expect(res.status).toBe(500);
    expect((await res.json()).outcome).toBe('error');
    expect(reports[0][1]).toBe('error');
  });

  it('an exception is HTTP 500 and self-reported error (not lost behind `dispatched`)', async () => {
    runThrows = new Error('held count returned NULL — unknown, not zero');
    const res = await GET(dispatched());
    expect(res.status).toBe(500);
    expect(reports).toEqual([['fco-roster-watch', 'error', 'held count returned NULL — unknown, not zero']]);
  });

  it('dry and manual (non-dispatcher) runs never write cron status, but still tell the truth', async () => {
    runResult = watchRun({ complete: false, uniqueRows: 100, pagesFetched: 4 });
    const dry = await GET(dispatched('?dry=1'));
    expect(dry.status).toBe(503);
    const manual = await GET(new NextRequest('http://local/api/cron/fco-roster-watch?password=pw'));
    expect(manual.status).toBe(503);
    expect((await manual.json()).success).toBe(false);
    expect(reports).toHaveLength(0);
  });
});

describe('what the dispatcher records for a partial run', () => {
  it('self-reported partial survives the dispatcher closing the connection (`dispatched`)', () => {
    const final = resolveDispatchFinal(
      { status: 'dispatched', httpStatus: null, errorMsg: null, responseOk: false },
      { status: 'partial', http_status: 503, error: 'census incomplete' },
    );
    expect(final.status).toBe('partial');
  });
  it('if the self-report is lost, the 503 is recorded as error — never success', () => {
    const final = resolveDispatchFinal(
      { status: 'error', httpStatus: 503, errorMsg: 'route returned 503', responseOk: false },
      { status: 'running', http_status: null, error: null },
    );
    expect(final.status).toBe('error');
  });
});
