import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE REAL CRON HANDLER — daily-alert drain + visibility (2026-11-10).
 *
 * THE BUG: users not due today (day-of-week frequency) and users with no targeting
 * (no known NAICS and no keywords) were sliced INTO the fixed BATCH_SIZE window and then
 * dropped by a bare `continue` with NO alert_log row. They stayed "pending" all day, were
 * re-selected by every run, and starved the targeted users ranked behind them. Nothing in
 * alert_log or the HTTP status showed it.
 *
 * src/lib/alerts/daily-pending.unit.test.ts covers the planning helper only, so it stays
 * green even if the route stops using it. This file drives POST /api/cron/daily-alerts
 * (the real runDailyAlertJob) as a SCHEDULED run — no testEmail, so the day-of-week gate,
 * batching and final-run reporting are all live. Only the edges are faked: Supabase
 * (in-memory, alert_log keyed like its unique constraint), sendEmail (captured), and the
 * inert side services (grants, Today's Lens, Coming Back, cross-day retries, telemetry).
 *
 * Dates are chosen so the route's day-of-year rotation is 0 (Jan 1) wherever the order
 * of the queue matters, so "ranked ahead" means alphabetical order (the query's order).
 */

process.env.DAILY_ALERT_BATCH_SIZE = '3'; // read at module load — set before the dynamic import
const BATCH = 3;

type Row = Record<string, unknown>;

/** Built at READ time so posted/deadline dates are relative to the faked clock. */
const openRow = (): Row => {
  const at = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
  return {
    notice_id: 'n-janitorial-1',
    title: 'Janitorial Services — Federal Building',
    description: 'Janitorial and custodial services.',
    solicitation_number: 'SOL-JAN-1',
    naics_code: '561720',
    psc_code: 'S201',
    department: 'GENERAL SERVICES ADMINISTRATION',
    sub_tier: 'PUBLIC BUILDINGS SERVICE',
    office: '',
    posted_date: at(-0.2),
    response_deadline: at(10),
    archive_date: null,
    set_aside_code: null,
    set_aside_description: null,
    notice_type: 'Solicitation',
    active: true,
    ui_link: null,
    last_modified: at(-0.2),
  };
};

const baseUser = (email: string, over: Row = {}): Row => ({
  id: email, user_email: email, naics_codes: [], keywords: [], agencies: [], business_type: null,
  alerts_enabled: true, alert_frequency: 'daily', is_active: true, timezone: 'America/New_York',
  aggregated_profile: {}, naics_source: null, psc_codes: [], location_states: [],
  set_aside_preferences: [], total_alerts_sent: 0, ...over,
});
const targeted = (email: string, over: Row = {}) => baseUser(email, { naics_codes: ['561720'], ...over });
const untargeted = (email: string, over: Row = {}) => baseUser(email, over);

let USERS: Row[] = [];
/** alert_log keyed like the real unique constraint (user_email, alert_date, alert_type). */
const ALERT_LOG = new Map<string, Row>();
/** Every alert_log write per user — "exactly one row" must also mean "written once". */
const LOG_WRITES = new Map<string, number>();
const logKey = (r: Row) => `${r.user_email}|${r.alert_date}|${r.alert_type}`;

function fakeClient() {
  return {
    from(table: string) {
      let write: string | null = null;
      const filters: Array<[string, unknown[]]> = [];
      let payload: unknown = null;
      const result = () => {
        if (write) {
          const rows = (Array.isArray(payload) ? payload : [payload]).filter(Boolean) as Row[];
          if (table === 'alert_log' && (write === 'upsert' || write === 'insert')) {
            for (const r of rows) {
              const prev = ALERT_LOG.get(logKey(r));
              ALERT_LOG.set(logKey(r), { ...(prev || {}), ...r, id: prev?.id ?? `al-${logKey(r)}` });
              LOG_WRITES.set(String(r.user_email), (LOG_WRITES.get(String(r.user_email)) ?? 0) + 1);
            }
          }
          if (table === 'alert_log' && write === 'update') {
            const id = filters.find(([m, a]) => m === 'eq' && a[0] === 'id')?.[1][1];
            for (const [k, r] of ALERT_LOG) if (r.id === id) ALERT_LOG.set(k, { ...r, ...(payload as Row) });
          }
          return { data: rows, error: null, count: rows.length };
        }
        if (table === 'sam_opportunities') { const d = [openRow()]; return { data: d, error: null, count: 1 }; }
        if (table === 'user_notification_settings') return { data: USERS.map((u) => ({ ...u })), error: null, count: USERS.length };
        if (table === 'alert_log') {
          const d = [...ALERT_LOG.values()].filter((r) => filters.every(([m, a]) => {
            const [col, val] = a as [string, unknown];
            if (m === 'eq') return r[col] === undefined || r[col] === val;
            if (m === 'gte') return r[col] === undefined || String(r[col]) >= String(val);
            if (m === 'lt') return r[col] === undefined || (typeof val === 'number' ? Number(r[col] ?? 0) < val : String(r[col]) < String(val));
            if (m === 'in') return r[col] === undefined || (val as unknown[]).includes(r[col]);
            return true;
          }));
          return { data: d, error: null, count: d.length };
        }
        return { data: [], error: null, count: 0 };
      };
      let ranged = false;
      const b: Record<string, unknown> = {};
      for (const m of ['eq', 'neq', 'or', 'gte', 'lte', 'gt', 'lt', 'in', 'is', 'not', 'like', 'ilike', 'order', 'contains', 'overlaps', 'filter', 'match', 'textSearch', 'limit', 'select']) {
        b[m] = (...args: unknown[]) => { filters.push([m, args]); return b; };
      }
      // fetchAllPaged pages with .range(); the fake returns everything on the first page only.
      b.range = (a: number) => { ranged = true; if (a > 0) { write = null; (b as { _empty?: boolean })._empty = true; } return b; };
      for (const op of ['insert', 'update', 'upsert', 'delete']) b[op] = (p?: unknown) => { write = op; payload = p ?? null; return b; };
      const settle = () => ((b as { _empty?: boolean })._empty && ranged ? { data: [], error: null, count: 0 } : result());
      b.maybeSingle = async () => { const r = settle(); return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data }; };
      b.single = b.maybeSingle;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej);
      return b;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

const SENT: Array<{ to: string; subject: string; html: string }> = [];
const TOOL_ERRORS: Array<{ errorMessage?: string }> = [];

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient() }));
vi.mock('@/lib/supabase/server-clients', () => ({ getReadClient: () => fakeClient() }));
vi.mock('@/lib/send-email', () => ({
  sendEmail: async (m: { to: string; subject: string; html: string }) => { SENT.push(m); return true; },
}));
vi.mock('@/lib/intelligence', () => {
  class IntelligenceMetrics { constructor() { return new Proxy(this, { get: (_t, p) => (p === 'getSnapshot' ? () => ({}) : () => undefined) }); } }
  class GuardrailMonitor { constructor() { return new Proxy(this, { get: (_t, p) => (p === 'check' ? () => ({ continue: true }) : p === 'getStats' ? () => ({}) : async () => undefined) }); } }
  class CircuitBreaker { async isOpen() { return false; } async record() { return undefined; } }
  return { IntelligenceMetrics, GuardrailMonitor, CircuitBreaker, logIntelligenceDelivery: async () => undefined, postSendValidation: async () => ({ ok: true }) };
});
vi.mock('@/lib/briefings/pipelines/grants-gov', async (orig) => ({
  ...(await orig<typeof import('@/lib/briefings/pipelines/grants-gov')>()),
  searchGrantsByNAICS: async () => ({ grants: [], totalRecords: 0 }),
  scoreGrant: () => 100,
}));
vi.mock('@/lib/dashboard/todays-lens', () => ({ computeTodaysLens: async () => null }));
vi.mock('@/lib/alerts/coming-back-to-market', async (orig) => ({
  ...(await orig<typeof import('@/lib/alerts/coming-back-to-market')>()),
  loadComingBackSection: async () => ({ kind: 'omit', reason: 'no_naics_market' }),
}));
vi.mock('@/lib/alerts/retry-failed-daily', async (orig) => ({
  ...(await orig<typeof import('@/lib/alerts/retry-failed-daily')>()),
  retryFailedDailyAlerts: async () => ({ retried: 0, succeeded: 0, skipped: 0, failed: 0, skipReasons: {} }),
}));
vi.mock('@/lib/market/vault-eligibility', () => ({ loadVaultEligibility: async () => new Map() }));
vi.mock('@/lib/tool-errors', async (orig) => ({
  ...(await orig<typeof import('@/lib/tool-errors')>()),
  logToolError: async (e: { errorMessage?: string }) => { TOOL_ERRORS.push(e); },
}));
vi.mock('@/lib/engagement', async (orig) => ({
  ...(await orig<typeof import('@/lib/engagement')>()),
  createEmailTrackingToken: async () => ({ success: true, token: 'tok' }),
}));

