/**
 * The dispatcher must never record a CLEANER outcome than the route's own self-report
 * (src/lib/cron/dispatch-final-status.ts, PR #2234 review).
 *
 * Drives the REAL dispatcher GET against an in-memory Supabase. `fetch` stands in for the
 * saved-search-alerts route: it writes its self-report onto the dispatcher's run row exactly
 * as reportCronOutcome does (status, http_status from cronOutcomeHttpStatus, error = summary),
 * then answers with the route's HTTP status — either INSIDE the 12s ack window (the dispatcher
 * awaits the response and writes after the route) or AFTER it (the dispatcher records
 * `dispatched`, the route reports later).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { cronOutcomeHttpStatus, type CronOutcome } from '@/lib/cron-self-report';
import { resolveDispatchFinal } from '@/lib/cron/dispatch-final-status';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let nextId = 1;

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: 'select' | 'update' | 'insert' = 'select';
  let payload: Row = {};
  let single = false;
  const exec = async () => {
    const rows = (tables[table] ||= []);
    if (op === 'insert') {
      const row = { id: `run-${nextId++}`, ...payload };
      rows.push(row);
      return { data: { id: row.id }, error: null };
    }
    const hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === 'update') {
      hit.forEach((r) => Object.assign(r, payload));
      return { data: single ? (hit[0] ? { id: hit[0].id } : null) : null, error: null };
    }
    const out = JSON.parse(JSON.stringify(hit));
    return { data: single ? out[0] ?? null : out, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    maybeSingle: () => { single = true; return exec(); },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
  };
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
process.env.CRON_SECRET = 'test-cron-secret';
const { GET: dispatch } = await import('./route');

const JOB = 'saved-search-alerts';
const runRow = () => tables.cron_job_runs.find((r) => r.job_name === JOB)!;
const jobRow = () => tables.cron_jobs.find((r) => r.job_name === JOB)!;

/** The route's reportCronOutcome, onto the dispatcher's newest run row. */
function selfReport(outcome: CronOutcome, summary: string | null) {
  Object.assign(runRow(), { status: outcome, http_status: cronOutcomeHttpStatus(outcome), error: summary, finished_at: new Date().toISOString() });
  jobRow().last_status = outcome;
}

function jsonResponse(status: number) {
  return new Response(JSON.stringify({ ok: status < 300 }), { status, headers: { 'content-type': 'application/json' } });
}

/** Route finishes INSIDE the 12s ack window: self-report first, then the HTTP response. */
function routeInsideWindow(outcome: CronOutcome | null, summary: string | null, httpStatus: number) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (outcome) selfReport(outcome, summary);
    return jsonResponse(httpStatus);
  }));
}

/** Route outlives the 12s ack window: the dispatcher aborts; the route self-reports later. */
function routeOutsideWindow() {
  vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
    init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })));
}

