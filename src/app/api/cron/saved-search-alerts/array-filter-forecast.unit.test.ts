/**
 * REGRESSION 2026-10-19 + 2026-10-26: saved search bcfb5381 ("TCL courier & local trucking — GA weekly")
 * stores its NAICS as a JSON ARRAY with the Forecast horizon on:
 *   { naics: ['492110','492210','484220'], state: 'GA', horizons: { open: true, forecast: true } }
 * The legacy Forecast half passed that array to applyForecastFilters, whose `(naics || '').trim()` threw
 * "trim is not a function". The throw was caught as forecast_query_failed, so the WHOLE search (both its Open
 * and Forecast halves) was dropped and never stamped. It failed on every due Monday since it was created.
 *
 * Proven here through the REAL route handler. Supabase and sendEmail are recording fakes: no production
 * data, no email.
 *   - an array-shaped filter evaluates instead of failing, and builds the SAME forecast query as the
 *     equivalent comma-separated string (no change in matching semantics);
 *   - first run baselines silently (no email); a later run emails only genuinely new forecasts, exactly once;
 *   - string-shaped filters are passed through unchanged (no change for the 150+ existing searches).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = [string, unknown[]];
const state = {
  searches: [] as Row[],
  open: [] as Row[],
  forecasts: [] as Row[],
  forecastOps: [] as Op[][],
  updates: [] as Array<{ id: unknown; payload: Row }>,
  sends: [] as Array<{ to: string; subject: string }>,
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
    if ((a[1] as { head?: boolean } | undefined)?.head) mode = 'count';
    return proxy;
  };
  b.update = (p: Row) => { mode = 'update'; payload = p; return proxy; };
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    if (table === 'saved_searches') {
      if (mode === 'update') {
        const id = ops.find(([m, a]) => m === 'eq' && a[0] === 'id')?.[1][1];
        state.updates.push({ id, payload });
        return Promise.resolve({ error: null, count: 1 }).then(resolve, reject);
      }
      if (mode === 'count') return Promise.resolve({ count: 0, error: null }).then(resolve, reject);
      const sel = String(ops.find((o) => o[0] === 'select')?.[1][0] ?? '');
      if (sel === 'forecast_seen_through') {
        // Production today: the watermark migration is NOT applied → legacy engine.
        return Promise.resolve({ data: null, error: { code: '42703', message: 'column saved_searches.forecast_seen_through does not exist' } }).then(resolve, reject);
      }
      const excludeOp = ops.find((o) => o[0] === 'not' && o[1][0] === 'id');
      const excluded = new Set(excludeOp ? String(excludeOp[1][2]).replace(/[()]/g, '').split(',') : []);
      return Promise.resolve({ data: state.searches.filter((r) => !excluded.has(String(r.id))), error: null }).then(resolve, reject);
    }
    if (table === 'sam_opportunities') return Promise.resolve({ data: state.open, error: null }).then(resolve, reject);
    if (table === 'agency_forecasts') {
      state.forecastOps.push(ops);
      return Promise.resolve({ data: state.forecasts, error: null }).then(resolve, reject);
    }
    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
  };
  return proxy;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
const reported: Array<{ job: string; outcome: string; summary?: string }> = [];
vi.mock('@/lib/cron-self-report', () => ({
  reportCronOutcome: vi.fn(async (job: string, outcome: string, summary?: string) => { reported.push({ job, outcome, summary }); }),
}));
vi.mock('@/lib/send-email', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string }) => { state.sends.push(m); return true; }),
}));

const { GET } = await import('./route');
const dispatch = async () => (await GET(new NextRequest('https://x/api/cron/saved-search-alerts?limit=50', { headers: { 'x-cron-dispatch': '1' } }))).json();

const ID = 'bcfb5381-2e9d-4da6-b531-23306c918145';
// The production row's exact filter shape.
const ARRAY_FILTERS = { naics: ['492110', '492210', '484220'], state: 'GA', country: 'us', horizons: { open: true, forecast: true, recompete: false } };
const STRING_FILTERS = { ...ARRAY_FILTERS, naics: '492110,492210,484220' };

const forecast = (id: string) => ({
  external_id: id, title: `Courier services ${id}`, source_agency: 'DHS', department: 'HOMELAND SECURITY',
  // fiscal_year is TEXT in prod (information_schema) — a numeric fixture would crash toAlertRow, a fake failure.
  naics_code: '492110', pop_state: 'GA', fiscal_year: '2027', last_synced_at: '2026-10-25T00:00:00Z',
});
const search = (filters: Row, over: Row = {}): Row => ({
  id: ID, user_email: 'customer@example.com', name: 'TCL courier & local trucking — GA weekly', mode: 'open',
  // The cron only runs due frequencies; daily keeps this independent of which weekday the test runs on.
  filters, alert_frequency: 'daily', last_seen_notice_ids: [], total_alerts_sent: 0, last_alerted_at: null, ...over,
});
/** The filter predicates applied to agency_forecasts — what decides which forecasts match. */
const forecastPredicates = () => state.forecastOps.flatMap((ops) => ops.filter(([m]) => m === 'or' || m === 'eq' || m === 'in'));

