/**
 * WEEKLY ALERT TIER RESOLUTION — proven through the REAL GET handler of /api/cron/weekly-alerts.
 *
 * Production defect (2026-11-15 and 2026-11-22 cycles sent ZERO weekly emails, baseline ~1,455):
 * #2009 (f3b82fad1) put `await hasProAccess()` inside getAlertLimit. The eligibility loop called it
 * SERIALLY for every active user before the drain (resolveAccess ≈ 4 sequential round trips per free
 * user), and the drain called it a second time per user. Over ~2,000 users that exceeded
 * maxDuration=300s before a single alert_log row was written, and RUN_BUDGET_MS was only checked
 * inside drainCycle, so the run was killed without ever calling reportCronOutcome.
 *
 * What this file proves:
 *   1. 300 users with a 20ms hasProAccess finish eligibility + drain inside a 2s budget
 *      (serially that alone would be 6s), with bounded concurrency (≤ 25 in flight).
 *   2. Every user's tier is resolved EXACTLY ONCE per run (no second lookup in the drain).
 *   3. #2009's semantics hold: a Pro/trial user who did not choose weekly is not a free fallback.
 *   4. A Pro check that throws falls back to the purchase list (as before) and is COUNTED.
 *   5. Budget spent during tier resolution → the run self-reports `partial` (Mon: `error`) via
 *      reportCronOutcome and sends nothing — never a silent kill.
 *
 * Supabase, sendEmail, hasProAccess and the shop buyer fetch are fakes. No production data, no email.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
  process.env.CRON_SECRET = 'test-secret';
  process.env.WEEKLY_ALERT_RUN_BUDGET_MS = '2000';
});

type Row = Record<string, unknown>;
const state = {
  users: [] as Row[],
  log: [] as Row[],
  sends: [] as string[],
  proEmails: new Set<string>(),
  throwFor: new Set<string>(),
  proDelayMs: 20,
  proCalls: [] as string[],
  inFlight: 0,
  maxInFlight: 0,
};

function builder(table: string) {
  const ops: Array<[string, unknown[]]> = [];
  let mode: 'select' | 'upsert' | 'update' = 'select';
  let payload: Row = {};
  let range: [number, number] | null = null;
  const b: Record<string, unknown> = {};
  const proxy: Record<string, unknown> = new Proxy(b, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...a: unknown[]) => { ops.push([prop, a]); return proxy; };
    },
  });
  const eqVal = (col: string) => ops.find(([m, a]) => m === 'eq' && a[0] === col)?.[1][1];
  b.range = (from: number, to: number) => { range = [from, to]; return proxy; };
  b.upsert = (p: Row) => { mode = 'upsert'; payload = p; return proxy; };
  b.update = (p: Row) => { mode = 'update'; payload = p; return proxy; };
  b.maybeSingle = () => {
    if (table === 'alert_log') {
      const hit = state.log.find((r) => r.user_email === eqVal('user_email') && r.alert_date === eqVal('alert_date') && r.alert_type === eqVal('alert_type'));
      return Promise.resolve({ data: hit ? { id: 'x' } : null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    const done = (v: unknown) => Promise.resolve(v).then(resolve, reject);
    if (table === 'alert_log') {
      if (mode === 'upsert') {
        state.log = state.log.filter((r) => !(r.user_email === payload.user_email && r.alert_date === payload.alert_date && r.alert_type === payload.alert_type));
        state.log.push({ ...payload });
        return done({ error: null });
      }
      const cycleRows = state.log.filter((r) => r.alert_date === eqVal('alert_date') && r.alert_type === eqVal('alert_type'));
      return done({ data: range ? cycleRows.slice(range[0], range[1] + 1) : cycleRows, error: null });
    }
    if (table === 'user_notification_settings') {
      if (mode === 'update') return done({ error: null });
      const rows = range ? state.users.slice(range[0], range[1] + 1) : state.users;
      return done({ data: rows, error: null });
    }
    if (table === 'sam_opportunities') {
      return done({ data: [{ notice_id: 'N-1', title: 'IT support services', solicitation_number: 'S-1', department: 'DEPT OF X', naics_code: '541512', posted_date: new Date().toISOString(), response_deadline: '2026-12-01T00:00:00Z', notice_type: 'Solicitation', active: true }], error: null });
    }
    return done({ data: [], error: null });
  };
  return proxy;
}

const reportCronOutcome = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('@/lib/cron-self-report', () => ({ reportCronOutcome: (...a: unknown[]) => reportCronOutcome(...a) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t), rpc: () => Promise.resolve({ data: [], error: null }) }) }));
vi.mock('@/lib/briefings/delivery/rollout', () => ({ resolveBriefingAudience: vi.fn(async () => ({ users: [] })) }));
vi.mock('@/lib/access/resolve-access', () => ({
  hasProAccess: vi.fn(async (email: string) => {
    state.proCalls.push(email);
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      await new Promise((r) => setTimeout(r, state.proDelayMs));
      if (state.throwFor.has(email)) throw new Error('kv timeout');
      return state.proEmails.has(email);
    } finally {
      state.inFlight--;
    }
  }),
}));
vi.mock('@/lib/send-email', () => ({
  sendEmail: vi.fn(async (m: { to: string }) => { state.sends.push(m.to); return true; }),
}));

const { GET } = await import('./route');
const run = () => GET(new NextRequest('https://x/api/cron/weekly-alerts?catchup=true', {
  headers: { authorization: 'Bearer test-secret', 'x-cron-dispatch': '1' },
}));

const user = (email: string, freq: string): Row => ({
  user_email: email, alert_frequency: freq, alerts_enabled: true, is_active: true,
  naics_codes: ['541512'], business_type: null, agencies: [], location_state: null, total_alerts_sent: 0,
});

beforeEach(() => {
  state.users = []; state.log = []; state.sends = []; state.proEmails = new Set(); state.throwFor = new Set();
  state.proDelayMs = 20; state.proCalls = []; state.inFlight = 0; state.maxInFlight = 0;
  reportCronOutcome.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ purchases: [] }), { status: 200 })));
  // Pin a Sunday (so the job name is 'weekly-alerts' → 'partial') while letting the clock run, so the
  // run budget measures real elapsed time.
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-22T23:10:00Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('weekly-alerts — tier resolution is concurrent, once per user, and inside the run budget', () => {
  it('300 users × 20ms Pro check: eligibility + drain finish inside a 2s budget, each tier resolved once', async () => {
    for (let i = 0; i < 300; i++) state.users.push(user(`u${String(i).padStart(4, '0')}@example.com`, 'daily'));

    const started = Date.now();
    const body = await (await run()).json();
    const elapsed = Date.now() - started;

    // Serially the Pro checks alone would be 300 × 20ms = 6s > the 2s budget.
    expect(elapsed).toBeLessThan(2000);
    expect(state.proCalls).toHaveLength(300);
    expect(new Set(state.proCalls).size).toBe(300); // exactly once per user (no second drain lookup)
    expect(state.maxInFlight).toBeGreaterThan(1);
    expect(state.maxInFlight).toBeLessThanOrEqual(25);
    expect(state.log).toHaveLength(300);
    expect(state.sends).toHaveLength(300);
    expect(body.batch.remaining).toBe(0);
    expect(body.tiers).toMatchObject({ candidates: 300, resolved: 300, lookupFailed: 0 });
    expect(reportCronOutcome).toHaveBeenCalledWith('weekly-alerts', 'success');
  });

  it("keeps #2009's semantics: a Pro/trial user who did not choose weekly is not a free fallback; a Pro weekly user still gets the weekly alert", async () => {
    state.users.push(user('free@example.com', 'daily'));
    state.users.push(user('pro-daily@example.com', 'daily'));
    state.users.push(user('pro-weekly@example.com', 'weekly'));
    state.proEmails = new Set(['pro-daily@example.com', 'pro-weekly@example.com']);

    await run();

    expect(state.sends.sort()).toEqual(['free@example.com', 'pro-weekly@example.com']);
    const proWeekly = state.log.find((r) => r.user_email === 'pro-weekly@example.com');
    expect((proWeekly?.opportunities_data as Row[])[0]).toMatchObject({ tier: 'pro', alertSource: 'explicit_weekly' });
    expect(state.proCalls.sort()).toEqual(['free@example.com', 'pro-daily@example.com', 'pro-weekly@example.com']);
  });

  it('a Pro check that throws falls back to the purchase list (free here), and the failure is counted', async () => {
    state.users.push(user('ok@example.com', 'daily'));
    state.users.push(user('flaky@example.com', 'daily'));
    state.throwFor = new Set(['flaky@example.com']);

    const body = await (await run()).json();

    expect(state.sends.sort()).toEqual(['flaky@example.com', 'ok@example.com']);
    expect(body.tiers.lookupFailed).toBe(1);
    expect(body.tiers.lookupFailedEmails).toEqual(['flaky@example.com']);
  });

  it('budget spent during tier resolution → self-reported partial, nothing sent, never a silent kill', async () => {
    // 300 users / 25 in flight × 250ms ≈ 3s of tier lookups against a 2s budget.
    state.proDelayMs = 250;
    for (let i = 0; i < 300; i++) state.users.push(user(`u${String(i).padStart(4, '0')}@example.com`, 'daily'));

    const res = await run();
    const body = await res.json();

    expect(body.stoppedForBudget).toBe(true);
    expect(body.phase).toBe('tier_resolution');
    expect(body.tiers.unresolved).toBeGreaterThan(0);
    expect(body.tiers.resolved + body.tiers.unresolved).toBe(300);
    expect(state.proCalls.length).toBeLessThan(300); // stopped STARTING lookups at the deadline
    expect(state.sends).toHaveLength(0);
    expect(state.log).toHaveLength(0);
    expect(reportCronOutcome).toHaveBeenCalledTimes(1);
    const [job, outcome, message] = reportCronOutcome.mock.calls[0] as [string, string, string];
    expect(job).toBe('weekly-alerts');
    expect(outcome).toBe('partial');
    expect(message).toMatch(/run budget .* spent resolving tiers/);
  });
});