async function tickAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  const p = dispatch(new NextRequest('https://x/api/cron/dispatch?tick=hour', { headers: { authorization: 'Bearer test-cron-secret' } }));
  await vi.advanceTimersByTimeAsync(12_001);
  return (await p).json();
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const k of Object.keys(tables)) delete tables[k];
  tables.cron_jobs = [{
    id: 'job-1', job_name: JOB, route: '/api/cron/saved-search-alerts', cron_expr: '0 11 * * *', enabled: true,
    last_run_at: '2026-11-20T11:00:00.000Z', locked_at: null, last_status: 'success', timeout_ms: 290_000, payload: {},
  }];
  tables.cron_job_runs = [];
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('route finishes inside the 12s dispatcher window', () => {
  it('a PARTIAL self-report survives — never overwritten to clean success', async () => {
    routeInsideWindow('partial', 'capacity_exhausted=1,backlog=37', 503);
    await tickAt('2026-11-21T11:00:05Z');
    expect(runRow()).toMatchObject({ status: 'partial', http_status: 503, error: 'capacity_exhausted=1,backlog=37' });
    expect(jobRow().last_status).toBe('partial');
  });

  it('a PARTIAL self-report survives even if the route answered 2xx (legacy contract)', async () => {
    routeInsideWindow('partial', 'capacity_exhausted=1,backlog=37', 200);
    await tickAt('2026-11-21T11:00:05Z');
    expect(runRow()).toMatchObject({ status: 'partial', error: 'capacity_exhausted=1,backlog=37' });
    expect(jobRow().last_status).toBe('partial');
  });

  it('a partial whose self-report was LOST is recorded as an error (503), never success', async () => {
    routeInsideWindow(null, null, 503);
    await tickAt('2026-11-21T11:00:05Z');
    expect(runRow()).toMatchObject({ status: 'error', http_status: 503, error: 'route returned 503' });
  });

  it('a suppression-only success keeps its actionable summary (not error = null)', async () => {
    routeInsideWindow('success', 'recipient_suppressed=3', 200);
    await tickAt('2026-11-21T11:00:05Z');
    expect(runRow()).toMatchObject({ status: 'success', http_status: 200, error: 'recipient_suppressed=3' });
  });

  it('a real processing error stays error and keeps its class list instead of "route returned 500"', async () => {
    routeInsideWindow('error', 'opportunity_query_failed=1,recipient_suppressed=3', 500);
    await tickAt('2026-11-21T11:00:05Z');
    expect(runRow()).toMatchObject({ status: 'error', http_status: 500, error: 'opportunity_query_failed=1,recipient_suppressed=3' });
    expect(jobRow().last_status).toBe('error');
  });

  it('a route that self-reported success but then answered 500 is recorded as the 500', async () => {
    routeInsideWindow('success', null, 500);
    await tickAt('2026-11-21T11:00:05Z');
    expect(runRow()).toMatchObject({ status: 'error', http_status: 500, error: 'route returned 500' });
  });

  it('a clean complete run reports success', async () => {
    routeInsideWindow('success', null, 200);
    await tickAt('2026-11-21T11:00:05Z');
    expect(runRow()).toMatchObject({ status: 'success', http_status: 200, error: null });
  });

  it('a route with no self-report still gets the dispatcher\'s observation', async () => {
    routeInsideWindow(null, null, 200);
    await tickAt('2026-11-21T11:00:05Z');
    expect(runRow()).toMatchObject({ status: 'success', http_status: 200, error: null });
  });
});

describe('route outlives the 12s dispatcher window', () => {
  it('records dispatched; the later partial self-report is the final record', async () => {
    routeOutsideWindow();
    await tickAt('2026-11-21T11:00:05Z');
    expect(runRow()).toMatchObject({ status: 'dispatched', http_status: null });
    selfReport('partial', 'capacity_exhausted=1,backlog=37');
    expect(runRow()).toMatchObject({ status: 'partial', http_status: 503 });
  });
});

describe('resolveDispatchFinal — a disagreement can only make the record worse', () => {
  const partial = { status: 'partial', http_status: 503, error: 'capacity_exhausted=1,backlog=2' };
  it('keeps a terminal self-report over a dispatcher success / dispatched', () => {
    expect(resolveDispatchFinal({ status: 'success', httpStatus: 200, errorMsg: null, responseOk: true }, partial)).toMatchObject({ status: 'partial', keptSelfReport: true });
    expect(resolveDispatchFinal({ status: 'dispatched', httpStatus: null, errorMsg: null, responseOk: false }, partial)).toMatchObject({ status: 'partial', keptSelfReport: true });
  });
  it('an HTML 200 (route missing) is never masked by a self-report', () => {
    expect(resolveDispatchFinal({ status: 'error', httpStatus: 200, errorMsg: 'route returned HTML', responseOk: true }, { status: 'success', http_status: 200, error: null }))
      .toMatchObject({ status: 'error', keptSelfReport: false });
  });
  it('a short-job timeout is never masked', () => {
    expect(resolveDispatchFinal({ status: 'timeout', httpStatus: null, errorMsg: 'timed out', responseOk: false }, { status: 'success', http_status: 200, error: null }))
      .toMatchObject({ status: 'timeout', keptSelfReport: false });
  });
  it('a row the dispatcher still owns (running) is not a self-report', () => {
    expect(resolveDispatchFinal({ status: 'success', httpStatus: 200, errorMsg: null, responseOk: true }, { status: 'running', http_status: null, error: null }))
      .toMatchObject({ status: 'success', keptSelfReport: false });
  });
});
