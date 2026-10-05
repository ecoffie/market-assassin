/**
 * END-TO-END: the real saved-search-alerts GET handler → the exact (status, error) its
 * reportCronOutcome call writes into cron_job_runs → the real dispatcher-watchdog GET handler →
 * a fake Slack sender. Nothing is hand-typed between the two routes: the watchdog reads the very
 * errorSummary the cron produced.
 *
 * sendEmail is faked with the real onBlocked contract (#1834): the guard calls onBlocked(reason)
 * and returns false. Supabase is an in-memory fake; Slack is captured. No network, no email.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { SUPPRESSION_CLASSES } from '@/lib/cron/watchdog-incidents';

type Row = Record<string, unknown>;

// ── shared fake state ─────────────────────────────────────────────────────────
const ss = { searches: [] as Row[], open: [] as Row[], blockReason: null as string | null, sends: 0 };
const tables: Record<string, Row[]> = {};
const slack: { subject: string; text: string }[] = [];
let clock = '2026-10-04T11:00:28Z';

// saved-search side: same proxy fake as malformed-row-isolation.unit.test.ts
function savedSearchBuilder(table: string) {
  const ops: Array<[string, unknown[]]> = [];
  let mode: 'select' | 'update' | 'count' = 'select';
  const b: Record<string, unknown> = {};
  const proxy: Record<string, unknown> = new Proxy(b, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...a: unknown[]) => { ops.push([prop, a]); return proxy; };
    },
  });
  b.select = (...a: unknown[]) => {
    ops.push(['select', a]);
    if ((a[1] as { head?: boolean } | undefined)?.head) mode = 'count';
    return proxy;
  };
  b.update = () => { mode = 'update'; return proxy; };
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    if (table === 'saved_searches') {
      if (mode === 'update') return Promise.resolve({ error: null, count: 1 }).then(resolve, reject);
      if (mode === 'count') return Promise.resolve({ count: 0, error: null }).then(resolve, reject);
      const sel = String(ops.find((o) => o[0] === 'select')?.[1][0] ?? '');
      if (sel === 'forecast_seen_through') {
        return Promise.resolve({ data: null, error: { code: '42703', message: 'column saved_searches.forecast_seen_through does not exist' } }).then(resolve, reject);
      }
      const excludeOp = ops.find((o) => o[0] === 'not' && o[1][0] === 'id');
      const excluded = new Set(excludeOp ? String(excludeOp[1][2]).replace(/[()]/g, '').split(',') : []);
      return Promise.resolve({ data: ss.searches.filter((r) => !excluded.has(String(r.id))), error: null }).then(resolve, reject);
    }
    if (table === 'sam_opportunities') return Promise.resolve({ data: ss.open, error: null }).then(resolve, reject);
    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
  };
  return proxy;
}

// watchdog side: cron_jobs / cron_job_runs / ops_incidents with atomic upsert + CAS semantics
function watchdogBuilder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: 'select' | 'update' | 'upsert' = 'select';
  let payload: Row | null = null;
  let countMode = false;
  let order: { col: string; asc: boolean } | null = null;
  let limit: number | null = null;
  let single = false;
  const exec = async () => {
    const rows = (tables[table] ||= []);
    if (op === 'upsert') {
      if (rows.some((r) => r.incident_key === payload!.incident_key)) return { data: null, count: 0, error: null };
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
    upsert: (p: Row) => { op = 'upsert'; payload = p; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
  };
  return b;
}

const WATCHDOG_TABLES = new Set(['cron_jobs', 'cron_job_runs', 'ops_incidents']);
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => (WATCHDOG_TABLES.has(t) ? watchdogBuilder(t) : savedSearchBuilder(t)) }),
}));

// The cron's self-report → a cron_job_runs row, exactly as reportCronOutcome writes it
// (status = outcome, error = errorSummary — src/lib/cron-self-report.ts).
vi.mock('@/lib/cron-self-report', () => ({
  reportCronOutcome: vi.fn(async (job: string, outcome: string, summary?: string) => {
    (tables.cron_job_runs ||= []).push({ job_name: job, started_at: clock, status: outcome, error: summary ?? null });
  }),
}));
vi.mock('@/lib/send-email', () => ({
  sendEmail: vi.fn(async (m: { onBlocked?: (r: string) => void }) => {
    if (ss.blockReason) { m.onBlocked?.(ss.blockReason); return false; }
    ss.sends++; return true;
  }),
}));
vi.mock('@/lib/ops-alert', () => ({
  sendOpsAlert: vi.fn(async (m: { subject: string; text?: string }) => { slack.push({ subject: m.subject, text: m.text ?? '' }); return { ok: true }; }),
}));

process.env.ADMIN_PASSWORD = 'pw';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
const { GET: savedSearchAlerts } = await import('../saved-search-alerts/route');
const { GET: watchdog } = await import('./route');

const MALFORMED = { id: '72354a81-91a2-431e-96df-5f4b46c666a2', user_email: 'customer@example.com', name: 'Micro-purchase / SAP', mode: 'open', filters: { naics: '541511', sapBuyer: true }, alert_frequency: 'daily', last_seen_notice_ids: [], total_alerts_sent: 0, last_alerted_at: null };
const VALID = { id: '4651ee1d-0000-4000-8000-000000000001', user_email: 'person@example.com', name: 'Small Business', mode: 'open', filters: { naics: '541511' }, alert_frequency: 'daily', last_seen_notice_ids: ['N-OLD'], total_alerts_sent: 3, last_alerted_at: '2026-10-02T11:00:00Z' };

/** Two daily cron runs (the watchdog needs 2 consecutive failures), then one watchdog pass. */
async function cronThenWatchdog(searches: Row[], blockReason: string | null) {
  ss.searches = searches; ss.blockReason = blockReason;
  for (const day of ['2026-10-03T11:00:27Z', '2026-10-04T11:00:28Z']) {
    clock = day;
    vi.setSystemTime(new Date(day));
    await savedSearchAlerts(new NextRequest('https://x/api/cron/saved-search-alerts?limit=50', { headers: { 'x-cron-dispatch': '1' } }));
  }
  const runs = (tables.cron_job_runs || []).filter((r) => r.job_name === 'saved-search-alerts');
  vi.setSystemTime(new Date('2026-10-05T06:00:29Z'));
  const body = await (await watchdog(new NextRequest('http://localhost/api/cron/dispatcher-watchdog?password=pw'))).json();
  return { runs, body, posted: [...slack] };
}

