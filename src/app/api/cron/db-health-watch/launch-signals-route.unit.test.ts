/**
 * Wiring test for launch signals THROUGH the real hourly db-health-watch GET handler.
 *
 * src/lib/ops/launch-signals.unit.test.ts covers the module in isolation, so it stays green
 * even if the route stops calling it. This file drives the route itself — fake Supabase, an
 * in-memory KV, a captured sendOpsAlert (no Slack is ever called) — and fails if the route
 * does not run, dedup, or report the three launch signals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── captured ops alerts ─────────────────────────────────────────────────────
const sent: { subject: string; html: string }[] = [];
let sendThrows = false;
vi.mock('@/lib/ops-alert', () => ({
  sendOpsAlert: vi.fn(async (m: { subject: string; html: string }) => {
    if (sendThrows) throw new Error('slack down');
    sent.push({ subject: m.subject, html: m.html });
    return { ok: true };
  }),
}));

// ─── in-memory KV ────────────────────────────────────────────────────────────
const kvStore = new Map<string, unknown>();
vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(async (k: string) => (kvStore.has(k) ? kvStore.get(k) : null)),
    set: vi.fn(async (k: string, v: unknown) => { kvStore.set(k, v); return 'OK'; }),
  },
}));

// ─── fake Supabase ───────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const brokenTables = new Set<string>();
/** Tables whose reads never resolve (a slow-but-up DB). */
const hangingTables = new Set<string>();
/** Fake-clock milliseconds a db-health PROBE read "takes" (advances the Date-only fake clock). */
let probeCostMs = 0;
/** Fake-clock milliseconds the pg-stats RPC probe "takes". */
let rpcCostMs = 0;

function builder(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let countMode = false;
  let head = false;
  let range: [number, number] | null = null;
  let limit: number | null = null;

  const exec = async () => {
    if (hangingTables.has(table)) return new Promise<never>(() => {});
    if (table === 'sam_opportunities' && probeCostMs) vi.setSystemTime(Date.now() + probeCostMs);
    if (brokenTables.has(table)) {
      return { data: null, count: null, error: { message: `relation "${table}" is unavailable` } };
    }
    let hit = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
    const count = countMode ? hit.length : null;
    if (range) hit = hit.slice(range[0], range[1] + 1);
    if (limit != null) hit = hit.slice(0, limit);
    return { data: head ? null : JSON.parse(JSON.stringify(hit)), count, error: null };
  };

  const b: Record<string, unknown> = {
    select: (_cols?: string, o?: { count?: string; head?: boolean }) => {
      countMode = o?.count === 'exact';
      head = !!o?.head;
      return b;
    },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
    gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b; },
    order: () => b,
    limit: (n: number) => { limit = n; return b; },
    range: (from: number, to: number) => { range = [from, to]; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
  };
  return b;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => builder(t),
    rpc: async () => { if (rpcCostMs) vi.setSystemTime(Date.now() + rpcCostMs); return { data: null, error: { message: 'function db_health_stats() does not exist' } }; },
  }),
}));

// Read at module load by the route.
process.env.CRON_SECRET = 'test-cron-secret';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
const { GET } = await import('./route');

// Wednesday, 16:00 UTC — past the 15:00 UTC pending-check hour.
const NOW = new Date('2026-11-11T16:00:00.000Z');
const TODAY = '2026-11-11';

function req() {
  return new NextRequest('https://getmindy.ai/api/cron/db-health-watch', {
    headers: { authorization: 'Bearer test-cron-secret' },
  });
}

type Outcome = { key: string; status: string; count: number | null; action: string; sent: boolean };
async function run() {
  const res = await GET(req());
  expect(res.status).toBe(200);
  return (await res.json()) as {
    status: string;
    prev: string;
    transitioned: boolean;
    alerted: boolean;
    probes: { name: string; ok: boolean }[];
    launchSignals: Outcome[] | { error: string } | string;
    checkedAt: string;
  };
}

function signals(body: Awaited<ReturnType<typeof run>>): Outcome[] {
  expect(Array.isArray(body.launchSignals), `launchSignals missing/not an array: ${JSON.stringify(body.launchSignals)}`).toBe(true);
  return body.launchSignals as Outcome[];
}
const byKey = (s: Outcome[], k: string) => s.find((o) => o.key === k)!;

