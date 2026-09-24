/**
 * saved-search-alerts — the CANONICAL (watermark) Forecast engine end to end, through the REAL route handler.
 *
 * Supabase and sendEmail are recording fakes; agency_forecasts honours created_at + publisher floors
 * (fake-forecast-db.ts), so these prove alert decisions AND every state write without touching production
 * or sending email. Legacy-engine behaviour is pinned at the bottom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { applyForecastOps, type FakeForecastRow } from '@/lib/saved-searches/__fixtures__/fake-forecast-db';

type Row = Record<string, unknown>;
type Op = [string, unknown[]];
const state = {
  search: null as Row | null,
  open: [] as Row[],
  forecasts: [] as FakeForecastRow[],
  floors: [] as Row[],
  forecastError: null as { message: string } | null,
  snapshot: '2026-09-24T11:00:00.000Z' as string | null,
  rpcCalls: 0,
  selects: [] as string[],
  updates: [] as Array<{ id: unknown; payload: Row }>,
  forecastQueries: [] as Op[][],
  sends: [] as Array<{ to: string; subject: string; html: string; text: string }>,
};

function builder(table: string) {
  const ops: Op[] = [];
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
    if (table === 'saved_searches') state.selects.push(String(a[0]));
    if ((a[1] as { head?: boolean } | undefined)?.head) mode = 'count';
    return proxy;
  };
  b.update = (p: Row) => { mode = 'update'; payload = p; return proxy; };
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    if (table === 'saved_searches') {
      if (mode === 'update') {
        state.updates.push({ id: ops.find((o) => o[0] === 'eq' && o[1][0] === 'id')?.[1][1], payload });
        return Promise.resolve({ error: null }).then(resolve, reject);
      }
      if (mode === 'count') return Promise.resolve({ count: 0, error: null }).then(resolve, reject);
      const excluded = ops.some((o) => o[0] === 'not' && o[1][0] === 'id');
      return Promise.resolve({ data: excluded || !state.search ? [] : [state.search], error: null }).then(resolve, reject);
    }
    if (table === 'sam_opportunities') return Promise.resolve({ data: state.open, error: null }).then(resolve, reject);
    if (table === 'forecast_publisher_alert_floor') return Promise.resolve({ data: state.floors, error: null }).then(resolve, reject);
    if (table === 'agency_forecasts') {
      state.forecastQueries.push(ops);
      if (state.forecastError) return Promise.resolve({ data: null, error: state.forecastError }).then(resolve, reject);
      const legacy = !ops.some((o) => o[0] === 'gt' && o[1][0] === 'created_at');
      return Promise.resolve({ data: legacy ? state.forecasts : applyForecastOps(state.forecasts, ops), error: null }).then(resolve, reject);
    }
    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
  };
  return proxy;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (fn: string) => {
      state.rpcCalls++;
      if (fn !== 'saved_search_forecast_snapshot') return { data: null, error: { message: 'unknown rpc' } };
      return state.snapshot ? { data: state.snapshot, error: null } : { data: null, error: { message: 'rpc down' } };
    },
  }),
}));
vi.mock('@/lib/cron-self-report', () => ({ reportCronOutcome: vi.fn(async () => {}) }));
vi.mock('@/lib/send-email', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; html: string; text: string }) => { state.sends.push(m); return true; }),
}));

const { GET } = await import('./route');

let seq = 0;
const fc = (src: string, created: string, extra: Partial<FakeForecastRow> = {}): FakeForecastRow =>
  ({ id: `f${++seq}`, external_id: `${src}-${seq}`, source_agency: src, created_at: created, last_synced_at: '2026-09-23T13:00:38.208Z', title: `Forecast ${seq}`, fiscal_year: 'FY2026', ...extra });
const W = '2026-09-23T11:00:00.000Z';
const search = (filters: Row, extra: Row = {}): Row => ({
  id: 'ss-1', user_email: 'owner@example.com', name: 'My market', mode: 'open', filters,
  alert_frequency: 'daily', last_seen_notice_ids: ['OPEN-OLD'], total_alerts_sent: 3, last_alerted_at: W,
  forecast_seen_through: W, forecast_gap_since: null, ...extra,
});
const run = async (qs = '') => {
  const res = await GET(new NextRequest(`http://localhost/api/cron/saved-search-alerts${qs}`));
  return { status: res.status, body: await res.json() };
};
const FC = { naics: '541512', horizons: { forecast: true } };

beforeEach(() => {
  Object.assign(state, {
    search: null, open: [], forecasts: [], forecastError: null, snapshot: '2026-09-24T11:00:00.000Z', rpcCalls: 0,
    selects: [], updates: [], forecastQueries: [], sends: [],
    floors: ['DOE', 'DHS', 'VA', 'HHS'].map((s) => ({ source_agency: s, state: 'active', alertable_after: '2026-09-01T00:00:00.000Z' })),
  });
  process.env.SAVED_SEARCH_FORECAST_CANONICAL = 'true';
});
afterEach(() => { delete process.env.SAVED_SEARCH_FORECAST_CANONICAL; });

describe('canonical (watermark) Forecast engine — alert decisions and state', () => {
  it('reads the watermark columns and one DB snapshot per evaluation', async () => {
    state.search = search(FC);
    await run();
    expect(state.selects[0]).toContain('forecast_seen_through, forecast_gap_since');
    expect(state.rpcCalls).toBe(1);
  });

  it('historical forecast (created before the watermark) → no alert; watermark advances; Open seen untouched', async () => {
    state.search = search(FC); state.forecasts = [fc('DOE', '2026-08-01T12:00:00Z', { last_synced_at: '2026-09-23T13:00:38Z' })];
    const { body } = await run();
    expect(state.sends).toHaveLength(0);
    expect(body.forecastCoverage).toEqual({ covered: 1 });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].payload).toMatchObject({ forecast_seen_through: '2026-09-24T11:00:00.000Z', forecast_gap_since: null });
    expect(state.updates[0].payload.last_seen_notice_ids).toBeUndefined();
  });

  it('new forecast → one email; next run with the advanced watermark → not again', async () => {
    const x = fc('DHS', '2026-09-23T20:00:00Z');
    state.search = search(FC); state.forecasts = [fc('DOE', '2026-08-01T00:00:00Z'), x];
    const first = await run();
    expect(first.body.sent).toBe(1);
    expect(state.sends[0].subject).toBe('1 new match in “My market”');
    const p = state.updates[0].payload;
    expect(p.forecast_seen_through).toBe('2026-09-24T11:00:00.000Z');
    expect(p.total_alerts_sent).toBe(4);
    // Forecast ids NEVER enter the Open seen list.
    expect(p.last_seen_notice_ids).toBeUndefined();

    state.search = search(FC, { forecast_seen_through: p.forecast_seen_through, last_alerted_at: '2026-09-24T11:00:00Z' });
    state.snapshot = '2026-09-25T11:00:00.000Z';
    state.forecasts = state.forecasts.map((r) => ({ ...r, last_synced_at: '2026-09-24T13:00:00Z' })); // daily re-sync
    state.updates = [];
    const second = await run();
    expect(second.body.sent).toBe(0);
    expect(state.sends).toHaveLength(1);
  });

  it('Open + Forecast both new → one email; the Open seen list gains ONLY Open ids (no eviction by Forecast)', async () => {
    state.search = search(FC);
    state.open = [{ notice_id: 'OPEN-OLD', title: 'o' }, { notice_id: 'OPEN-NEW', title: 'n' }];
    state.forecasts = [fc('DHS', '2026-09-24T01:00:00Z')];
    await run();
    expect(state.sends[0].subject).toBe('2 new matches in “My market”');
    expect(state.updates[0].payload.last_seen_notice_ids).toEqual(['OPEN-OLD', 'OPEN-NEW']);
  });

  it('amended old forecast (fields changed, created_at unchanged) → not new', async () => {
    state.search = search(FC); state.forecasts = [fc('DHS', '2026-09-10T00:00:00Z', { title: 'AMENDED', last_synced_at: '2026-09-24T09:00:00Z' })];
    await run();
    expect(state.sends).toHaveLength(0);
  });

  it('covered zero → no alert, watermark advances', async () => {
    state.search = search({ agency: 'VETERANS AFFAIRS', horizons: { forecast: true } });
    await run();
    expect(state.sends).toHaveLength(0);
    expect(state.updates[0].payload.forecast_seen_through).toBe('2026-09-24T11:00:00.000Z');
  });

  it('unavailable → no forecast query, watermark untouched; with new Open the email carries the notice', async () => {
    state.search = search({ agency: 'HUD', horizons: { forecast: true } });
    state.open = [{ notice_id: 'OPEN-NEW', title: 'HUD janitorial', department: 'HOUSING AND URBAN DEVELOPMENT' }];
    state.forecasts = [fc('DHS', '2026-09-24T01:00:00Z')];
    const { body } = await run();
    expect(state.forecastQueries).toHaveLength(0);
    expect(body.forecastCoverage).toEqual({ unavailable: 1 });
    expect(state.sends[0].html).toContain('Upcoming (forecast) buys: not available for HUD');
    const p = state.updates[0].payload;
    expect('forecast_seen_through' in p).toBe(false);
    expect(p.last_seen_notice_ids).toEqual(['OPEN-NEW', 'OPEN-OLD']);
  });

  it('partial → covered rows alert with the warning; the uncovered buyer keeps its catch-up boundary', async () => {
    state.search = search({ agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } });
    state.forecasts = [fc('VA', '2026-09-24T02:00:00Z')];
    const { body } = await run();
    expect(body.forecastCoverage).toEqual({ partial: 1 });
    expect(state.sends[0].html).toContain('Not measured: COMMERCE');
    expect(state.updates[0].payload).toMatchObject({ forecast_seen_through: '2026-09-24T11:00:00.000Z', forecast_gap_since: { COMMERCE: W } });
  });

  it('forecast query failure → failure class, NO state write, NO send', async () => {
    state.search = search(FC); state.open = [{ notice_id: 'OPEN-NEW', title: 'x' }];
    state.forecastError = { message: 'canceling statement due to statement timeout' };
    const { status, body } = await run();
    expect(body.failuresByClass).toEqual({ forecast_query_failed: 1 });
    expect(state.updates).toHaveLength(0); expect(state.sends).toHaveLength(0); expect(status).toBe(500);
  });

  it('snapshot unavailable → failure, NO state write', async () => {
    state.search = search(FC); state.snapshot = null;
    const { body } = await run();
    expect(body.failuresByClass).toEqual({ forecast_query_failed: 1 });
    expect(state.updates).toHaveLength(0);
  });

  it('NULL watermark (new search / missed migration) → silent baseline: existing forecasts are not new', async () => {
    state.search = search({ agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } }, { forecast_seen_through: null });
    state.forecasts = [fc('VA', '2026-09-24T02:00:00Z')];
    const { body } = await run();
    expect(state.sends).toHaveLength(0);
    expect(state.forecastQueries).toHaveLength(0);
    expect(body.forecastCoverage).toEqual({ baseline: 1 });
    expect(state.updates[0].payload).toMatchObject({ forecast_seen_through: '2026-09-24T11:00:00.000Z', forecast_gap_since: { COMMERCE: '2026-09-24T11:00:00.000Z' } });
  });

  it('brand-new search (never alerted, nothing seen) → Open AND Forecast baseline, no email', async () => {
    state.search = search(FC, { forecast_seen_through: null, last_alerted_at: null, last_seen_notice_ids: [] });
    state.open = [{ notice_id: 'OPEN-1', title: 'x' }];
    state.forecasts = [fc('DHS', '2026-09-24T02:00:00Z')];
    await run();
    expect(state.sends).toHaveLength(0);
    expect(state.updates[0].payload).toMatchObject({ last_seen_notice_ids: ['OPEN-1'], forecast_seen_through: '2026-09-24T11:00:00.000Z' });
  });

  it('a send failure writes nothing — neither the watermark nor Open state', async () => {
    const { sendEmail } = await import('@/lib/send-email');
    vi.mocked(sendEmail).mockResolvedValueOnce(false);
    state.search = search(FC); state.forecasts = [fc('DHS', '2026-09-24T02:00:00Z')];
    const { body } = await run();
    expect(body.failuresByClass).toEqual({ email_send_rejected: 1 });
    expect(state.updates).toHaveLength(0);
  });

  it('read-only preview with the flag OFF: counts + watermark before/after, no writes, no sends', async () => {
    delete process.env.SAVED_SEARCH_FORECAST_CANONICAL;
    state.search = search(FC); state.forecasts = [fc('DHS', '2026-09-24T02:00:00Z'), fc('DOE', '2026-08-01T00:00:00Z')];
    const { body } = await run('?mode=preview&forecastEngine=canonical');
    expect(body.forecastEngine).toBe('canonical');
    expect(body.preview[0]).toMatchObject({ forecastNewCount: 1, openNewCount: 0, forecastWatermarkBefore: W, forecastWatermarkAfter: '2026-09-24T11:00:00.000Z' });
    expect(state.updates).toHaveLength(0); expect(state.sends).toHaveLength(0);
  });
});

describe('legacy engine stays the default and is unchanged', () => {
  it('flag unset → no snapshot rpc, no watermark columns selected, no watermark written, no notice', async () => {
    delete process.env.SAVED_SEARCH_FORECAST_CANONICAL;
    state.search = search({ agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } });
    state.forecasts = [fc('VA', '2026-09-24T02:00:00Z')];
    const { body } = await run();
    expect(body.forecastEngine).toBe('legacy');
    expect(state.rpcCalls).toBe(0);
    expect(state.selects[0]).not.toContain('forecast_seen_through');
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].html).not.toContain('Upcoming (forecast) buys');
    expect(state.updates[0].payload.forecast_seen_through).toBeUndefined();
    expect(state.updates[0].payload.last_seen_notice_ids).toEqual([state.forecasts[0].external_id, 'OPEN-OLD']);
  });

  it('a non-"true" flag value stays legacy; a mutating run ignores ?forecastEngine=canonical', async () => {
    process.env.SAVED_SEARCH_FORECAST_CANONICAL = '1';
    state.search = search(FC);
    expect((await run('?forecastEngine=canonical')).body.forecastEngine).toBe('legacy');
  });

  it('legacy failure also writes no state', async () => {
    delete process.env.SAVED_SEARCH_FORECAST_CANONICAL;
    state.search = search(FC); state.forecastError = { message: 'boom' };
    expect((await run()).body.failuresByClass).toEqual({ forecast_query_failed: 1 });
    expect(state.updates).toHaveLength(0);
  });
});
