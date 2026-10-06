/**
 * WEEKLY ALERT DELIVERY TRUTH — proven through the REAL GET handler of /api/cron/weekly-alerts.
 *
 * Two production defects (measured 2026-10-06 from alert_log, read-only):
 *
 * Rebased onto #1854 (2026-10-06), which replaced the 750-user ceiling with a time-budgeted drain
 * and already records guard-blocked sends as skipped. What this file still proves on top of it:
 * explicit weekly subscribers are processed FIRST; a failed Open search is a failure (retried in a
 * later window), never "No matching opportunities found"; keyword-only subscribers are searched on
 * their keywords; every run reports the cycle's expected/processed/not-reached split and every
 * outcome reason. The blocked-send and broken-dedup cases are kept as regression guards for #1854.
 *
 * History — 1. EXPLICIT-WEEKLY SUBSCRIBERS STARVED. The cycle has a fixed capacity: BATCH_SIZE (75) per run ×
 *    10 dispatcher runs (cron_jobs weekly-alerts 6× Sun + weekly-alerts-mon 4× Mon) = 750 rows, and
 *    every cycle since 2026-07-05 wrote exactly 750. #1257 (2026-08-23) correctly paged the eligible
 *    read (1,000 → 1,873) but also ordered it by user_email, so each cycle now processes the
 *    alphabetically-first ~750 users and never reaches the rest. Users with alert_frequency='weekly'
 *    share that queue with ~1,800 free daily users who get the "free weekly fallback": explicit-weekly
 *    rows per cycle fell from 96/103 (Aug 9/16) to 31–42 (Aug 23 → Oct 4). The never-reached users
 *    have NO alert_log row at all, so no skip reason exists for them.
 *
 * 2. PHANTOM "SENT". The route ignored sendEmail()'s `false` (the send guard blocked the recipient,
 *    e.g. suppressed after a hard bounce) and wrote delivery_status='sent' + bumped total_alerts_sent.
 *    The daily route fixed the same defect in July (`send_guard_blocked`).
 *
 * Supabase, sendEmail and the shop buyer fetch are recording fakes. No production data, no email.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
  process.env.CRON_SECRET = 'test-secret';
});

type Row = Record<string, unknown>;
const state = {
  users: [] as Row[],
  log: [] as Row[],
  profileUpdates: [] as Array<{ email: unknown; payload: Row }>,
  sends: [] as string[],
  blocked: new Map<string, string>(),
  /** When set, the SAM cache query fails with this PostgREST error (e.g. a statement timeout). */
  samError: null as null | { code: string; message: string },
  /** When true, the cycle's alert_log dedup read fails. */
  dedupError: false,
  /** The PostgREST .or(...) filter the REAL shared search built for each sam_opportunities read. */
  samOr: [] as string[],
  sendHtml: new Map<string, string>(),
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
      if (state.dedupError) return done({ data: null, error: { message: 'connection reset' } });
      const cycleRows = state.log.filter((r) => r.alert_date === eqVal('alert_date') && r.alert_type === eqVal('alert_type'));
      return done({ data: range ? cycleRows.slice(range[0], range[1] + 1) : cycleRows, error: null });
    }
    if (table === 'user_notification_settings') {
      if (mode === 'update') { state.profileUpdates.push({ email: eqVal('user_email'), payload }); return done({ error: null }); }
      const rows = range ? state.users.slice(range[0], range[1] + 1) : state.users;
      return done({ data: rows, error: null });
    }
    if (table === 'sam_opportunities') {
      state.samOr.push(ops.filter(([m]) => m === 'or').map(([, a]) => String(a[0] ?? '')).join(' | '));
      if (state.samError) return done({ data: null, error: state.samError });
      return done({ data: [{ notice_id: 'N-1', title: 'IT support services', solicitation_number: 'S-1', department: 'DEPT OF X', naics_code: '541512', posted_date: new Date().toISOString(), response_deadline: '2026-12-01T00:00:00Z', notice_type: 'Solicitation', active: true }], error: null });
    }
    return done({ data: [], error: null });
  };
  return proxy;
}

