/**
 * saved-search-alerts — the CANONICAL (watermark) Forecast engine and the EMERGENCY ROLLBACK, end to end through the
 * REAL route handler. Supabase and sendEmail are recording fakes; agency_forecasts honours created_at, floors,
 * agency and the (created_at, id) keyset (fake-forecast-db.ts). No production data, no email.
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
  columns: 'present' as 'present' | 'absent' | 'unknown',
  rpcCalls: 0,
  selects: [] as string[],
  updates: [] as Array<{ id: unknown; payload: Row }>,
  forecastQueries: [] as Op[][],
  sends: [] as Array<{ to: string; subject: string; html: string; text: string }>,
  claims: [] as Array<string | null>,
  updateError: null as { message: string } | null,
  saveFails: 0,
  staleRow: null as Row | null,
  sendGate: null as Promise<void> | null,
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
        // Honour the write's filters against the one row, as PostgREST would (CAS semantics for send-claim.ts).
        const row = state.search;
        const ts = (v: unknown) => (v == null ? null : Date.parse(String(v)));
        const matches = !!row && ops.every(([m, a]) => {
          if (m === 'eq') return a[0] === 'id' ? row.id === a[1] : ts(row[a[0] as string]) === ts(a[1]) && row[a[0] as string] != null;
          if (m === 'is') return row[a[0] as string] == null;
          if (m === 'or') return String(a[0]).split(',').some((c) => {
            const [col, op, ...rest] = c.split('.'); const v = rest.join('.');
            return op === 'is' ? row[col] == null : op === 'lt' ? row[col] != null && ts(row[col])! < ts(v)! : false;
          });
          return true;
        });
        if (state.updateError) return Promise.resolve({ error: state.updateError, count: null }).then(resolve, reject);
        const isClaimWrite = Object.keys(payload).length === 1 && 'forecast_alert_claim_until' in payload;
        if (!isClaimWrite && state.saveFails > 0) { state.saveFails--; return Promise.resolve({ error: { message: 'connection reset' }, count: null }).then(resolve, reject); }
        if (!matches) return Promise.resolve({ error: null, count: 0 }).then(resolve, reject);
        const onlyClaim = Object.keys(payload).length === 1 && 'forecast_alert_claim_until' in payload;
        if (onlyClaim) state.claims.push(payload.forecast_alert_claim_until as string | null);
        else state.updates.push({ id: row.id, payload });
        state.search = { ...row, ...payload };
        return Promise.resolve({ error: null, count: 1 }).then(resolve, reject);
      }
      if (mode === 'count') return Promise.resolve({ count: 0, error: null }).then(resolve, reject);
      const sel = String(ops.find((o) => o[0] === 'select')?.[1][0] ?? '');
      if (sel === 'forecast_seen_through') { // the once-per-invocation column probe
        if (state.columns === 'absent') return Promise.resolve({ data: null, error: { code: '42703', message: 'column saved_searches.forecast_seen_through does not exist' } }).then(resolve, reject);
        if (state.columns === 'unknown') return Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }).then(resolve, reject);
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      }
      const excluded = ops.some((o) => o[0] === 'not' && o[1][0] === 'id');
      // A stale read models an overlapping execution that loaded the row before another run changed it.
      const due = state.staleRow ?? state.search; state.staleRow = null;
      return Promise.resolve({ data: excluded || !due ? [] : [due], error: null }).then(resolve, reject);
    }
    if (table === 'sam_opportunities') return Promise.resolve({ data: state.open, error: null }).then(resolve, reject);
    if (table === 'forecast_publisher_alert_floor') return Promise.resolve({ data: state.floors, error: null }).then(resolve, reject);
    if (table === 'agency_forecasts') {
      state.forecastQueries.push(ops);
      if (state.forecastError) return Promise.resolve({ data: null, error: state.forecastError }).then(resolve, reject);
      const legacy = !ops.some((o) => (o[0] === 'gt' && o[1][0] === 'created_at') || (o[0] === 'in' && o[1][0] === 'id'));
      return Promise.resolve({ data: legacy ? state.forecasts : applyForecastOps(state.forecasts, ops).slice(0, 1000), error: null }).then(resolve, reject); // PostgREST max-rows
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
  sendEmail: vi.fn(async (m: { to: string; subject: string; html: string; text: string }) => { if (state.sendGate) await state.sendGate; state.sends.push(m); return true; }),
}));

const { GET } = await import('./route');

let seq = 0;
const fc = (src: string, created: string, extra: Partial<FakeForecastRow> = {}): FakeForecastRow => {
  const id = (++seq).toString(16).padStart(12, '0');
  return { id, external_id: `${src}-${id}`, source_agency: src, created_at: created, last_synced_at: '2026-09-23T13:00:38.208Z', title: `Forecast ${id}`, fiscal_year: 'FY2026', ...extra };
};
const W = '2026-09-23T11:00:00.000Z';
const search = (filters: Row, extra: Row = {}): Row => ({
  id: 'ss-1', user_email: 'owner@example.com', name: 'My market', mode: 'open', filters,
  alert_frequency: 'daily', last_seen_notice_ids: ['OPEN-OLD'], total_alerts_sent: 3, last_alerted_at: W,
  forecast_seen_through: W, forecast_gap_since: null, forecast_pending: null, ...extra,
});
const run = async (qs = '') => {
  const res = await GET(new NextRequest(`http://localhost/api/cron/saved-search-alerts${qs}`));
  return { status: res.status, body: await res.json() };
};
/** Apply the recorded update to the search, as the database would. */
const persist = () => { if (state.updates.length) state.search = { ...state.search!, ...state.updates[state.updates.length - 1].payload }; state.updates = []; };
const FC = { naics: '541512', horizons: { forecast: true } };
const forecastEmails = () => state.sends.filter((m) => /Forecast/.test(m.html));

