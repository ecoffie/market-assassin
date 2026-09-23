/**
 * saved-search-alerts — the Forecast engine end to end, through the REAL route handler.
 *
 * Supabase and sendEmail are replaced by in-memory fakes that record every write and every send, so
 * these prove the alert decision and state mutation without touching production or sending email:
 *   previously-seen → no duplicate · new → once · repeat → not again · amended → not new ·
 *   covered zero → no false alert · unavailable → no measurement, no zero · partial → warning carried ·
 *   failure → unknown, and NO state is written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = [string, unknown[]];
const state = {
  search: null as Row | null,
  open: [] as Row[],
  forecasts: [] as Row[],
  forecastError: null as { message: string } | null,
  updates: [] as Array<{ id: unknown; payload: Row }>,
  forecastQueries: [] as Op[][],
  sends: [] as Array<{ to: string; subject: string; html: string; text: string }>,
};

function builder(table: string) {
  const ops: Op[] = [];
  let mode: 'select' | 'update' | 'count' = 'select';
  let payload: Row = {};
  const b: Record<string, unknown> = {};
  // Any PostgREST chain method (applyMapFilters uses many) records itself and returns the builder.
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
    try {
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
      if (table === 'agency_forecasts') {
        state.forecastQueries.push(ops);
        return Promise.resolve(state.forecastError ? { data: null, error: state.forecastError } : { data: state.forecasts, error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    } catch (e) { return Promise.reject(e).then(resolve, reject); }
  };
  return proxy;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/cron-self-report', () => ({ reportCronOutcome: vi.fn(async () => {}) }));
vi.mock('@/lib/send-email', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; html: string; text: string }) => { state.sends.push(m); return true; }),
}));

const { GET } = await import('./route');

const fc = (id: string, extra: Row = {}) => ({ external_id: id, title: `Forecast ${id}`, source_agency: 'VA', fiscal_year: 'FY2026', last_synced_at: '2026-09-23T00:00:00Z', ...extra });
const search = (filters: Row, extra: Row = {}): Row => ({
  id: 'ss-1', user_email: 'owner@example.com', name: 'My market', mode: 'open', filters,
  alert_frequency: 'daily', last_seen_notice_ids: ['F-OLD'], total_alerts_sent: 3, last_alerted_at: '2026-09-22T11:00:00Z', ...extra,
});
const run = async (qs = '') => {
  const res = await GET(new NextRequest(`http://localhost/api/cron/saved-search-alerts${qs}`));
  return { status: res.status, body: await res.json() };
};
const fyClause = (ops: Op[]) => ops.some((o) => o[0] === 'or' && String(o[1][0]).startsWith('fiscal_year.is.null,'));

beforeEach(() => {
  state.search = null; state.open = []; state.forecasts = []; state.forecastError = null;
  state.updates = []; state.forecastQueries = []; state.sends = [];
  process.env.SAVED_SEARCH_FORECAST_CANONICAL = 'true';
});
afterEach(() => { delete process.env.SAVED_SEARCH_FORECAST_CANONICAL; });

const FC = { naics: '541512', horizons: { forecast: true } };

describe('canonical Forecast engine — alert decision and state', () => {
  it('1 · previously-seen forecast → no duplicate alert; only last_alerted_at moves', async () => {
    state.search = search(FC); state.forecasts = [fc('F-OLD')];
    const { body } = await run();
    expect(body.forecastEngine).toBe('canonical');
    expect(state.sends).toHaveLength(0);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].payload.last_seen_notice_ids).toBeUndefined();
    expect(body.noMatches).toBe(1);
    expect(fyClause(state.forecastQueries[0])).toBe(true); // canonical plan ran (FY policy present)
  });

  it('2+3 · truly new forecast → alert exactly once; the same forecast next run → not again', async () => {
    state.search = search(FC); state.forecasts = [fc('F-OLD'), fc('F-NEW')];
    const first = await run();
    expect(first.body.sent).toBe(1);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].subject).toBe('1 new match in “My market”');
    const seen = state.updates[0].payload.last_seen_notice_ids as string[];
    expect(seen).toEqual(['F-OLD', 'F-NEW']);
    expect(state.updates[0].payload.total_alerts_sent).toBe(4);

    state.search = search(FC, { last_seen_notice_ids: seen, total_alerts_sent: 4, last_alerted_at: '2026-09-23T11:00:00Z' });
    state.updates = [];
    const second = await run();
    expect(second.body.sent).toBe(0);
    expect(state.sends).toHaveLength(1);
    expect(state.updates[0].payload.last_seen_notice_ids).toBeUndefined();
  });

  it('4 · updated/amended forecast (same external_id) → not new — no new notification rule invented', async () => {
    state.search = search(FC); state.forecasts = [fc('F-OLD', { title: 'AMENDED', anticipated_quarter: 'Q4', set_aside_type: 'SDVOSB' })];
    await run();
    expect(state.sends).toHaveLength(0);
  });

  it('5 · covered zero → no alert, counted as covered (a real measured zero)', async () => {
    state.search = search({ agency: 'VETERANS AFFAIRS', q: 'zzzxxyyqqq', horizons: { forecast: true } });
    const { body } = await run();
    expect(state.sends).toHaveLength(0);
    expect(body.noMatches).toBe(1);
    expect(body.forecastCoverage).toEqual({ covered: 1 });
    expect(state.forecastQueries).toHaveLength(1);
  });

  it('6 · unavailable publisher → no forecast query, no zero, no alert of its own; counted as unavailable', async () => {
    state.search = search({ agency: 'HUD', horizons: { forecast: true } });
    state.forecasts = [fc('SHOULD-NEVER-BE-READ')];
    const { body } = await run();
    expect(state.forecastQueries).toHaveLength(0);
    expect(state.sends).toHaveLength(0);
    expect(body.forecastCoverage).toEqual({ unavailable: 1 });
    expect(state.updates[0].payload.last_seen_notice_ids).toBeUndefined();
  });

  it('6b · unavailable + a new Open match → the alert carries the unavailable notice, never a zero', async () => {
    state.search = search({ agency: 'HUD', horizons: { forecast: true } });
    state.open = [{ notice_id: 'OPEN-1', title: 'HUD janitorial', department: 'HOUSING AND URBAN DEVELOPMENT' }];
    await run();
    expect(state.sends).toHaveLength(1);
    const { html, text, subject } = state.sends[0];
    expect(subject).toBe('1 new match in “My market”');
    expect(html).toContain('Upcoming (forecast) buys: not available for HUD');
    expect(text).toContain('This is not a zero.');
    expect(html).not.toMatch(/0 (upcoming|forecast)/i);
  });

  it('7 · partial → alert from covered buyers only, carrying the partial-coverage warning naming COMMERCE', async () => {
    state.search = search({ agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } });
    state.forecasts = [fc('F-OLD'), fc('F-VA-NEW')];
    const { body } = await run();
    expect(body.forecastCoverage).toEqual({ partial: 1 });
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].html).toContain('partial coverage');
    expect(state.sends[0].html).toContain('Not measured: COMMERCE');
    const agencyOp = state.forecastQueries[0].find((o) => o[0] === 'or' && String(o[1][0]).includes('source_agency'));
    expect(String(agencyOp?.[1][0])).toContain('source_agency.in.(VA)');
    expect(String(agencyOp?.[1][0])).not.toMatch(/COMMERCE/i);
  });

  it('8 · forecast query failure → failure class, NO state write, NO send, run reports error', async () => {
    state.search = search(FC);
    state.open = [{ notice_id: 'OPEN-1', title: 'x' }];
    state.forecastError = { message: 'canceling statement due to statement timeout' };
    const { status, body } = await run();
    expect(body.failuresByClass).toEqual({ forecast_query_failed: 1 });
    expect(body.noMatches).toBe(0);
    expect(state.updates).toHaveLength(0);
    expect(state.sends).toHaveLength(0);
    expect(status).toBe(500);
  });

  it('first run under partial coverage → baseline the measured ids, no email', async () => {
    state.search = search({ agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } }, { last_seen_notice_ids: [], last_alerted_at: null });
    state.forecasts = [fc('F1'), fc('F2')];
    await run();
    expect(state.sends).toHaveLength(0);
    expect(state.updates[0].payload.last_seen_notice_ids).toEqual(['F1', 'F2']);
  });

  it('read-only preview can inspect the canonical engine with the flag OFF — no writes, no sends', async () => {
    delete process.env.SAVED_SEARCH_FORECAST_CANONICAL;
    state.search = search({ agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } });
    state.forecasts = [fc('F-NEW')];
    const { body } = await run('?mode=preview&forecastEngine=canonical');
    expect(body.forecastEngine).toBe('canonical');
    expect(body.preview[0]).toMatchObject({ newCount: 1, forecastEngine: 'canonical', forecastCoverage: 'partial' });
    expect(body.preview[0].coverageNotices[0]).toContain('Not measured: COMMERCE');
    expect(state.updates).toHaveLength(0);
    expect(state.sends).toHaveLength(0);
  });
});

describe('legacy engine stays the default and is unchanged', () => {
  it('flag unset → legacy query (no canonical FY clause), no coverage notice in the email', async () => {
    delete process.env.SAVED_SEARCH_FORECAST_CANONICAL;
    state.search = search({ agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } });
    state.forecasts = [fc('F-OLD'), fc('F-NEW')];
    const { body } = await run();
    expect(body.forecastEngine).toBe('legacy');
    expect(body.forecastCoverage).toEqual({});
    expect(fyClause(state.forecastQueries[0])).toBe(false);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].html).not.toContain('Upcoming (forecast) buys');
  });

  it('flag unset + a non-"true" value ("1") stays legacy; a mutating run ignores ?forecastEngine=canonical', async () => {
    process.env.SAVED_SEARCH_FORECAST_CANONICAL = '1';
    state.search = search(FC); state.forecasts = [fc('F-OLD')];
    expect((await run('?forecastEngine=canonical')).body.forecastEngine).toBe('legacy');
  });

  it('legacy failure also writes no state', async () => {
    delete process.env.SAVED_SEARCH_FORECAST_CANONICAL;
    state.search = search(FC); state.forecastError = { message: 'boom' };
    const { body } = await run();
    expect(body.failuresByClass).toEqual({ forecast_query_failed: 1 });
    expect(state.updates).toHaveLength(0);
  });
});