function expectProcessingIncident(posted: { subject: string; text: string }[]) {
  expect(posted).toHaveLength(1);
  expect(posted[0].subject).toBe('Cron watchdog: 1 opened');
  expect(posted[0].text).toMatch(/🔴 OPENED saved-search-alerts — processing failures: /);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  for (const k of Object.keys(tables)) delete tables[k];
  slack.length = 0; ss.sends = 0;
  ss.open = [{ notice_id: 'N-NEW-1', title: 'IT services', department: 'DEPT OF X', naics_code: '541511', posted_date: '2026-10-02T00:00:00Z' }];
  tables.cron_jobs = [{ job_name: 'saved-search-alerts', cron_expr: '0 11 * * *', enabled: true, last_run_at: '2026-10-04T11:00:27Z', last_status: 'error', locked_at: null, timeout_ms: 290000 }];
  // liveness: something ran recently
  tables.cron_job_runs = [{ job_name: 'heartbeat', started_at: '2026-10-05T05:59:00Z', status: 'success', error: null }];
});
afterEach(() => { vi.useRealTimers(); });

describe('saved-search-alerts → cron_job_runs → dispatcher-watchdog → Slack', () => {
  it("(a) 'suppressed:hard_bounce' → suppression action item, NO outage incident", async () => {
    const { runs, posted } = await cronThenWatchdog([VALID], 'suppressed:hard_bounce');
    expect(runs.map((r) => [r.status, r.error])).toEqual([['error', 'recipient_suppressed=1'], ['error', 'recipient_suppressed=1']]);
    expect(posted).toHaveLength(1);
    expect(posted[0].subject).toBe('Cron watchdog: 1 suppression opened');
    expect(posted[0].text).toContain('🛡️ SUPPRESSION saved-search-alerts — no processing failure');
    expect(posted[0].text).toContain('🛡️ Recipient suppression (not an outage): 1 email(s) not sent to CONFIRMED-suppressed recipient(s) (recipient_suppressed=1)');
    expect(posted[0].text).not.toContain('🔴 OPENED');
  });

  it("(b) 'suppression_check_failed' → PROCESSING incident opened (a lookup error is not a suppression)", async () => {
    const { runs, posted } = await cronThenWatchdog([VALID], 'suppression_check_failed');
    expect(runs.at(-1)?.error).toBe('suppression_lookup_failed=1');
    expectProcessingIncident(posted);
    expect(posted[0].text).toContain('processing failures: suppression_lookup_failed=1');
    expect(posted[0].text).not.toContain('Recipient suppression');
  });

  it('(b-red) the same run is NOT an outage if suppression_lookup_failed were treated as suppression', async () => {
    SUPPRESSION_CLASSES.add('suppression_lookup_failed');
    try {
      const { posted } = await cronThenWatchdog([VALID], 'suppression_check_failed');
      expect(() => expectProcessingIncident(posted)).toThrow();
      expect(posted[0].subject).toBe('Cron watchdog: 1 suppression opened');
    } finally {
      SUPPRESSION_CLASSES.delete('suppression_lookup_failed');
    }
  });

  it('legacy/unknown block reason (email_send_rejected) is a processing incident, not suppression', async () => {
    const { runs, posted } = await cronThenWatchdog([VALID], 'some_future_reason');
    expect(runs.at(-1)?.error).toBe('email_send_rejected=1');
    expectProcessingIncident(posted);
    expect(posted[0].text).toContain('processing failures: email_send_rejected=1');
  });

  it('(c) recipient_suppressed + invalid_saved_filters → processing incident AND the suppression line', async () => {
    const { runs, posted } = await cronThenWatchdog([MALFORMED, VALID], 'suppressed:hard_bounce');
    const err = String(runs.at(-1)?.error);
    expect(err.split(',').sort()).toEqual(['invalid_saved_filters=1', 'recipient_suppressed=1']);
    expectProcessingIncident(posted);
    expect(posted[0].text).toContain('processing failures: invalid_saved_filters=1');
    expect(posted[0].text).toContain('🛡️ Recipient suppression (not an outage): 1 email(s) not sent to CONFIRMED-suppressed recipient(s) (recipient_suppressed=1)');
  });
});
