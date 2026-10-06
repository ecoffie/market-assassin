/**
 * RELEASE CHECK (#1834 + #1836 + #1839 + #1840) — one mixed saved-search-alerts run, end to end:
 *
 *   A  valid search, new matches            → sends (provider-accepted)
 *   B  malformed stored filters (sapBuyer)   → THIS search blocked; others continue
 *   C  confirmed suppressed recipient        → action item, not an outage
 *   D  suppression LOOKUP fails (DB error)   → processing error, never "suppressed"
 *   E  created between runs                  → checked, no alert sent (baseline vs no-new-match not recorded)
 *
 * The REAL saved-search-alerts route runs twice (the watchdog needs two consecutive failures); its
 * self-report becomes the cron_job_runs row; the REAL dispatcher-watchdog posts to a captured Slack.
 * Then the job readiness probe and each customer's status are computed ONLY from what those runs
 * wrote (run rows, stamps, provider sends, suppression rows) — nothing hand-typed in between.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;

const ss = { searches: [] as Row[], open: [] as Row[] };
const tables: Record<string, Row[]> = {};
const slack: { subject: string; text: string }[] = [];
/** Per-recipient send-guard behaviour (the real sendEmail contract: onBlocked(reason) + false). */
const BLOCK: Record<string, string> = {
  'internal@govconedu.example': 'suppressed:hard_bounce',
  'dbfail@example.com': 'suppression_check_failed',
};
let clock = '2026-10-03T11:00:27Z';

// ── saved-search route side (proxy fake; stamps and claims are APPLIED to the row) ──────────────
function savedSearchBuilder(table: string) {
  const ops: Array<[string, unknown[]]> = [];
  let mode: 'select' | 'update' | 'count' = 'select';
  let payload: Row = {};
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
  b.update = (p: Row) => { mode = 'update'; payload = p; return proxy; };
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    if (table === 'saved_searches') {
      if (mode === 'update') {
        const id = ops.find((o) => o[0] === 'eq' && o[1][0] === 'id')?.[1][1];
        const row = ss.searches.find((r) => r.id === id);
        if (row) Object.assign(row, JSON.parse(JSON.stringify(payload)));
        return Promise.resolve({ error: null, count: row ? 1 : 0 }).then(resolve, reject);
      }
      if (mode === 'count') return Promise.resolve({ count: 0, error: null }).then(resolve, reject);
      const sel = String(ops.find((o) => o[0] === 'select')?.[1][0] ?? '');
      if (sel === 'forecast_seen_through') {
        return Promise.resolve({ data: null, error: { code: '42703', message: 'column saved_searches.forecast_seen_through does not exist' } }).then(resolve, reject);
      }
      const excludeOp = ops.find((o) => o[0] === 'not' && o[1][0] === 'id');
      const excluded = new Set(excludeOp ? String(excludeOp[1][2]).replace(/[()]/g, '').split(',') : []);
      const due = ss.searches.filter((r) => !excluded.has(String(r.id)) && Date.parse(String(r.created_at)) <= Date.parse(clock));
      return Promise.resolve({ data: JSON.parse(JSON.stringify(due)), error: null }).then(resolve, reject);
    }
    if (table === 'sam_opportunities') return Promise.resolve({ data: ss.open, error: null }).then(resolve, reject);
    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
  };
  return proxy;
}