beforeEach(() => {
  Object.assign(state, {
    search: null, open: [], forecasts: [], forecastError: null, snapshot: '2026-09-24T11:00:00.000Z', columns: 'present',
    rpcCalls: 0, selects: [], updates: [], forecastQueries: [], sends: [], claims: [], updateError: null, saveFails: 0, staleRow: null, sendGate: null,
    floors: ['DOE', 'DHS', 'VA', 'HHS'].map((s) => ({ source_agency: s, state: 'active', alertable_after: '2026-09-01T00:00:00.000Z' })),
  });
  process.env.SAVED_SEARCH_FORECAST_CANONICAL = 'true';
});
afterEach(() => { delete process.env.SAVED_SEARCH_FORECAST_CANONICAL; });

describe('canonical (watermark) engine — alert decisions and state', () => {
  it('reads the watermark columns (incl. pending progress) and one DB snapshot per evaluation', async () => {
    state.search = search(FC);
    await run();
    expect(state.selects.some((s) => s.includes('forecast_seen_through, forecast_gap_since, forecast_pending'))).toBe(true);
    expect(state.rpcCalls).toBe(1);
  });

  it('historical forecast → no alert; watermark advances; Open seen untouched', async () => {
    state.search = search(FC); state.forecasts = [fc('DOE', '2026-08-01T12:00:00Z', { last_synced_at: '2026-09-23T13:00:38Z' })];
    const { body } = await run();
    expect(state.sends).toHaveLength(0);
    expect(body.forecastCoverage).toEqual({ covered: 1 });
    expect(state.updates[0].payload).toMatchObject({ forecast_seen_through: '2026-09-24T11:00:00.000Z', forecast_gap_since: null, forecast_pending: null });
    expect(state.updates[0].payload.last_seen_notice_ids).toBeUndefined();
  });

  it('new forecast → one email; after a re-sync the next run → not again', async () => {
    state.search = search(FC); state.forecasts = [fc('DOE', '2026-08-01T00:00:00Z'), fc('DHS', '2026-09-23T20:00:00Z')];
    expect((await run()).body.sent).toBe(1);
    expect(state.sends[0].subject).toBe('1 new match in “My market”');
    expect(state.updates[0].payload.last_seen_notice_ids).toBeUndefined();
    persist();
    state.snapshot = '2026-09-25T11:00:00.000Z';
    state.forecasts = state.forecasts.map((r) => ({ ...r, last_synced_at: '2026-09-24T13:00:00Z' }));
    expect((await run()).body.sent).toBe(0);
    expect(state.sends).toHaveLength(1);
  });

  it('Open + Forecast new → one email; the Open seen list gains ONLY Open ids', async () => {
    state.search = search(FC);
    state.open = [{ notice_id: 'OPEN-OLD', title: 'o' }, { notice_id: 'OPEN-NEW', title: 'n' }];
    state.forecasts = [fc('DHS', '2026-09-24T01:00:00Z')];
    await run();
    expect(state.sends[0].subject).toBe('2 new matches in “My market”');
    expect(state.updates[0].payload.last_seen_notice_ids).toEqual(['OPEN-OLD', 'OPEN-NEW']);
  });

  it('unavailable → no forecast query, watermark untouched; Open still alerts', async () => {
    state.search = search({ agency: 'HUD', horizons: { forecast: true } });
    state.open = [{ notice_id: 'OPEN-NEW', title: 'HUD janitorial', department: 'HOUSING AND URBAN DEVELOPMENT' }];
    state.forecasts = [fc('DHS', '2026-09-24T01:00:00Z')];
    const { body } = await run();
    expect(state.forecastQueries).toHaveLength(0);
    expect(body.forecastCoverage).toEqual({ unavailable: 1 });
    expect(state.sends[0].html).toContain('Upcoming (forecast) buys: not available for HUD');
    expect('forecast_seen_through' in state.updates[0].payload).toBe(false);
  });

  it('partial → covered rows alert with the warning; the uncovered buyer keeps its boundary', async () => {
    state.search = search({ agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } });
    state.forecasts = [fc('VA', '2026-09-24T02:00:00Z')];
    expect((await run()).body.forecastCoverage).toEqual({ partial: 1 });
    expect(state.sends[0].html).toContain('Not measured: COMMERCE');
    expect(state.updates[0].payload).toMatchObject({ forecast_seen_through: '2026-09-24T11:00:00.000Z', forecast_gap_since: { COMMERCE: W } });
  });

  it('failures write nothing: forecast query, snapshot, email send', async () => {
    state.search = search(FC); state.open = [{ notice_id: 'OPEN-NEW', title: 'x' }];
    state.forecastError = { message: 'canceling statement due to statement timeout' };
    const a = await run();
    expect(a.body.failuresByClass).toEqual({ forecast_query_failed: 1 }); expect(a.status).toBe(500);
    state.forecastError = null; state.snapshot = null;
    expect((await run()).body.failuresByClass).toEqual({ forecast_query_failed: 1 });
    state.snapshot = '2026-09-24T11:00:00.000Z';
    const { sendEmail } = await import('@/lib/send-email');
    vi.mocked(sendEmail).mockResolvedValueOnce(false);
    state.forecasts = [fc('DHS', '2026-09-24T02:00:00Z')];
    expect((await run()).body.failuresByClass).toEqual({ email_send_rejected: 1 });
    expect(state.updates).toHaveLength(0);
  });

  it('NULL watermark → silent baseline; brand-new search → Open AND Forecast baseline, no email', async () => {
    state.search = search(FC, { forecast_seen_through: null, last_alerted_at: null, last_seen_notice_ids: [] });
    state.open = [{ notice_id: 'OPEN-1', title: 'x' }];
    state.forecasts = [fc('DHS', '2026-09-24T02:00:00Z')];
    const { body } = await run();
    expect(state.sends).toHaveLength(0); expect(state.forecastQueries).toHaveLength(0);
    expect(body.forecastCoverage).toEqual({ baseline: 1 });
    expect(state.updates[0].payload).toMatchObject({ last_seen_notice_ids: ['OPEN-1'], forecast_seen_through: '2026-09-24T11:00:00.000Z' });
  });
});

