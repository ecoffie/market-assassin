/**
 * REGRESSION 2026-10-01 → 10-04: one customer search was stored as { naics: '541510', sapBuyer: true }.
 * The cron's parseMapFilters threw on it every day. Proven here through the REAL route handler:
 *   - the malformed search is reported INDIVIDUALLY (its id + invalid_saved_filters), not as an
 *     anonymous unexpected_schedule_error;
 *   - nothing is written to it (its missed interval is not silently baselined/consumed);
 *   - a valid search in the same batch — ordered AFTER the malformed one — still evaluates, sends and stamps.
 * Supabase and sendEmail are recording fakes. No production data, no email.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;
const state = {
  searches: [] as Row[],
  open: [] as Row[],
  updates: [] as Array<{ id: unknown; payload: Row }>,
  sends: [] as Array<{ to: string; subject: string }>,
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
    if (table === 'sam_opportunities') return Promise.resolve({ data: state.open, error: null }).then(resolve, reject);
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

const MALFORMED_ID = '72354a81-91a2-431e-96df-5f4b46c666a2';
const VALID_ID = '4651ee1d-0000-4000-8000-000000000001';

beforeEach(() => {
  state.updates = [];
  state.sends = [];
  state.open = [
    { notice_id: 'N-NEW-1', title: 'IT services', department: 'DEPT OF X', naics_code: '541510', posted_date: '2026-10-04T00:00:00Z' },
  ];
  state.searches = [
    // Oldest-due first (never alerted) → evaluated BEFORE the valid search.
    {
      id: MALFORMED_ID, user_email: 'customer@example.com', name: 'Micro-purchase / SAP', mode: 'open',
      filters: { naics: '541510', sapBuyer: true }, alert_frequency: 'daily',
      last_seen_notice_ids: [], total_alerts_sent: 0, last_alerted_at: null,
    },
    {
      id: VALID_ID, user_email: 'customer@example.com', name: 'Small Business', mode: 'open',
      filters: { naics: '541510' }, alert_frequency: 'daily',
      last_seen_notice_ids: ['N-OLD'], total_alerts_sent: 0, last_alerted_at: '2026-10-03T11:00:00Z',
    },
  ];
});

describe('saved-search-alerts — one malformed stored search', () => {
  it('is reported individually and never blocks a valid search in the same run', async () => {
    const res = await GET(new NextRequest('https://x/api/cron/saved-search-alerts?limit=50', { headers: { 'x-cron-dispatch': '1' } }));
    const body = await res.json();

    // Reported by id + a specific class, not an anonymous unexpected_schedule_error.
    expect(body.failuresByClass).toEqual({ invalid_saved_filters: 1 });
    expect(body.failedSearches).toEqual([{ id: MALFORMED_ID, failureClass: 'invalid_saved_filters' }]);
    expect(body.outcome).toBe('error');
    expect(body.processed).toBe(2);

    // The valid search still sent and stamped.
    expect(body.sent).toBe(1);
    expect(state.sends).toHaveLength(1);
    expect(state.updates.map((u) => u.id)).toEqual([VALID_ID]);
    expect(state.updates[0].payload.last_seen_notice_ids).toContain('N-NEW-1');

    // Nothing written to the malformed search: no baseline, no last_alerted_at — its missed interval is preserved.
    expect(state.updates.find((u) => u.id === MALFORMED_ID)).toBeUndefined();
  });
});