// ── generic in-memory PostgREST fake (watchdog tables + everything the status probes read) ──────
function tableBuilder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: 'select' | 'update' | 'upsert' = 'select';
  let payload: Row | null = null;
  let countMode = false;
  let head = false;
  let order: { col: string; asc: boolean } | null = null;
  let limit: number | null = null;
  let single = false;
  const rowsOf = () => (table === 'saved_searches' ? ss.searches : (tables[table] ||= []));
  const exec = async () => {
    const rows = rowsOf();
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
    if (head) return { data: null, count: hit.length, error: null };
    if (order) hit = [...hit].sort((a, b) => String(a[order!.col]).localeCompare(String(b[order!.col])) * (order!.asc ? 1 : -1));
    if (limit != null) hit = hit.slice(0, limit);
    hit = JSON.parse(JSON.stringify(hit));
    return { data: single ? hit[0] ?? null : hit, error: null };
  };
  const t = (v: unknown) => Date.parse(String(v));
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) head = true; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v || String(r[c]) === String(v)); return b; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
    gte: (c: string, v: string) => { filters.push((r) => r[c] != null && t(r[c]) >= t(v)); return b; },
    lte: (c: string, v: string) => { filters.push((r) => r[c] != null && t(r[c]) <= t(v)); return b; },
    ilike: (c: string, p: string) => { const re = new RegExp('^' + p.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i'); filters.push((r) => re.test(String(r[c] ?? ''))); return b; },
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
  createClient: () => ({ from: (t: string) => (WATCHDOG_TABLES.has(t) ? tableBuilder(t) : savedSearchBuilder(t)) }),
}));
// The status probes read through getAppSupabase — the same captured state, generic query semantics.
vi.mock('@/lib/app/workspace', () => ({ getAppSupabase: () => ({ from: (t: string) => tableBuilder(t) }) }));
// reportCronOutcome → the cron_job_runs row exactly as src/lib/cron-self-report.ts writes it.
vi.mock('@/lib/cron-self-report', () => ({
  reportCronOutcome: vi.fn(async (job: string, outcome: string, summary?: string) => {
    (tables.cron_job_runs ||= []).push({
      job_name: job, started_at: clock, finished_at: new Date(Date.parse(clock) + 70_000).toISOString(),
      status: outcome, error: summary ?? null, http_status: null,
    });
  }),
}));
// sendEmail: the real guard contract, per recipient; an accepted send is recorded as the provider ledger row.
vi.mock('@/lib/send-email', () => ({
  sendEmail: vi.fn(async (m: { to: string; emailType?: string; onBlocked?: (r: string) => void }) => {
    const reason = BLOCK[m.to];
    if (reason) { m.onBlocked?.(reason); return false; }
    (tables.email_provider_sends ||= []).push({
      user_email: m.to, email_type: m.emailType, status: 'sent', sent_at: new Date(Date.parse(clock) + 5_000).toISOString(),
    });
    return true;
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
const { getSavedSearchDeliveryReadiness } = await import('@/lib/saved-searches/delivery-readiness');
const { composeSearchAlertStatus, readRecipientEvidence } = await import('@/lib/saved-searches/search-delivery-status');

const base = { mode: 'open', alerts_enabled: true, alert_frequency: 'daily', bbox: null, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' };
const A = { ...base, id: 'aaaaaaaa-0000-4000-8000-000000000001', user_email: 'person@example.com', name: 'IT services', filters: { naics: '541511' }, last_seen_notice_ids: ['N-OLD'], total_alerts_sent: 3, last_alerted_at: '2026-10-02T11:00:10Z' };
const B = { ...base, id: '72354a81-91a2-431e-96df-5f4b46c666a2', user_email: 'customer@example.com', name: 'Micro-purchase / SAP', filters: { naics: '541511', sapBuyer: true }, last_seen_notice_ids: [], total_alerts_sent: 0, last_alerted_at: null };
const C = { ...base, id: 'cccccccc-0000-4000-8000-000000000003', user_email: 'internal@govconedu.example', name: 'Internal watch', filters: { naics: '541511' }, last_seen_notice_ids: ['N-OLD'], total_alerts_sent: 30, last_alerted_at: '2026-09-29T11:00:10Z' };
const D = { ...base, id: 'dddddddd-0000-4000-8000-000000000004', user_email: 'dbfail@example.com', name: 'Facilities', filters: { naics: '541511' }, last_seen_notice_ids: ['N-OLD'], total_alerts_sent: 2, last_alerted_at: '2026-10-02T11:00:10Z' };
const E = { ...base, id: 'eeeeeeee-0000-4000-8000-000000000005', user_email: 'newbie@example.com', name: 'Brand new', filters: { naics: '541511' }, last_seen_notice_ids: [], total_alerts_sent: 0, last_alerted_at: null, created_at: '2026-10-03T20:00:00Z' };

const out: {
  runs: Row[]; posted: typeof slack; readiness?: Awaited<ReturnType<typeof getSavedSearchDeliveryReadiness>>;
  status: Record<string, ReturnType<typeof composeSearchAlertStatus>>;
} = { runs: [], posted: [], status: {} };

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  ss.searches = [A, B, C, D, E].map((x) => JSON.parse(JSON.stringify(x)));
  ss.open = [{ notice_id: 'N-NEW-1', title: 'IT services', department: 'DEPT OF X', naics_code: '541511', posted_date: '2026-10-02T00:00:00Z' }];
  tables.cron_jobs = [{ job_name: 'saved-search-alerts', route: '/api/cron/saved-search-alerts?limit=50', cron_expr: '0 11 * * *', enabled: true, last_run_at: '2026-10-04T11:00:28Z', last_status: 'error', locked_at: null, timeout_ms: 290000 }];
  tables.cron_job_runs = [{ job_name: 'heartbeat', started_at: '2026-10-05T05:59:00Z', status: 'success', error: null }];
  tables.email_suppressions = [{ user_email: 'internal@govconedu.example', reason: 'hard_bounce' }];

  for (const day of ['2026-10-03T11:00:27Z', '2026-10-04T11:00:28Z']) {
    clock = day;
    vi.setSystemTime(new Date(day));
    if (day.startsWith('2026-10-04')) ss.open.push({ notice_id: 'N-NEW-2', title: 'Network support', department: 'DEPT OF X', naics_code: '541511', posted_date: '2026-10-04T00:00:00Z' });
    await savedSearchAlerts(new NextRequest('https://x/api/cron/saved-search-alerts?limit=50', { headers: { 'x-cron-dispatch': '1' } }));
  }
  out.runs = (tables.cron_job_runs || []).filter((r) => r.job_name === 'saved-search-alerts');

  // Status as a customer would ask for it the same day, after the run.
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
  out.readiness = await getSavedSearchDeliveryReadiness(new Date('2026-10-04T12:00:00Z'));
  for (const s of ss.searches) {
    const recipient = await readRecipientEvidence(String(s.user_email));
    out.status[String(s.name)] = composeSearchAlertStatus(s as never, out.readiness, recipient, { reach: 'matches_open_now', detail: null }, new Date('2026-10-04T12:00:00Z'));
  }

  vi.setSystemTime(new Date('2026-10-05T06:00:29Z'));
  await watchdog(new NextRequest('http://localhost/api/cron/dispatcher-watchdog?password=pw'));
  out.posted = [...slack];
  vi.useRealTimers();
});

describe('mixed run: successful send + malformed search + suppressed recipient + suppression lookup failure', () => {
  it('the job self-reports every class, by name', () => {
    expect(out.runs).toHaveLength(2);
    const last = out.runs.at(-1)!;
    expect(last.status).toBe('error');
    expect(String(last.error).split(',').sort()).toEqual(['invalid_saved_filters=1', 'recipient_suppressed=1', 'suppression_lookup_failed=1']);
    // and the valid search really sent on the judged run, through the provider ledger
    expect((tables.email_provider_sends || []).filter((r) => String(r.sent_at).startsWith('2026-10-04')).map((r) => r.user_email)).toEqual(['person@example.com']);
  });

  it('job status: a NAMED partial failure — processing classes split from the suppression action item', () => {
    const r = out.readiness!;
    expect(r.job).toBe('saved-search-alerts');
    expect(r.job_status).toBe('partial_failure');
    expect(r.latest_run_processing_failures).toEqual({ invalid_saved_filters: 1, suppression_lookup_failed: 1 });
    expect(r.suppression_action_items).toEqual({ recipient_suppressed: 1 });
    expect(r.latest_run_alerts_provider_accepted).toBe(1);
    expect(r.latest_run_searches_evaluated).toBe(2); // A (sent) + E (baseline)
    expect(r.inbox_delivery).toBe('not_observable');
    expect(r.job_status_reason).toMatch(/^saved-search alerts: partial failure: invalid_saved_filters=1, suppression_lookup_failed=1 failed; the rest ran/);
    expect(r.delivery_ready).toBe(true);
  });

  it('A (valid, sent): delivering, provider-accepted not inbox, other failures named as not affecting it', () => {
    const s = out.status['IT services'];
    expect(s.headline).toBe('delivering');
    expect(s.summary).toMatch(/^Alerts for this search have been sent; our email provider last accepted one for this account at 2026-10-04 11:00 UTC \(inbox delivery is not tracked\)/);
    expect(s.summary).toContain('Saved-search alerts: the latest run had failures in other saved searches; this one is not affected.');
  });

  it('B (malformed): THIS search blocked, the others continue', () => {
    const s = out.status['Micro-purchase / SAP'];
    expect(s.headline).toBe('search_blocked_invalid_filters');
    expect(s.summary).toMatch(/^This saved search is blocked: its stored filters cannot be evaluated \(.*sapBuyer.*\)\. It will not alert until its filters are corrected; your other searches are unaffected\./);
  });

  it('C (suppressed recipient): an action item, explicitly not an outage', () => {
    const s = out.status['Internal watch'];
    expect(s.headline).toBe('search_blocked_recipient');
    expect(s.search_delivery).toBe('blocked_recipient_suppressed');
    expect(s.summary).toMatch(/^Alerts for this search are held: the account email is on the suppression list \(hard_bounce\)\. Action needed on the account email; this is not a system outage\./);
  });

  it('D (suppression lookup failed): a processing error that skipped this search — never "suppressed"', () => {
    const s = out.status.Facilities;
    expect(s.headline).toBe('search_failing');
    expect(s.summary).toMatch(/^This saved search was skipped by the latest saved-search alerts run/);
    expect(s.summary).toContain('suppression_lookup_failed=1');
    expect(s.summary).not.toMatch(/suppression list|suppressed recipient/);
  });

  it('E (new): checked, no alert sent — stated from recorded facts, without guessing baseline vs no-new-match', () => {
    const s = out.status['Brand new'];
    expect(s.search_delivery).toBe('checked_no_alert_sent');
    expect(s.headline).toBe('no_alert_yet');
    expect(s.summary).toMatch(/^This saved search has been checked, but no alert has been sent for it yet\. Mindy records that it was checked, not whether/);
  });

  it('no customer message generalizes the job to all Mindy email or calls it an outage', () => {
    for (const s of Object.values(out.status)) {
      expect(s.summary).not.toMatch(/Mindy email|all email|email alerts are unreliable|(?<!not a )system outage|not currently guaranteed/i);
      expect(s.summary).not.toMatch(/2026-09-29/);
    }
  });

  it('Slack: ONE incident naming the job, processing failures, and the suppression as an action item', () => {
    expect(out.posted).toHaveLength(1);
    expect(out.posted[0].subject).toBe('Cron watchdog: 1 opened');
    const t = out.posted[0].text;
    expect(t).toMatch(/🔴 OPENED saved-search-alerts — processing failures: invalid_saved_filters=1, suppression_lookup_failed=1/);
    expect(t).toContain('🛡️ Recipient suppression (not an outage): 1 email(s) not sent to CONFIRMED-suppressed recipient(s) (recipient_suppressed=1)');
    expect(t).not.toMatch(/suppression_lookup_failed=1\)\. Action: review email_suppressions/);
  });

  it('a recipient check that cannot be read at status time is unknown, never delivered and never suppressed', () => {
    const a = ss.searches.find((x) => x.name === 'IT services')!;
    const s = composeSearchAlertStatus(a as never, out.readiness!, { suppressed: undefined, lastAlertAt: undefined }, { reach: 'unknown', detail: null }, new Date('2026-10-04T12:00:00Z'));
    expect(s.search_delivery).toBe('unknown');
    expect(s.summary).toMatch(/could not be checked \(the recipient suppression check failed \(processing error\)\)/);
  });
});