describe('high volume through the route — progress is durable, the email is one count + evidence', () => {
  it('20,500 new forecasts: run 1 persists keyset progress (no Forecast email, Open still delivered); run 2 completes with ONE email saying 20,500', async () => {
    state.search = search(FC);
    const base = Date.parse('2026-09-23T12:00:00Z');
    state.forecasts = Array.from({ length: 20_500 }, (_, i) => fc('DHS', new Date(base + i * 1000).toISOString()));
    state.open = [{ notice_id: 'OPEN-OLD', title: 'o' }, { notice_id: 'OPEN-NEW', title: 'n' }];
    const a = await run();
    expect(a.body.forecastCoverage).toEqual({ in_progress: 1 });
    expect(state.sends).toHaveLength(1);                         // the Open alert is not held back
    expect(state.sends[0].subject).toBe('1 new match in “My market”');
    const p1 = state.updates[0].payload;
    expect(p1.forecast_seen_through).toBe(W);                    // watermark NOT advanced
    expect((p1.forecast_pending as { processed: number }).processed).toBe(20_000);
    expect(JSON.stringify(p1.forecast_pending).length).toBeLessThan(2000);
    persist(); state.sends = []; state.open = [];
    state.snapshot = '2026-09-25T11:00:00.000Z';                 // the resumed interval keeps ITS snapshot
    const b = await run();
    expect(b.body.forecastCoverage).toEqual({ covered: 1 });
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].subject).toBe('20500 new matches in “My market”');
    expect((state.sends[0].html.match(/<tr>/g) || []).length).toBeLessThanOrEqual(3 + 2); // 3 evidence rows, never 20,500
    expect(state.updates[0].payload).toMatchObject({ forecast_seen_through: '2026-09-24T11:00:00.000Z', forecast_pending: null });
  });
});