let POST: typeof import('./route').POST;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.ADMIN_PASSWORD = 'admin-test-password';
  process.env.EMAIL_ACTION_SECRET = 'test-email-action-secret';
  delete process.env.SAM_API_KEY;
  delete process.env.ENABLE_HIDDEN_MATCH;
  delete process.env.ENABLE_DAILY_ALERT_AI_TIPS;
  delete process.env.ENABLE_MINDY_INSIGHTS;
  ({ POST } = await import('./route'));
});

beforeEach(() => {
  SENT.length = 0; TOOL_ERRORS.length = 0; ALERT_LOG.clear(); LOG_WRITES.clear(); USERS = [];
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => { vi.useRealTimers(); });

/** A SCHEDULED run: no testEmail (that bypasses the day gate and final-run reporting). */
async function run(): Promise<{ status: number; body: any }> {
  const res = await POST(new NextRequest('http://x/api/cron/daily-alerts', {
    method: 'POST',
    headers: { authorization: 'Bearer cron-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ skipTimezoneCheck: true }),
  }));
  return { status: res.status, body: await res.json() };
}
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const rowFor = (email: string, day: string) => ALERT_LOG.get(`${email}|${day}|daily`);
const sentTo = () => SENT.map((m) => m.to).sort();

// 2027-01-01 is a FRIDAY with day-of-year 0 (rotation 0): 'weekends' users are not due.
const FRI = '2027-01-01';
// 2028-01-01 is a SATURDAY with day-of-year 0: 'weekdays' users are not due.
const SAT = '2028-01-01';

/**
 * More ineligible users than BATCH, all ranked (alphabetically) ahead of the targeted ones:
 * 4 no-targeting (incl. a malformed comma-joined NAICS with no keywords), 2 not-due-today,
 * then 2 targeted (a NAICS profile and a keyword-only profile).
 */
function starvationAudience() {
  USERS = [
    untargeted('a1-none@example.com'),
    untargeted('a2-none@example.com'),
    untargeted('a3-none@example.com', { keywords: null }),
    untargeted('a4-malformed@example.com', { naics_codes: ['236220,337127'] }),
    targeted('b1-weekend@example.com', { alert_frequency: 'weekends' }),
    targeted('b2-weekend@example.com', { alert_frequency: 'weekends' }),
    targeted('z1-naics@example.com'),
    baseUser('z2-keyword@example.com', { keywords: ['janitorial'] }),
  ];
}
const NO_TARGETING = ['a1-none@example.com', 'a2-none@example.com', 'a3-none@example.com', 'a4-malformed@example.com'];
const NOT_DUE = ['b1-weekend@example.com', 'b2-weekend@example.com'];
const TARGETED = ['z1-naics@example.com', 'z2-keyword@example.com'];

describe('daily-alerts cron — eligible targeted users are not starved by ineligible users', () => {
  it('batch 3, six ineligible users ranked first → both targeted users are sent in the first run', async () => {
    starvationAudience();
    at(`${FRI}T11:00:00Z`);
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(sentTo()).toEqual(TARGETED);
    for (const e of TARGETED) expect(rowFor(e, FRI)).toMatchObject({ delivery_status: 'sent' });
    expect(body.pendingAfterRun).toBe(0);
  });

  it('targeted users still are not starved across repeated runs the same day (no run is spent on ineligible users)', async () => {
    starvationAudience();
    at(`${FRI}T11:00:00Z`);
    await run(); await run(); await run();
    expect(sentTo()).toEqual(TARGETED); // each sent exactly once over three runs
  });
});

describe('daily-alerts cron — ineligible users do not repeatedly block the queue', () => {
  it('no-targeting users get exactly ONE skipped/no_targeting row and are not re-selected on a later run', async () => {
    starvationAudience();
    at(`${FRI}T11:00:00Z`);
    const first = await run();
    for (const e of NO_TARGETING) {
      expect(rowFor(e, FRI), `${e} must be visible in alert_log`).toMatchObject({ delivery_status: 'skipped', error_message: 'no_targeting' });
    }
    expect(first.body.batching).toMatchObject({ noTargeting: 4, notDueToday: 2 });

    at(`${FRI}T11:10:00Z`);
    const second = await run();
    expect(second.status).toBe(200);
    expect(second.body.message).toBe('All users already processed today');
    for (const e of NO_TARGETING) expect(LOG_WRITES.get(e), `${e} written once for the day`).toBe(1);
    expect(second.body.noTargeting).toBe(0); // nothing left to classify — they left the queue
  });

  it('not-due users get no row (they are not owed an alert) and are not sent', async () => {
    starvationAudience();
    at(`${FRI}T11:00:00Z`);
    await run();
    for (const e of NOT_DUE) { expect(rowFor(e, FRI)).toBeUndefined(); expect(sentTo()).not.toContain(e); }
  });
});

describe('daily-alerts cron — the final run of the window reports undrained recipients', () => {
  const five = () => { USERS = ['z1', 'z2', 'z3', 'z4', 'z5'].map((p) => targeted(`${p}@example.com`)); };

  it('final run (14:55 UTC) leaving due, targeted users unsent → non-2xx with the pending count + a tool error', async () => {
    five();
    at(`${FRI}T14:55:00Z`);
    const { status, body } = await run();
    expect(SENT).toHaveLength(BATCH);
    expect(status).toBeGreaterThanOrEqual(500);
    expect(body.success).toBe(false);
    expect(body.pendingAfterRun).toBe(5 - BATCH);
    expect(TOOL_ERRORS.some((e) => /2 due, targeted recipient/.test(String(e.errorMessage)))).toBe(true);

    // The next run drains the rest; with nothing pending the final run is healthy again.
    at(`${FRI}T14:56:00Z`);
    const drained = await run();
    expect(drained.status).toBe(200);
    expect(drained.body.pendingAfterRun).toBe(0);
    expect(SENT).toHaveLength(5);
  });

  it('a NON-final run with the same backlog is a normal 200 that still reports what is left', async () => {
    five();
    at(`${FRI}T11:00:00Z`);
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.pendingAfterRun).toBe(5 - BATCH);
    expect(TOOL_ERRORS).toHaveLength(0);
  });

  it('no-targeting and not-due users never count as pending on the final run', async () => {
    starvationAudience();
    at(`${FRI}T14:55:00Z`);
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.pendingAfterRun).toBe(0);
  });
});