beforeEach(() => {
  state.updates = []; state.sends = []; state.forecastOps = []; reported.length = 0;
  state.open = [];
  state.forecasts = [forecast('F-1')];
});

describe('saved-search-alerts — array-shaped stored filters on the Forecast horizon', () => {
  it('evaluates instead of failing with forecast_query_failed, and baselines the first run silently', async () => {
    state.searches = [search(ARRAY_FILTERS)];
    const body = await dispatch();

    expect(body.failuresByClass).toEqual({});
    expect(body.failed).toBe(0);
    expect(body.outcome).toBe('success');
    expect(reported).toEqual([{ job: 'saved-search-alerts', outcome: 'success', summary: undefined }]);
    // First evaluation is a baseline: stamped, nothing sent.
    expect(state.sends).toHaveLength(0);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].id).toBe(ID);
    expect(state.updates[0].payload.last_seen_notice_ids).toEqual(['F-1']);
  });

  it('builds the identical forecast query as the equivalent comma-separated string (matching unchanged)', async () => {
    state.searches = [search(STRING_FILTERS)];
    await dispatch();
    const fromString = forecastPredicates();

    state.forecastOps = [];
    state.searches = [search(ARRAY_FILTERS)];
    await dispatch();
    const fromArray = forecastPredicates();

    expect(fromString.length).toBeGreaterThan(0);
    expect(fromArray).toEqual(fromString);
    // All three stored codes reach the query; none is dropped (dropping would widen or narrow the market).
    const naicsOr = fromArray.find(([m, a]) => m === 'or' && String(a[0]).includes('naics_code'));
    expect(String(naicsOr?.[1][0])).toMatch(/492110/);
    expect(String(naicsOr?.[1][0])).toMatch(/492210/);
    expect(String(naicsOr?.[1][0])).toMatch(/484220/);
  });

  it('after the baseline, emails only the genuinely new forecast — exactly once', async () => {
    state.forecasts = [forecast('F-1'), forecast('F-2')];
    state.searches = [search(ARRAY_FILTERS, { last_alerted_at: '2026-10-19T11:00:00Z', last_seen_notice_ids: ['F-1'] })];
    const body = await dispatch();

    expect(body.failuresByClass).toEqual({});
    expect(body.sent).toBe(1);
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].subject).toContain('1 new match');
    expect(state.updates[0].payload.last_seen_notice_ids).toEqual(expect.arrayContaining(['F-1', 'F-2']));

    // A retry with the stamped state sends nothing more: no duplicate email.
    state.searches = [search(ARRAY_FILTERS, { last_alerted_at: '2026-10-26T11:00:00Z', last_seen_notice_ids: state.updates[0].payload.last_seen_notice_ids })];
    state.sends = []; state.updates = [];
    const retry = await dispatch();
    expect(retry.sent).toBe(0);
    expect(state.sends).toHaveLength(0);
  });

  it('a non-string, non-array value (object) degrades to "no filter on that field", never a throw', async () => {
    state.searches = [search({ ...STRING_FILTERS, agency: { bad: true } })];
    const body = await dispatch();
    expect(body.failuresByClass).toEqual({});
  });
});