vi.mock('@/lib/cron-self-report', () => ({ reportCronOutcome: vi.fn(async () => undefined) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t), rpc: () => Promise.resolve({ data: [], error: null }) }) }));
vi.mock('@/lib/briefings/delivery/rollout', () => ({ resolveBriefingAudience: vi.fn(async () => ({ users: [] })) }));
vi.mock('@/lib/send-email', () => ({
  sendEmail: vi.fn(async (m: { to: string; html?: string; onBlocked?: (r: string) => void }) => {
    const reason = state.blocked.get(m.to);
    if (reason) { m.onBlocked?.(reason); return false; }
    state.sends.push(m.to);
    state.sendHtml.set(m.to, m.html || '');
    return true;
  }),
}));

const { GET } = await import('./route');
const run = () => GET(new NextRequest('https://x/api/cron/weekly-alerts?catchup=true', {
  headers: { authorization: 'Bearer test-secret', 'x-cron-dispatch': '1' },
}));

const user = (email: string, freq: string): Row => ({
  user_email: email, alert_frequency: freq, alerts_enabled: true, is_active: true,
  naics_codes: ['541512'], business_type: null, agencies: [], location_state: null, total_alerts_sent: 3,
});

beforeEach(() => {
  state.users = []; state.log = []; state.profileUpdates = []; state.sends = []; state.blocked = new Map(); state.samError = null; state.dedupError = false; state.samOr = []; state.sendHtml = new Map();
  // Shop buyer list → nobody is Pro (every non-weekly user is a free-weekly-fallback recipient).
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ purchases: [] }), { status: 200 })));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T23:10:00Z')); // a Sunday run of the 2026-10-04 cycle
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('weekly-alerts — explicit weekly subscribers are reached every cycle', () => {
  it('a user who chose weekly is processed FIRST, ahead of 760 fallback users who sort before them', async () => {
    for (let i = 0; i < 760; i++) state.users.push(user(`a${String(i).padStart(4, '0')}@example.com`, 'daily'));
    state.users.push(user('zz-weekly@example.com', 'weekly'));

    await run();

    const weeklyRow = state.log.find((row) => row.user_email === 'zz-weekly@example.com');
    expect(weeklyRow?.delivery_status).toBe('sent');
    expect(state.sends[0]).toBe('zz-weekly@example.com'); // explicit weekly first, not alphabetical
    expect(state.log).toHaveLength(761); // the #1854 drain still reaches everyone
  });
});

describe('weekly-alerts — a blocked send is never logged as sent', () => {
  it('suppressed recipient → skipped/send_guard_blocked, profile counters untouched', async () => {
    state.users.push(user('bounced@example.com', 'weekly'));
    state.blocked.set('bounced@example.com', 'suppressed:hard_bounce');

    const body = await (await run()).json();

    const row = state.log.find((r) => r.user_email === 'bounced@example.com');
    expect(row?.delivery_status).toBe('skipped');
    expect(row?.error_message).toBe('send_guard_blocked');
    expect(state.profileUpdates).toHaveLength(0); // no last_alert_sent / total_alerts_sent bump
    expect(body.results.sent).toBe(0);
  });
});

describe('weekly-alerts — a failed Open search is a failure, never "No matching opportunities found"', () => {
  it('records open_search_failed, retries within the cycle, and stops after the attempt budget', async () => {
    state.users.push(user('w@example.com', 'weekly'));
    state.samError = { code: '57014', message: 'canceling statement due to statement timeout' };

    const first = await (await run()).json();
    let row = state.log.find((r) => r.user_email === 'w@example.com');
    expect(row?.delivery_status).toBe('failed');
    expect(String(row?.error_message)).toMatch(/^open_search_failed:57014/);
    expect(row?.error_message).not.toBe('No matching opportunities found');
    expect(first.results.openSearchFailed).toBe(1);
    expect(state.sends).toHaveLength(0);

    await run(); // 2nd run of the cycle: re-searched (retry-eligible), still failing
    await run(); // 3rd: budget reached
    row = state.log.find((r) => r.user_email === 'w@example.com');
    expect(row?.retry_count).toBe(2);
    const fourth = await (await run()).json(); // exhausted → not searched again this cycle
    expect(fourth.results?.openSearchFailed ?? 0).toBe(0);
  });

  it('a later run in the same cycle sends normally once the search recovers', async () => {
    state.users.push(user('w@example.com', 'weekly'));
    state.samError = { code: '57014', message: 'canceling statement due to statement timeout' };
    await run();
    state.samError = null;
    await run();
    const row = state.log.find((r) => r.user_email === 'w@example.com');
    expect(row?.delivery_status).toBe('sent');
    expect(state.sends).toEqual(['w@example.com']); // exactly one email
  });
});