function seedHealthy() {
  tables.sam_opportunities = [{ notice_id: 'n1', active: true }];
  tables.user_notification_settings = [
    { user_email: 'a@x.com', is_active: true, alerts_enabled: true, alert_frequency: 'daily', naics_codes: ['541512'], keywords: [] },
    { user_email: 'b@x.com', is_active: true, alerts_enabled: true, alert_frequency: 'daily', naics_codes: ['236220'], keywords: [] },
  ];
  // Both users already received today's daily alert → nothing pending.
  tables.alert_log = [
    { user_email: 'a@x.com', alert_date: TODAY, alert_type: 'daily' },
    { user_email: 'b@x.com', alert_date: TODAY, alert_type: 'daily' },
  ];
  tables.mcp_call_log = [];
  tables.tool_errors = [];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  sent.length = 0;
  sendThrows = false;
  hangingTables.clear();
  probeCostMs = 0;
  rpcCostMs = 0;
  kvStore.clear();
  brokenTables.clear();
  for (const k of Object.keys(tables)) delete tables[k];
  seedHealthy();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('db-health-watch route → launch signals', () => {
  it('reports all three launch signals alongside the db-health fields', async () => {
    const body = await run();
    expect(body.status).toBe('healthy');
    const s = signals(body);
    expect(s.map((o) => o.key).sort()).toEqual(['alert_tool_errors', 'billing_errors', 'daily_alert_pending']);
    for (const o of s) {
      expect(o.status).toBe('ok');
      expect(o.count).toBe(0);
    }
    expect(sent).toHaveLength(0);
  });

  it('pending daily-alert recipients after 15:00 UTC → exactly one ops alert, and a rerun does not resend', async () => {
    // b@x.com is due today, has targeting, and has no alert_log row.
    tables.alert_log = tables.alert_log.filter((r) => r.user_email !== 'b@x.com');

    const first = await run();
    const p1 = byKey(signals(first), 'daily_alert_pending');
    expect(p1.status).toBe('alert');
    expect(p1.count).toBe(1);
    expect(p1.action).toBe('alert');
    expect(p1.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain('Daily alerts pending');
    expect(kvStore.get(`launchsignal:daily_alert_pending:${TODAY}`)).toBe('alert');

    const second = await run();
    const p2 = byKey(signals(second), 'daily_alert_pending');
    expect(p2.status).toBe('alert');
    expect(p2.prev).toBe('alert');
    expect(p2.action).toBe('none');
    expect(p2.sent).toBe(false);
    expect(sent).toHaveLength(1); // dedup: still only the first alert
  });

  it('a failing pending query reports UNKNOWN with a null count — never 0, never ok', async () => {
    brokenTables.add('user_notification_settings');

    const body = await run();
    const p = byKey(signals(body), 'daily_alert_pending');
    expect(p.status).toBe('unknown');
    expect(p.count).toBeNull();
    expect(p.count).not.toBe(0);
    expect(p.status).not.toBe('ok');
    expect(p.action).toBe('unknown');
    expect(sent.some((m) => /UNKNOWN, not zero/.test(m.subject))).toBe(true);
    // The other two signals are unaffected.
    expect(byKey(signals(body), 'billing_errors').status).toBe('ok');
    expect(byKey(signals(body), 'alert_tool_errors').status).toBe('ok');
  });

  it('launch-signal failures never change the existing db-health response', async () => {
    const baseline = await run();
    sent.length = 0;
    kvStore.clear();

    // Every launch-signal source fails, and Slack throws too.
    brokenTables.add('user_notification_settings');
    brokenTables.add('mcp_call_log');
    brokenTables.add('tool_errors');
    sendThrows = true;

    const body = await run();
    expect(body.status).toBe(baseline.status);
    expect(body.status).toBe('healthy');
    expect(body.prev).toBe(baseline.prev);
    expect(body.transitioned).toBe(baseline.transitioned);
    expect(body.alerted).toBe(baseline.alerted);
    expect(body.probes.map((p) => [p.name, p.ok])).toEqual(baseline.probes.map((p) => [p.name, p.ok]));
    expect(typeof body.checkedAt).toBe('string');

    const s = signals(body);
    expect(s).toHaveLength(3);
    for (const o of s) {
      expect(o.status).toBe('unknown');
      expect(o.count).toBeNull();
      expect(o.sent).toBe(false);
    }
    // A failed announcement is not persisted, so it retries next hour.
    expect([...kvStore.keys()].some((k) => k.startsWith('launchsignal:'))).toBe(false);
  });

  it('slow probes leave too little of maxDuration → launch block is skipped, db-health still answers', async () => {
    seedHealthy();
    // slow-but-UP DB: both hard probes under the 8s "down" line (→ degraded), slow pg-stats → 27s used
    probeCostMs = 7_000;
    rpcCostMs = 13_000;
    const body = await run();
    expect(body.status).toBe('degraded');
    expect(body.launchSignals).toBe('skipped_no_time');
    // The only alert is the EXISTING healthy→degraded transition — no launch-signal alert ran.
    expect(body.alerted).toBe(true);
    expect(sent).toHaveLength(1);
    expect([...kvStore.keys()].some((k) => k.startsWith('launchsignal:'))).toBe(false);
  });

  it('hanging launch-signal queries are cut off at the remaining budget instead of outliving maxDuration', async () => {
    seedHealthy();
    probeCostMs = 7_000; // 7 + 7 + 9.5 = 23.5s used → 2.5s real budget for the launch block
    rpcCostMs = 9_500;
    hangingTables.add('user_notification_settings');
    hangingTables.add('mcp_call_log');
    hangingTables.add('tool_errors');
    const t0 = performance.now();
    const body = await run();
    const waited = performance.now() - t0;
    expect(waited).toBeLessThan(6_000);
    expect(body.status).toBe('degraded');
    expect(body.launchSignals).toEqual({ error: expect.stringMatching(/launch signals timed out/) });
  }, 15_000);
});
