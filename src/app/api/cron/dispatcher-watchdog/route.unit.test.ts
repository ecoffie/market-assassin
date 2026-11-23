/**
 * Wiring test for the dispatcher watchdog: the real GET handler, a fake Supabase, and a
 * captured sendOpsAlert (no Slack is ever called). Detection is unchanged; notifications go
 * through the incident layer, and the legacy every-pass alert remains only as a fallback when
 * ops_incidents is unreadable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const sent: { subject: string; text?: string }[] = [];
vi.mock('@/lib/ops-alert', () => ({
  sendOpsAlert: vi.fn(async (m: { subject: string; text?: string }) => { sent.push({ subject: m.subject, text: m.text }); return { ok: true }; }),
}));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let incidentsBroken = false;
let runningReadBroken = false;

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: 'select' | 'update' | 'upsert' = 'select';
  let payload: Row | null = null;
  let countMode = false;
  let order: { col: string; asc: boolean } | null = null;
  let limit: number | null = null;
  let single = false;
  let ignoreDup = false;
  let statusEq: unknown = undefined;

  const exec = async () => {
    if (table === 'ops_incidents' && incidentsBroken) {
      return { data: null, count: null, error: { code: '42P01', message: 'relation "ops_incidents" does not exist' } };
    }
    if (table === 'cron_job_runs' && runningReadBroken && statusEq === 'running') {
      return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    }
    const rows = (tables[table] ||= []);
    if (op === 'upsert') {
      const key = payload!.incident_key;
      // ON CONFLICT DO NOTHING → exact count of rows actually inserted.
      if (rows.some((r) => r.incident_key === key)) return { data: null, count: ignoreDup ? 0 : null, error: null };
      rows.push(JSON.parse(JSON.stringify(payload)));
      return { data: null, count: 1, error: null };
    }
    let hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === 'update') {
      hit.forEach((r) => Object.assign(r, JSON.parse(JSON.stringify(payload))));
      return { data: null, count: countMode ? hit.length : null, error: null };
    }
    if (order) hit = [...hit].sort((a, b) => String(a[order!.col]).localeCompare(String(b[order!.col])) * (order!.asc ? 1 : -1));
    if (limit != null) hit = hit.slice(0, limit);
    hit = JSON.parse(JSON.stringify(hit));
    return { data: single ? hit[0] ?? null : hit, error: null };
  };

  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { if (c === 'status') statusEq = v; filters.push((r) => r[c] === v || String(r[c]) === String(v)); return b; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
    not: (c: string, o: string, v: unknown) => { filters.push((r) => !(o === 'is' && v === null && (r[c] ?? null) === null)); return b; },
    gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b; },
    order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: !!o?.ascending }; return b; },
    limit: (n: number) => { limit = n; return b; },
    maybeSingle: () => { single = true; return exec(); },
    update: (p: Row, o?: { count?: string }) => { op = 'update'; payload = p; countMode = o?.count === 'exact'; return b; },
    upsert: (p: Row, o?: { ignoreDuplicates?: boolean }) => { op = 'upsert'; payload = p; ignoreDup = !!o?.ignoreDuplicates; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
  };
  return b;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));

process.env.ADMIN_PASSWORD = 'pw'; // read at module load by the route
const { GET } = await import('./route');

function seed(now: string) {
  const run = (job: string, started_at: string, status: string, error: string | null) => ({ job_name: job, started_at, status, error });
  tables.cron_jobs = [
    { job_name: 'saved-search-alerts', cron_expr: '0 11 * * *', enabled: true, last_run_at: '2026-10-04T11:00:27Z', last_status: 'error', locked_at: null, timeout_ms: 290000 },
    { job_name: 'epa-source-watch', cron_expr: '50 14 * * *', enabled: true, last_run_at: '2026-10-04T14:50:27Z', last_status: 'timeout', locked_at: null, timeout_ms: 50000 },
  ];
  tables.cron_job_runs = [
    run('saved-search-alerts', '2026-10-03T11:00:27Z', 'error', 'unexpected_schedule_error=1,recipient_suppressed=3'),
    run('saved-search-alerts', '2026-10-04T11:00:28Z', 'error', 'unexpected_schedule_error=1,recipient_suppressed=3'),
    run('epa-source-watch', '2026-10-02T14:50:29Z', 'success', null),
    run('epa-source-watch', '2026-10-03T14:50:27Z', 'timeout', 'This operation was aborted'),
    run('epa-source-watch', '2026-10-04T14:50:27Z', 'timeout', 'This operation was aborted'),
    run('heartbeat', now, 'success', null),
  ];
}

const call = (iso: string, q = '') => {
  vi.setSystemTime(new Date(iso));
  return GET(new NextRequest(`http://localhost/api/cron/dispatcher-watchdog?password=pw${q}`));
};

beforeEach(() => {
  vi.useFakeTimers();
  process.env.ADMIN_PASSWORD = 'pw';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  for (const k of Object.keys(tables)) delete tables[k];
  sent.length = 0;
  incidentsBroken = false;
  runningReadBroken = false;
});

describe('dispatcher-watchdog incident wiring', () => {
  it('posts once for the 2026-10-05 failures, then stays silent on later passes', async () => {
    seed('2026-10-05T05:59:00Z');
    const r1 = await (await call('2026-10-05T06:00:29Z')).json();
    expect(r1.failing.sort()).toEqual(['epa-source-watch', 'saved-search-alerts']);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Cron watchdog: 2 opened');
    expect(sent[0].text).toContain('🔴 OPENED saved-search-alerts — processing failures: unexpected_schedule_error=1 — last failed run 2026-10-04T11:00Z (error)');
    expect(sent[0].text).toContain('🛡️ Recipient suppression (not an outage): 3 email(s)');
    expect(sent[0].text).toContain('🔴 OPENED epa-source-watch — this operation was aborted — last failed run 2026-10-04T14:50Z (timeout)');

    seed('2026-10-05T08:59:00Z');
    const r2 = await (await call('2026-10-05T09:00:29Z')).json();
    expect(r2.failing.length).toBe(2);              // still DETECTED
    expect(r2.incidents.silentRepeats.length).toBe(2);
    expect(sent).toHaveLength(1);                   // not re-posted
  });

  it('falls back to the legacy alert when ops_incidents is unreadable (monitoring never goes silent)', async () => {
    incidentsBroken = true;
    seed('2026-10-05T05:59:00Z');
    const r = await (await call('2026-10-05T06:00:29Z')).json();
    expect(r.incidents.storeAvailable).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('(incident dedupe unavailable)');
  });

  it('dry_run previews the incident messages without writing or posting', async () => {
    seed('2026-10-05T05:59:00Z');
    const r = await (await call('2026-10-05T06:00:29Z', '&dry_run=true')).json();
    expect(r.incidents.preview[0].subject).toBe('Cron watchdog: 2 opened');
    expect(sent).toHaveLength(0);
    expect(tables.ops_incidents ?? []).toHaveLength(0);
  });

  it('UNCLOSED: reports a self-reporting job\'s run still `dispatched` past timeout + margin (read-only)', async () => {
    const now = '2026-11-23T12:00:29Z';
    tables.cron_jobs = [
      { job_name: 'sync-dibbs', cron_expr: '0 */6 * * *', enabled: true, last_run_at: '2026-11-23T06:00:10Z', last_status: 'running', locked_at: null, timeout_ms: 300000 },
      { job_name: 'quiet-long', cron_expr: '0 */6 * * *', enabled: true, last_run_at: '2026-11-23T06:00:10Z', last_status: 'dispatched', locked_at: null, timeout_ms: 300000 },
    ];
    tables.cron_job_runs = [
      // Earlier run closed by the route itself after the 12s ack → proof sync-dibbs self-reports.
      { id: 'r0', job_name: 'sync-dibbs', started_at: '2026-11-22T18:00:10Z', status: 'success', duration_ms: 12002, error: null },
      // Killed run: never closed.
      { id: 'r1', job_name: 'sync-dibbs', started_at: '2026-11-23T06:00:10Z', status: 'dispatched', duration_ms: 12002, error: null },
      // A job that never self-reports: `dispatched` is its healthy permanent record → not flagged.
      { id: 'q1', job_name: 'quiet-long', started_at: '2026-11-23T06:00:10Z', status: 'dispatched', duration_ms: 12002, error: null },
      { id: 'h', job_name: 'heartbeat', started_at: '2026-11-23T11:59:00Z', status: 'success', error: null },
    ];
    const before = JSON.stringify(tables.cron_job_runs);
    const r = await (await call(now)).json();
    expect(r.unclosedError).toBeNull();
    expect(r.unclosed).toHaveLength(1);
    expect(r.unclosed[0]).toMatchObject({ job_name: 'sync-dibbs', status: 'dispatched', runs: 1, run_ids: ['r1'] });
    expect(r.ok).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('OPENED sync-dibbs');
    expect(sent[0].text).toContain("still 'dispatched' past timeout");
    expect(JSON.stringify(tables.cron_job_runs)).toBe(before); // rows never mutated
  });

  it('UNCLOSED: a failed read reports the check as unknown (null), never as nothing unclosed', async () => {
    runningReadBroken = true;
    tables.cron_jobs = [
      { job_name: 'health-check-email', cron_expr: '0 16 * * *', enabled: true, last_run_at: '2026-11-22T16:00:00Z', last_status: 'success', locked_at: null, timeout_ms: 50000 },
    ];
    tables.cron_job_runs = [{ id: 'h', job_name: 'heartbeat', started_at: '2026-11-23T11:59:00Z', status: 'success', error: null }];
    const r = await (await call('2026-11-23T12:00:29Z')).json();
    expect(r.unclosed).toBeNull();
    expect(r.unclosedError).toContain('statement timeout');
  });
});
