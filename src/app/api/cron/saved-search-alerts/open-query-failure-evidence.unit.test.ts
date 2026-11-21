/**
 * DIAGNOSTIC EVIDENCE for the intermittent `opportunity_query_failed` (Mortgage Link1, 2026-11).
 * The route used to drop the Open query error: no log line, no code, no search id, so production
 * history could not tell a statement timeout from anything else. Proven through the REAL route:
 *   - a statement timeout (57014) is reported as `opportunity_query_timeout`, with its code, by search id;
 *   - any other query error stays `opportunity_query_failed`, with its code;
 *   - the log line carries the code and the search's SHAPE (sizes), never the customer's words;
 *   - nothing is stamped on the failed search (its missed interval is preserved), and the query is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const state = {
  searches: [] as Row[],
  open: [] as Row[],
  updates: [] as Array<{ id: unknown; payload: Row }>,
  sends: [] as Array<{ to: string; subject: string }>,
  /** When set, the fake send guard BLOCKS with this reason (sendEmail's onBlocked contract) and returns false. */
  blockReason: null as string | null,
  /** When set, the Open query (sam_opportunities) fails with this PostgREST error. */
  openError: null as { code?: string; message: string } | null,
};

function builder(table: string) {
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
    if (table === 'sam_opportunities') {
      return Promise.resolve(state.openError ? { data: null, error: state.openError } : { data: state.open, error: null }).then(resolve, reject);
    }
    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
  };
  return proxy;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));
const reported: Array<{ job: string; outcome: string; summary?: string }> = [];
vi.mock('@/lib/cron-self-report', () => ({
  // The exact (job, outcome, errorSummary) the dispatcher-watchdog later reads from cron_job_runs.
  reportCronOutcome: vi.fn(async (job: string, outcome: string, summary?: string) => { reported.push({ job, outcome, summary }); }),
}));
vi.mock('@/lib/send-email', () => ({
  sendEmail: vi.fn(async (m: { to: string; subject: string; onBlocked?: (r: string) => void }) => {
    if (state.blockReason) { m.onBlocked?.(state.blockReason); return false; }
    state.sends.push(m); return true;
  }),
}));

const { GET } = await import('./route');

const SEARCH_ID = '9c1f0000-0000-4000-8000-00000000abcd';
const SECRET_WORDS = 'commercial glazing curtain wall storefront';

beforeEach(() => {
  state.updates = [];
  state.sends = [];
  state.blockReason = null;
  state.openError = null;
  reported.length = 0;
  state.open = [];
  state.searches = [{
    id: SEARCH_ID, user_email: 'customer@example.com', name: 'Glazing', mode: 'open',
    filters: { naics: '238150', q: SECRET_WORDS }, alert_frequency: 'daily',
    last_seen_notice_ids: [], total_alerts_sent: 0, last_alerted_at: '2026-11-19T11:00:00Z',
  }];
});

async function run() {
  const errors: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ')); });
  try {
    const res = await GET(new NextRequest('https://x/api/cron/saved-search-alerts?limit=50', { headers: { 'x-cron-dispatch': '1' } }));
    return { body: await res.json(), errors };
  } finally {
    spy.mockRestore();
  }
}

describe('Open query failure is recorded with its cause', () => {
  it('a statement timeout (57014) → opportunity_query_timeout, by id, with its code', async () => {
    state.openError = { code: '57014', message: 'canceling statement due to statement timeout' };
    const { body, errors } = await run();
    expect(body.failuresByClass).toEqual({ opportunity_query_timeout: 1 });
    expect(body.failedSearches).toEqual([{ id: SEARCH_ID, failureClass: 'opportunity_query_timeout', errorCode: '57014' }]);
    expect(reported.at(-1)?.summary).toBe('opportunity_query_timeout=1');
    const line = errors.find((e) => e.includes('Open query failed'))!;
    expect(line).toContain(SEARCH_ID);
    expect(line).toContain('code=57014 timeout=true');
    expect(line).toMatch(/search_chars=\d+ search_terms=5 naics=1 scope=none/);
    expect(line).not.toContain('glazing');
    expect(state.updates).toHaveLength(0);
  });

  it('any other query error stays opportunity_query_failed, with its code', async () => {
    state.openError = { code: '42703', message: 'column sam_opportunities.x does not exist' };
    const { body, errors } = await run();
    expect(body.failuresByClass).toEqual({ opportunity_query_failed: 1 });
    expect(body.failedSearches).toEqual([{ id: SEARCH_ID, failureClass: 'opportunity_query_failed', errorCode: '42703' }]);
    expect(errors.find((e) => e.includes('Open query failed'))).toContain('code=42703 timeout=false');
    expect(state.updates).toHaveLength(0);
  });

  it('an error with no code (network) is still recorded, without inventing one', async () => {
    state.openError = { message: 'fetch failed' };
    const { body, errors } = await run();
    expect(body.failedSearches).toEqual([{ id: SEARCH_ID, failureClass: 'opportunity_query_failed' }]);
    expect(errors.find((e) => e.includes('Open query failed'))).toContain('code=none timeout=false');
  });
});