describe('high volume — the notification TOTAL is the complete interval count, never a page / seen-list / evidence count', () => {
  it('1,237 new forecasts (> one 500-row page): ONE email reports 1,237, shows ≤ 3 examples and says they are examples', async () => {
    state.search = search(FC);
    const base = Date.parse('2026-09-23T12:00:00Z');
    state.forecasts = Array.from({ length: 1_237 }, (_, i) => fc('DHS', new Date(base + i * 1000).toISOString()));
    const r = await run();
    expect(r.body.forecastCoverage).toEqual({ covered: 1 });
    expect(state.sends).toHaveLength(1);
    const m = state.sends[0];
    // The complete interval count — not 500 (one keyset page), 3 (evidence), 1 (the stored Open seen list) or the batch.
    expect(m.subject).toBe('1237 new matches in “My market”');
    expect(m.html).toContain('1237 new matches');
    expect(m.html).toContain('See all 1237');
    expect(m.text).toContain('1237 new matches');
    for (const wrong of ['500 new', '501 new', '3 new', '1 new', '1000 new']) expect(m.subject).not.toContain(wrong);
    // ≤ 3 examples, disclosed as examples of the complete set.
    expect((m.html.match(/\?opp=/g) || []).length).toBeLessThanOrEqual(3);
    expect(m.html).toMatch(/These are 3 examples, not the complete set of 1,237 new matches/);
    expect(m.text).toMatch(/These are 3 examples, not the complete set of 1,237 new matches/);
    // State: the interval completed → watermark advances to the snapshot; Forecast ids never enter the Open seen list.
    const p = state.updates[0].payload;
    expect(p).toMatchObject({ forecast_seen_through: '2026-09-24T11:00:00.000Z', forecast_pending: null });
    expect(p.last_seen_notice_ids ?? ['OPEN-OLD']).toEqual(['OPEN-OLD']);
    persist(); state.sends = [];
    expect((await run()).body.sent).toBe(0);                     // the same interval is never notified twice
  });
});

