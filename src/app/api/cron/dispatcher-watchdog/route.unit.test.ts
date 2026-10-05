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

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: 'select' | 'update' | 'upsert' = 'select';
  let payload: Row | null = null;
  let countMode = false;
  let order: { col: string; asc: boolean } | null = null;
  let limit: number | null = null;
  let single = false;
  let ignoreDup = false;

  const exec = async () => {
    if (table === 'ops_incidents' && incidentsBroken) {
      return { data: null, count: null, error: { code: '42P01', message: 'relation "ops_incidents" does not exist' } };
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
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v || String(r[c]) === String(v)); return b; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
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
    run('saved-search-alerts', '2026-10-03T11:00:27Z', 'error', 'unexpected_schedule_error=1,email_send_rejected=3'),
    run('saved-search-alerts', '2026-10-04T11:00:28Z', 'error', 'unexpected_schedule_error=1,email_send_rejected=3'),
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
});
