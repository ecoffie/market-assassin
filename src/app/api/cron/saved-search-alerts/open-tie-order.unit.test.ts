/**
 * REGRESSION 2026-10-27 (Forecast Alert Truth investigation): `sam_opportunities.posted_date` is DAY-granular, so on
 * a busy day hundreds of active notices share one posted_date (682 on 2026-10-23). The Open query ordered ONLY by
 * posted_date with limit(200), so Postgres may return ANY 200 of the tied rows, and a different 200 on the next run.
 * Rows that rotated in were reported as "new" although the customer had matched them before (≥26 such rows in the
 * unfiltered searches' 10-26 email).
 *
 * The fake below behaves like Postgres: it honours every requested ORDER BY key, and rows still tied on all of them
 * come back in an arbitrary order that changes between calls. Supabase and sendEmail are recording fakes — no
 * production data, no email.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
type Op = [string, unknown[]];
const state = {
  searches: [] as Row[],
  open: [] as Row[],
  /** Seed for the arbitrary order of fully tied rows. Changing it = a different physical row order. */
  tieSeed: 1,
  updates: [] as Array<{ id: unknown; payload: Row }>,
  sends: [] as Array<{ to: string; subject: string }>,
};

function shuffled<T>(xs: T[], seed: number): T[] {
  const a = [...xs];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** ORDER BY the requested keys; anything tied on all of them keeps the (seeded) arbitrary order. */
function postgresOrder(rows: Row[], ops: Op[], seed: number): Row[] {
  const keys = ops.filter(([m]) => m === 'order').map(([, a]) => ({ col: String(a[0]), asc: (a[1] as { ascending?: boolean })?.ascending !== false }));
  const base = shuffled(rows, seed);
  return base
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      for (const k of keys) {
        const a = String(x.r[k.col] ?? ''), b = String(y.r[k.col] ?? '');
        if (a !== b) return (a < b ? -1 : 1) * (k.asc ? 1 : -1);
      }
      return x.i - y.i;   // fully tied → arbitrary (seeded) physical order
    })
    .map(({ r }) => r);
}

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
        return Promise.resolve({ data: null, error: { code: '42703', message: 'column saved_searches.forecast_seen_through does not exist' } }).then(resolve, reject);
      }
      const excludeOp = ops.find((o) => o[0] === 'not' && o[1][0] === 'id');
      const excluded = new Set(excludeOp ? String(excludeOp[1][2]).replace(/[()]/g, '').split(',') : []);
      return Promise.resolve({ data: state.searches.filter((r) => !excluded.has(String(r.id))), error: null }).then(resolve, reject);
    }
    if (table === 'sam_opportunities') {
      const limit = Number(ops.find(([m]) => m === 'limit')?.[1][0] ?? 1000);
      return Promise.resolve({ data: postgresOrder(state.open, ops, state.tieSeed).slice(0, limit), error: null }).then(resolve, reject);
    }
    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
  };
  return proxy;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/cron-self-report', () => ({ reportCronOutcome: vi.fn(async () => {}) }));
vi.mock('@/lib/send-email', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string }) => { state.sends.push(m); return true; }),
}));

const { GET } = await import('./route');
const dispatch = async () => (await GET(new NextRequest('https://x/api/cron/saved-search-alerts?limit=50', { headers: { 'x-cron-dispatch': '1' } }))).json();

const ID = 'open-tie-0000-4000-8000-000000000001';
// 682 active notices posted the SAME day (the real 2026-10-23 tie group), all created before the last run.
const TIED = Array.from({ length: 682 }, (_, i) => ({
  notice_id: `N-${String(i).padStart(4, '0')}`, title: `Notice ${i}`, department: 'DEPT', naics_code: '561720',
  posted_date: '2026-10-23T00:00:00+00:00',
}));
const search = (over: Row = {}): Row => ({
  id: ID, user_email: 'customer@example.com', name: 'cleaning service — Open', mode: 'open',
  filters: { q: 'cleaning', horizons: { open: true, forecast: false, recompete: false } },
  alert_frequency: 'daily', last_seen_notice_ids: [], total_alerts_sent: 0, last_alerted_at: '2026-10-25T11:00:00Z', ...over,
});

/** Run 1 establishes what the customer has seen; run 2 happens after the physical order of tied rows changed. */
async function twoRuns(extraNew: Row[] = []) {
  state.open = TIED; state.tieSeed = 1;
  state.searches = [search({ last_seen_notice_ids: ['N-SEED'] })];   // non-empty: a send run, not a baseline
  await dispatch();
  const seen = state.updates.at(-1)?.payload.last_seen_notice_ids as string[];
  expect(seen?.length).toBeGreaterThanOrEqual(200);

  state.updates = []; state.sends = [];
  state.open = [...extraNew, ...TIED]; state.tieSeed = 987654;          // same data, different physical order
  state.searches = [search({ last_seen_notice_ids: seen, last_alerted_at: '2026-10-26T11:00:00Z' })];
  return dispatch();
}

beforeEach(() => { state.updates = []; state.sends = []; });

describe('saved-search-alerts — Open window over a posted_date tie group', () => {
  it('a re-ordering of tied rows is not "new": the second run sends nothing', async () => {
    const body = await twoRuns();
    expect(body.failuresByClass).toEqual({});
    expect(body.sent).toBe(0);
    expect(state.sends).toHaveLength(0);
  });

  it('a genuinely new notice posted later is reported exactly once, and only it', async () => {
    const fresh = { notice_id: 'N-NEW', title: 'New cleaning notice', department: 'DEPT', naics_code: '561720', posted_date: '2026-10-26T00:00:00+00:00' };
    const body = await twoRuns([fresh]);
    expect(body.sent).toBe(1);
    expect(state.sends[0].subject).toContain('1 new match');
    expect(state.updates[0].payload.last_seen_notice_ids).toContain('N-NEW');
  });

  it('the same data in a different physical order yields the identical 200-row window', async () => {
    const windowFor = async (seed: number) => {
      state.updates = []; state.open = TIED; state.tieSeed = seed;
      state.searches = [search({ last_seen_notice_ids: ['N-SEED'] })];
      await dispatch();
      return state.updates.at(-1)?.payload.last_seen_notice_ids as string[];
    };
    expect(await windowFor(2)).toEqual(await windowFor(1));
  });
});