describe('EMERGENCY ROLLBACK — canonical ON → OFF → ON', () => {
  it('rollback sends ZERO Forecast emails, Open continues, Forecast state untouched; canonical resumes from its watermark', async () => {
    // 1 · canonical ON: measures, advances W to S1.
    state.search = search(FC, { last_seen_notice_ids: ['OPEN-OLD'] });
    state.forecasts = [fc('DOE', '2026-08-01T00:00:00Z'), fc('DHS', '2026-09-23T20:00:00Z')];
    await run(); persist(); state.sends = []; state.forecastQueries = [];
    const W1 = state.search!.forecast_seen_through;
    expect(W1).toBe('2026-09-24T11:00:00.000Z');

    // 2 · EMERGENCY ROLLBACK: flag unset. Old forecasts sit in the legacy 200-row window and the seen list is
    //     Open-only — exactly the burst legacy would send. Plus a genuinely new forecast and a new Open notice.
    delete process.env.SAVED_SEARCH_FORECAST_CANONICAL;
    const during = fc('DHS', '2026-09-24T20:00:00Z');
    state.forecasts = [...state.forecasts, ...Array.from({ length: 200 }, () => fc('DOE', '2026-08-01T00:00:00Z')), during];
    state.open = [{ notice_id: 'OPEN-OLD', title: 'o' }, { notice_id: 'OPEN-NEW', title: 'Open during rollback' }];
    state.snapshot = '2026-09-25T11:00:00.000Z';
    const r = await run();
    expect(r.body.forecastEngine).toBe('legacy');
    expect(r.body.forecastCoverage).toEqual({ rollback_paused: 1 });
    expect(state.forecastQueries).toHaveLength(0);               // legacy never even reads Forecasts
    expect(state.sends).toHaveLength(1);                         // Open continues
    expect(state.sends[0].subject).toBe('1 new match in “My market”');
    expect(forecastEmails()).toHaveLength(0);                    // ZERO Forecast emails
    const up = state.updates[0].payload;
    expect(up.last_seen_notice_ids).toEqual(['OPEN-OLD', 'OPEN-NEW']);
    for (const k of ['forecast_seen_through', 'forecast_gap_since', 'forecast_pending']) expect(k in up).toBe(false); // untouched
    persist(); state.sends = []; state.open = [];

    // A second rollback day: still nothing.
    expect((await run()).body.forecastCoverage).toEqual({ rollback_paused: 1 });
    expect(state.sends).toHaveLength(0);
    persist();

    // 3 · canonical back ON: resumes from W1 — the forecast created DURING rollback alerts exactly once; the old
    //     rows never do.
    process.env.SAVED_SEARCH_FORECAST_CANONICAL = 'true';
    state.snapshot = '2026-09-26T11:00:00.000Z';
    const back = await run();
    expect(back.body.sent).toBe(1);
    expect(state.sends[0].subject).toBe('1 new match in “My market”');
    expect(state.sends[0].html).toContain(during.title);
    persist(); state.sends = [];
    state.snapshot = '2026-09-27T11:00:00.000Z';
    await run();
    expect(state.sends).toHaveLength(0);
  });

  it('pre-migration (columns absent): the legacy engine is exactly as before', async () => {
    delete process.env.SAVED_SEARCH_FORECAST_CANONICAL;
    state.columns = 'absent';
    state.search = search({ agency: 'VETERANS AFFAIRS|COMMERCE', horizons: { forecast: true } });
    state.forecasts = [fc('VA', '2026-09-24T02:00:00Z')];
    const { body } = await run();
    expect(body.watermarkColumns).toBe('absent');
    expect(state.rpcCalls).toBe(0);
    expect(state.selects.find((s) => s.startsWith('id,'))).not.toContain('forecast_seen_through');
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0].html).not.toContain('Upcoming (forecast) buys');
    expect(state.updates[0].payload.last_seen_notice_ids).toEqual([state.forecasts[0].external_id, 'OPEN-OLD']);
  });

  it('columns present but the search was NEVER canonically measured: legacy Forecast delivery still works', async () => {
    delete process.env.SAVED_SEARCH_FORECAST_CANONICAL;
    state.search = search(FC, { forecast_seen_through: null });
    state.forecasts = [fc('VA', '2026-09-24T02:00:00Z')];
    await run();
    expect(state.sends).toHaveLength(1);
  });

  it('probe inconclusive → fail SAFE: no legacy Forecast delivery, Open continues', async () => {
    delete process.env.SAVED_SEARCH_FORECAST_CANONICAL;
    state.columns = 'unknown';
    state.search = search(FC, { forecast_seen_through: null });
    state.forecasts = [fc('VA', '2026-09-24T02:00:00Z')];
    state.open = [{ notice_id: 'OPEN-NEW', title: 'n' }];
    const { body } = await run();
    expect(body.forecastCoverage).toEqual({ rollback_paused: 1 });
    expect(state.forecastQueries).toHaveLength(0);
    expect(state.sends).toHaveLength(1);
    expect(forecastEmails()).toHaveLength(0);
  });

  it('canonical requested but the migration is not applied → refuses loudly, writes nothing', async () => {
    state.columns = 'absent';
    state.search = search(FC);
    const { status, body } = await run();
    expect(status).toBe(500); expect(body.note).toMatch(/requires migration/);
    expect(state.updates).toHaveLength(0); expect(state.sends).toHaveLength(0);
  });

  it('a non-"true" flag value stays legacy; a mutating run ignores ?forecastEngine=canonical', async () => {
    process.env.SAVED_SEARCH_FORECAST_CANONICAL = '1';
    state.search = search(FC);
    expect((await run('?forecastEngine=canonical')).body.forecastEngine).toBe('legacy');
  });
});

