/**
 * Recompete compute-once rollout (Gate 2 · shadow → canary → authority) — the safety properties.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeOnceConfig, decide, forcedFromHeaders } from './compute-once-mode';
import { computeOnceDbUrl } from './compute-once-pg';
import { mapsRecompeteRequest } from './maps-recompete-discovery';
import { compareReads, buildRecompeteMapBody, type MarketRead } from './recompete-map-paths';

const R = (x: number) => ({ serve: x, compare: x });

describe('mode control', () => {
  it('defaults to OFF, and OFF is absolute — even a forced request cannot run compute-once', () => {
    const cfg = computeOnceConfig({});
    expect(cfg.mode).toBe('off');
    for (const f of ['new', 'shadow', 'old', null] as const) expect(decide(cfg, R(0), f)).toEqual({ serve: 'old', compare: false });
    expect(computeOnceConfig({ RECOMPETE_COMPUTE_ONCE_MODE: 'bogus' }).mode).toBe('off');
  });
  it('SHADOW never serves the new path — it only samples a background comparison', () => {
    const cfg = computeOnceConfig({ RECOMPETE_COMPUTE_ONCE_MODE: 'shadow', RECOMPETE_COMPUTE_ONCE_SHADOW: '0.25' });
    expect(decide(cfg, R(0.1))).toEqual({ serve: 'old', compare: true });
    expect(decide(cfg, R(0.9))).toEqual({ serve: 'old', compare: false });
    expect(decide(cfg, R(0.9), 'new')).toEqual({ serve: 'old', compare: true });   // forced "new" still does not SERVE new in shadow
  });
  it('CANARY serves new for canaryPct of requests and verifies them against old', () => {
    const cfg = computeOnceConfig({ RECOMPETE_COMPUTE_ONCE_MODE: 'canary', RECOMPETE_COMPUTE_ONCE_CANARY_PCT: '10' });
    expect(decide(cfg, R(0.05))).toEqual({ serve: 'new', compare: true });
    expect(decide(cfg, { serve: 0.5, compare: 0.5 }).serve).toBe('old');
    expect(decide(cfg, R(0.99), 'new').serve).toBe('new');
    expect(decide(cfg, R(0.0), 'old').serve).toBe('old');
  });
  it('AUTHORITY serves new by default; verification is sampled', () => {
    const cfg = computeOnceConfig({ RECOMPETE_COMPUTE_ONCE_MODE: 'authority' });
    expect(cfg.verifySample).toBe(0.1);
    expect(decide(cfg, R(0.5))).toEqual({ serve: 'new', compare: false });
    expect(decide(cfg, R(0.05))).toEqual({ serve: 'new', compare: true });
  });
  it('a forced path needs the operator token — a client cannot choose its own path', () => {
    const h = (m: Record<string, string>) => (k: string) => m[k] ?? null;
    expect(forcedFromHeaders(h({ 'x-recompete-force': 'new' }), 'sekret')).toBeNull();
    expect(forcedFromHeaders(h({ 'x-recompete-force': 'new', 'x-recompete-verify': 'wrong!' }), 'sekret')).toBeNull();
    expect(forcedFromHeaders(h({ 'x-recompete-force': 'new', 'x-recompete-verify': 'sekret' }), 'sekret')).toBe('new');
    expect(forcedFromHeaders(h({ 'x-recompete-force': 'new', 'x-recompete-verify': 'sekret' }), undefined)).toBeNull();
    expect(forcedFromHeaders(h({ 'x-recompete-force': 'drop table', 'x-recompete-verify': 'sekret' }), 'sekret')).toBeNull();
  });
});

describe('connection target', () => {
  it('uses the Supabase TRANSACTION pooler and refuses anything that is not a pooler host', () => {
    expect(computeOnceDbUrl({ DATABASE_URL: 'postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:5432/postgres' }))
      .toBe('postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:6543/postgres');
    expect(computeOnceDbUrl({ DATABASE_URL: 'postgresql://u:p@db.x.supabase.co:5432/postgres' })).toBeNull();
    expect(computeOnceDbUrl({})).toBeNull();
    expect(computeOnceDbUrl({ RECOMPETE_PG_URL: 'postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres', DATABASE_URL: 'x' }))
      .toBe('postgresql://u:p@aws-0-x.pooler.supabase.com:6543/postgres');
  });
});

describe('fail CLOSED on an unrecognized plan operation', () => {
  it('throws before any I/O — the route then serves the PostgREST path, never a result missing a filter', async () => {
    const req = mapsRecompeteRequest((k) => (k === 'q' ? 'janitorial' : null));
    (req.plan.horizons.recompete.ops as unknown[]).push({ op: 'contains', col: 'naics_code', val: 'x' });
    // The REAL executor (the rest of this file stubs it).
    const { runComputeOnce } = await vi.importActual<typeof import('./compute-once-pg')>('./compute-once-pg');
    await expect(runComputeOnce(req, { bbox: { west: -1, south: -1, east: 1, north: 1 }, cap: 10, pinCols: 'contract_id' }))
      .rejects.toThrow(/unsupported op/);
  });
});

describe('comparison + the one response builder', () => {
  const req = mapsRecompeteRequest((k) => (k === 'naics' ? '541512' : null));
  const row = (id: string, end = '2026-10-01') => ({ contract_id: id, period_of_performance_current_end: end, piid: id, map_lat: 38, map_lng: -77 });
  const base: MarketRead = { total: 3, unmapped: 1, inView: 2, pins: [row('A'), row('B')], followOns: [row('F', '2030-01-01')], ms: 5 };
  it('identical reads compare clean and build byte-identical bodies', () => {
    expect(compareReads(req, base, { ...base, ms: 999 })).toEqual([]);
    expect(JSON.stringify(buildRecompeteMapBody(req, base))).toBe(JSON.stringify(buildRecompeteMapBody(req, { ...base, ms: 1 })));
  });
  it('names every field that differs', () => {
    expect(compareReads(req, base, { ...base, total: 4 })).toEqual(expect.arrayContaining(['market_total', 'mapped_total', 'response_body']));
    expect(compareReads(req, base, { ...base, unmapped: 2 })).toEqual(expect.arrayContaining(['market_total', 'unmapped_total']));
    expect(compareReads(req, base, { ...base, inView: 3 })).toEqual(expect.arrayContaining(['in_view_total', 'response_body']));
    expect(compareReads(req, base, { ...base, pins: [row('B'), row('A')] })).toEqual(expect.arrayContaining(['pin_ids', 'pin_payload']));
    expect(compareReads(req, base, { ...base, pins: [row('A'), { ...row('B'), piid: 'X' }] })).toEqual(['pin_payload', 'response_body']);
    expect(compareReads(req, base, { ...base, followOns: [] })).toEqual(expect.arrayContaining(['follow_on_ids', 'response_body']));
  });
  it('a failed count is UNKNOWN on both paths — never rendered as 0 unmapped', () => {
    expect(buildRecompeteMapBody(req, { ...base, unmapped: null }).unmappedForFilters).toBeNull();
  });
});

// ── The route in every mode (PostgREST + pg stubbed; after() executed inline) ─────────────────────
const afterTasks: Array<() => Promise<void>> = [];
vi.mock('next/server', async (orig) => {
  const m = await orig<typeof import('next/server')>();
  return { ...m, after: (fn: () => Promise<void>) => { afterTasks.push(fn); } };
});
const logged: Array<Record<string, unknown>> = [];
class Q {
  constructor(private table: string) {}
  private head = false; private insertRow: unknown = null;
  select(_c?: string, o?: { head?: boolean }) { this.head = !!o?.head; return this; }
  insert(r: unknown) { this.insertRow = r; logged.push(r as Record<string, unknown>); return this; }
  eq() { return this; } in() { return this; } not() { return this; } is() { return this; } or() { return this; }
  gte() { return this; } lte() { return this; } ilike() { return this; } order() { return this; } limit() { return this; } range() { return this; }
  then(res: (v: unknown) => unknown) {
    if (this.insertRow) return Promise.resolve({ error: null }).then(res);
    if (this.head) return Promise.resolve({ count: 7, error: null }).then(res);
    return Promise.resolve({ data: [{ contract_id: 'OLD1', period_of_performance_current_end: '2026-10-01', map_lat: 38, map_lng: -77 }], count: 1, error: null }).then(res);
  }
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => new Q(t) }) }));
const pgMock = vi.fn();
vi.mock('./compute-once-pg', async (orig) => ({ ...(await orig<typeof import('./compute-once-pg')>()), runComputeOnce: (...a: unknown[]) => pgMock(...a) }));

async function call(env: Record<string, string>, headers: Record<string, string> = {}) {
  vi.resetModules();
  for (const k of Object.keys(process.env)) if (k.startsWith('RECOMPETE_COMPUTE_ONCE')) delete process.env[k];
  Object.assign(process.env, env, { CRON_SECRET: 'op-token' });
  const { GET } = await import('@/app/api/app/recompete-map/route');
  const { NextRequest } = await import('next/server');
  const res = await GET(new NextRequest('https://getmindy.ai/api/app/recompete-map?bbox=-80,30,-70,40&naics=541512', { headers }));
  for (const t of afterTasks.splice(0)) await t();
  return { res, body: await res.json() };
}
const ROW = { contract_id: 'OLD1', period_of_performance_current_end: '2026-10-01', map_lat: 38, map_lng: -77 };
// What the stubbed PostgREST path reads: counts 7/7, one pin in view, and that row also comes back as a follow-on.
const NEW_READ = { total: 7, unmapped: 7, inView: 1, pins: [ROW], followOns: [ROW], ms: 3 };

describe('recompete-map route — every rollout mode', () => {
  beforeEach(() => { logged.length = 0; pgMock.mockReset(); });

  it('OFF (default): only the PostgREST path runs, nothing is logged, even when forced', async () => {
    const { res } = await call({}, { 'x-recompete-force': 'new', 'x-recompete-verify': 'op-token' });
    expect(res.headers.get('x-recompete-path')).toBe('old');
    expect(pgMock).not.toHaveBeenCalled();
    expect(logged).toEqual([]);
  });
  it('SHADOW: the user gets the old path; compute-once runs after and the comparison is logged', async () => {
    pgMock.mockResolvedValue(NEW_READ);
    const { res } = await call({ RECOMPETE_COMPUTE_ONCE_MODE: 'shadow', RECOMPETE_COMPUTE_ONCE_SHADOW: '1' });
    expect(res.headers.get('x-recompete-path')).toBe('old');
    expect(pgMock).toHaveBeenCalledTimes(1);
    expect(logged[0]).toMatchObject({ mode: 'shadow', served: 'old', compared: true, outcome: 'identical' });
  });
  it('CANARY: a compute-once failure falls back to the old path for THIS request, with the same body', async () => {
    pgMock.mockRejectedValue(new Error('pooler timeout'));
    const off = await call({});
    const { res, body } = await call({ RECOMPETE_COMPUTE_ONCE_MODE: 'canary', RECOMPETE_COMPUTE_ONCE_CANARY_PCT: '100' });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-recompete-path')).toBe('fallback');
    expect(JSON.stringify(body)).toBe(JSON.stringify(off.body));
    expect(logged.at(-1)).toMatchObject({ served: 'fallback', outcome: 'new_error', error: 'pooler timeout' });
  });
  it('CANARY: a saturated pool is NOT queued behind — the old path serves at once and it is logged as busy', async () => {
    const busy = Object.assign(new Error('compute-once: pool busy'), { name: 'ComputeOnceBusy' });
    pgMock.mockRejectedValue(busy);
    const off = await call({});
    const { res, body } = await call({ RECOMPETE_COMPUTE_ONCE_MODE: 'canary', RECOMPETE_COMPUTE_ONCE_CANARY_PCT: '100' });
    expect(res.headers.get('x-recompete-path')).toBe('fallback');
    expect(JSON.stringify(body)).toBe(JSON.stringify(off.body));
    expect(logged.at(-1)).toMatchObject({ served: 'fallback', outcome: 'new_busy' });
  });
  it('SHADOW: a saturated pool SKIPS the comparison — never recorded as a compute-once error', async () => {
    pgMock.mockRejectedValue(Object.assign(new Error('compute-once: pool busy'), { name: 'ComputeOnceBusy' }));
    const { res } = await call({ RECOMPETE_COMPUTE_ONCE_MODE: 'shadow', RECOMPETE_COMPUTE_ONCE_SHADOW: '1' });
    expect(res.headers.get('x-recompete-path')).toBe('old');
    expect(logged.at(-1)).toMatchObject({ served: 'old', compared: false, outcome: 'skipped_busy' });
  });
  it('AUTHORITY: compute-once serves; a sampled verification against the old path is logged', async () => {
    pgMock.mockResolvedValue(NEW_READ);
    const { res, body } = await call({ RECOMPETE_COMPUTE_ONCE_MODE: 'authority', RECOMPETE_COMPUTE_ONCE_VERIFY: '1' });
    expect(res.headers.get('x-recompete-path')).toBe('new');
    expect(body.totalForFilters).toBe(7);
    expect(logged[0]).toMatchObject({ mode: 'authority', served: 'new', compared: true });
  });
  it('a real mismatch is re-read on both sides before it is recorded', async () => {
    pgMock.mockResolvedValue({ ...NEW_READ, total: 99 });
    await call({ RECOMPETE_COMPUTE_ONCE_MODE: 'shadow', RECOMPETE_COMPUTE_ONCE_SHADOW: '1' });
    expect(pgMock).toHaveBeenCalledTimes(2);                           // first comparison + the re-read
    expect(logged[0]).toMatchObject({ outcome: 'mismatch' });
    expect(logged[0].mismatch_fields).toEqual(expect.arrayContaining(['mapped_total']));
  });
  it('a difference that disappears on re-read is CHURN, not a mismatch', async () => {
    pgMock.mockResolvedValueOnce({ ...NEW_READ, total: 99 }).mockResolvedValueOnce(NEW_READ);
    await call({ RECOMPETE_COMPUTE_ONCE_MODE: 'shadow', RECOMPETE_COMPUTE_ONCE_SHADOW: '1' });
    expect(logged[0]).toMatchObject({ outcome: 'churn' });
  });
});