describe('daily-alerts cron — preserved: frequency, matching, same-day dedup', () => {
  it('Saturday: a weekdays user is not sent and not pending; daily + keyword-only users are sent; an already-sent user is not re-sent', async () => {
    USERS = [
      targeted('a-already@example.com'),
      targeted('b-weekdays@example.com', { alert_frequency: 'weekdays' }),
      targeted('c-daily@example.com'),
      baseUser('d-keyword@example.com', { keywords: ['janitorial'] }),
    ];
    // Kept within BATCH so this case isolates the preserved semantics from the starvation bug.
    ALERT_LOG.set(`a-already@example.com|${SAT}|daily`, {
      id: 'pre', user_email: 'a-already@example.com', alert_date: SAT, alert_type: 'daily',
      delivery_status: 'sent', error_message: null, retry_count: 0, opportunities_data: [],
    });
    at(`${SAT}T14:55:00Z`); // final run: a weekdays user on Saturday must NOT make it fail
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(sentTo()).toEqual(['c-daily@example.com', 'd-keyword@example.com']);
    expect(rowFor('b-weekdays@example.com', SAT)).toBeUndefined();
    expect(rowFor('a-already@example.com', SAT)).toMatchObject({ id: 'pre', delivery_status: 'sent' });
    expect(body.pendingAfterRun ?? 0).toBe(0);
    expect(SENT.every((m) => /Janitorial Services/.test(m.html))).toBe(true); // matched on the same notice

    await run();
    expect(SENT).toHaveLength(2); // no duplicates on a later run
    expect(rowFor('b-weekdays@example.com', SAT)).toBeUndefined();
  });
});