describe('DELIVERY GUARANTEES — overlapping runs, failure before send, save failure after send (send-claim.ts)', () => {
  const newForecast = () => { state.search = search(FC); state.forecasts = [fc('DHS', '2026-09-24T02:00:00Z')]; };

  it('overlap, lease held: run B evaluates the same interval while run A is sending → B skips, ONE email', async () => {
    newForecast();
    let open!: () => void;
    state.sendGate = new Promise<void>((r) => { open = r; });
    const a = run();
    await vi.waitFor(() => expect(state.claims).toHaveLength(1));   // A holds the lease and is inside sendEmail
    state.sendGate = null;
    const b = await run();
    expect(b.body.skippedConcurrent).toBe(1);
    expect(b.body.sent).toBe(0);
    open();
    const ra = await a;
    expect(ra.body.sent).toBe(1);
    expect(forecastEmails()).toHaveLength(1);
    expect(state.search!.forecast_alert_claim_until).toBeNull();   // cleared by A's state write
  });

  it('overlap, stale read: run B loaded the row before run A committed → B loses the compare-and-set, sends nothing, writes nothing', async () => {
    newForecast();
    const stale = { ...state.search! };
    expect((await run()).body.sent).toBe(1);
    const saved = { ...state.search! };
    state.staleRow = stale;
    const b = await run();
    expect(b.body.skippedConcurrent).toBe(1);
    expect(forecastEmails()).toHaveLength(1);
    expect(state.search).toEqual(saved);   // A's newer watermark is not regressed
  });

  it('a slower run cannot regress the watermark with an EARLIER snapshot (no-send save is a CAS too)', async () => {
    newForecast();
    const stale = { ...state.search! };
    expect((await run()).body.sent).toBe(1);
    const saved = { ...state.search! };
    state.forecasts = []; state.snapshot = '2026-09-24T10:00:00.000Z';   // B's snapshot is older and finds nothing
    state.staleRow = stale;
    const b = await run();
    expect(b.body.skippedConcurrent).toBe(1);
    expect(state.search!.forecast_seen_through).toBe(saved.forecast_seen_through);
  });

  it('failure before send (provider throws): no alert state changes, the lease is released, the next run delivers once', async () => {
    newForecast();
    const before = { ...state.search! };
    const { sendEmail } = await import('@/lib/send-email');
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('provider down'));
    const a = await run();
    expect(a.body.failuresByClass).toEqual({ email_send_failed: 1 });
    expect(state.updates).toHaveLength(0);
    expect(state.claims).toHaveLength(2);                 // claim, then release
    expect(state.claims[1]).toBeNull();
    expect({ ...state.search!, forecast_alert_claim_until: undefined }).toEqual({ ...before, forecast_alert_claim_until: undefined });
    expect((await run()).body.sent).toBe(1);               // no loss: retried immediately
    expect(forecastEmails()).toHaveLength(1);
  });

  it('send ok, first save fails: the retry saves it — one email, no duplicate', async () => {
    newForecast(); state.saveFails = 1;
    const a = await run();
    expect(a.body.sent).toBe(1); expect(a.body.failed).toBe(0);
    expect(state.search!.forecast_seen_through).toBe('2026-09-24T11:00:00.000Z');
    expect((await run()).body.sent).toBe(0);
    expect(forecastEmails()).toHaveLength(1);
  });

  it('send ok, save fails twice: reported; the lease blocks an immediate re-send; after it expires the SAME interval is re-sent (at-least-once)', async () => {
    newForecast(); state.saveFails = 2;
    const a = await run();
    expect(a.body.sent).toBe(1);
    expect(a.body.failuresByClass).toEqual({ state_update_failed: 1 });
    expect(state.search!.forecast_seen_through).toBe(W);                   // state did not move
    expect(state.search!.forecast_alert_claim_until).toBeTruthy();         // lease still held
    const b = await run();
    expect(b.body.skippedConcurrent).toBe(1);
    expect(forecastEmails()).toHaveLength(1);                              // no duplicate while leased
    state.search = { ...state.search!, forecast_alert_claim_until: '2026-01-01T00:00:00.000Z' };   // lease expired
    const c = await run();
    expect(c.body.sent).toBe(1);
    expect(forecastEmails()).toHaveLength(2);                              // the documented duplicate — never a silent loss
    expect(state.search!.forecast_seen_through).toBe('2026-09-24T11:00:00.000Z');
  });
});