describe('weekly-alerts — the cycle reports expected, processed and every outcome reason', () => {
  it('splits explicit weekly vs fallback and names every reason', async () => {
    state.users.push(user('a-fallback@example.com', 'daily'));
    state.users.push({ ...user('b-nonaics@example.com', 'daily'), naics_codes: [] });
    state.users.push(user('c-weekly@example.com', 'weekly'));
    state.users.push(user('d-bounced@example.com', 'weekly'));
    state.blocked.set('d-bounced@example.com', 'suppressed:hard_bounce');

    const body = await (await run()).json();
    expect(body.cycle.expected).toEqual({ explicitWeekly: 2, freeWeeklyFallback: 2, total: 4 });
    expect(body.cycle.processed).toMatchObject({ explicitWeekly: 2, freeWeeklyFallback: 2 });
    expect(body.cycle.notYetReached).toEqual({ explicitWeekly: 0, freeWeeklyFallback: 0 });
    expect(body.cycle.outcomes).toEqual({
      sent: 2,
      'skipped:No NAICS configured': 1,
      'skipped:send_guard_blocked': 1,
    });
  });
});

describe('weekly-alerts — a broken dedup read stops the run instead of re-sending', () => {
  it('returns 500 and sends nothing', async () => {
    state.users.push(user('w@example.com', 'weekly'));
    state.dedupError = true;
    const res = await run();
    expect(res.status).toBe(500);
    expect(state.sends).toHaveLength(0);
  });
});

describe('weekly-alerts — keyword-only subscribers search on their keywords (shared path)', () => {
  const kwUser = (email: string, keywords: string[]): Row => ({ ...user(email, 'weekly'), naics_codes: [], keywords });

  it('a keyword-only weekly subscriber is searched on their keywords and sent — not skipped as "No NAICS configured"', async () => {
    state.users.push(kwUser('kw@example.com', ['janitorial services', 'custodial']));
    await run();
    const row = state.log.find((r) => r.user_email === 'kw@example.com');
    expect(row?.delivery_status).toBe('sent');
    expect(row?.error_message ?? null).toBeNull();
    const filter = state.samOr.join(' ');
    expect(filter).toMatch(/janitorial services/i);      // the keyword reached the shared search
    expect(filter).not.toMatch(/naics_code\./);          // no NAICS market was invented
    const html = state.sendHtml.get('kw@example.com') || '';
    expect(html).toMatch(/Keywords: janitorial services, custodial/);
    expect(html).not.toMatch(/NAICS: Any/);
  });

  it('keyword-only + the search errors → the failed-search path (retry-eligible), never a skip or a zero', async () => {
    state.users.push(kwUser('kw@example.com', ['janitorial services']));
    state.samError = { code: '57014', message: 'canceling statement due to statement timeout' };
    const body = await (await run()).json();
    const row = state.log.find((r) => r.user_email === 'kw@example.com');
    expect(row?.delivery_status).toBe('failed');
    expect(String(row?.error_message)).toMatch(/^open_search_failed:57014/);
    expect(body.results.openSearchFailed).toBe(1);
    expect(state.sends).toHaveLength(0);
  });

  it('no NAICS and only generic keywords → explicit skip, no search issued (never the whole market)', async () => {
    state.users.push(kwUser('generic@example.com', ['services', 'government']));
    await run();
    const row = state.log.find((r) => r.user_email === 'generic@example.com');
    expect(row).toMatchObject({ delivery_status: 'skipped', error_message: 'No NAICS configured; keywords too generic to search' });
    expect(state.samOr).toHaveLength(0);
    expect(state.sends).toHaveLength(0);
  });

  it('control: a NAICS + keyword profile is unchanged — the weekly search is NAICS-only, keywords not added', async () => {
    state.users.push({ ...user('both@example.com', 'weekly'), keywords: ['janitorial services'] });
    await run();
    const filter = state.samOr.join(' ');
    expect(filter).toMatch(/naics_code\./);
    expect(filter).not.toMatch(/janitorial/i);
    expect(state.log.find((r) => r.user_email === 'both@example.com')?.delivery_status).toBe('sent');
  });
});
