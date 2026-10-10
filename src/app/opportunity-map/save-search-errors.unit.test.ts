/**
 * Save search — targeting matrix + actionable errors (follow-up to #1868 F1 / #1870 F2–F3).
 *
 * The REAL Map save handler (extracted from route.ts, with the real WATCH_SCOPE_JS) runs here and the
 * body it POSTs is fed to the REAL createSavedSearch (DB mocked) and to the REAL cron delivery rule
 * (savedSearchWantsOpen / savedSearchWantsForecasts). So for every horizon combination this pins, end
 * to end: what is sent, whether the service accepts it, and what the alert will actually email.
 *
 * And a failed save is never a bare "Couldn't save": every known service code, an expired session, a
 * 503, a non-JSON body and a dropped connection each produce a specific, actionable message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WATCH_SCOPE_JS } from '@/lib/saved-searches/watch-scope-client';
import {
  alertableScope,
  savedSearchWantsForecasts,
  savedSearchWantsOpen,
} from '@/lib/saved-searches/alert-scope';
import { createSavedSearch } from '@/lib/saved-searches/service';

const mockFrom = vi.fn();
vi.mock('@/lib/app/workspace', () => ({
  getAppSupabase: () => ({ from: mockFrom }),
  normalizeEmail: (e: string) => e.toLowerCase().trim(),
}));

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
function handlerSource(): string {
  const a = MAP.indexOf('  if(_ss)_ss.onclick=function(){');
  const b = MAP.indexOf('  // Apply a SAVED SEARCH to the map in-place', a);
  if (a < 0 || b < 0) throw new Error('save handler markers not found');
  return MAP.slice(a, b).replace(/\\\\/g, '\\');
}

type Horizons = { open?: boolean; recompete?: boolean; forecast?: boolean };
type Reply = { status?: number; body?: unknown; reject?: boolean; nonJson?: boolean };

function run(opts: { horizons: Horizons; mode?: string; signedIn?: boolean; reply?: Reply }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const confirms: string[] = [];
  const alerts: string[] = [];
  const events: unknown[][] = [];
  const win: Record<string, unknown> = { __horizons: { ...opts.horizons }, __track: (...a: unknown[]) => events.push(a) };
  new Function('window', WATCH_SCOPE_JS)(win);
  win.prompt = (_m: string, d: string) => d;
  const btn = { textContent: 'Save search', innerHTML: '', title: '', onclick: null as null | (() => void) };
  const pending: Promise<unknown>[] = [];
  const reply = opts.reply ?? { status: 200, body: { success: true } };
  const signedIn = opts.signedIn !== false;
  const fetchFn = (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const p: Promise<unknown> = reply.reject
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Promise.resolve({
          status: reply.status ?? 200,
          json: () => (reply.nonJson ? Promise.reject(new SyntaxError('Unexpected token <')) : Promise.resolve(reply.body)),
        });
    pending.push(p.catch(() => {}));
    return p;
  };
  const deps = {
    window: win,
    localStorage: { getItem: () => (signedIn ? 'tok.sig' : null) },
    _uemail: () => (signedIn ? 'pat@example.com' : ''),
    _anonId: () => 'anon:11111111-2222-4333-8444-555555555555',
    _track: () => {},
    _ss: btn,
    _ssReset: () => { btn.textContent = 'Save search'; },
    _ssMsg: (t: string) => { btn.textContent = t; },
    FILT: { naics: '541512', state: 'VA', setAside: 'all' },
    Q: '',
    MODE: opts.mode ?? 'open',
    map: { getBounds: () => ({ getWest: () => -80, getSouth: () => 36, getEast: () => -75, getNorth: () => 39 }) },
    confirm: (m: string) => { confirms.push(m); return true; },
    prompt: (_m: string, d: string) => d,
    alert: (m: string) => { alerts.push(m); },
    fetch: fetchFn,
    location: { href: '' },
    setTimeout: () => 0,
  };
  const names = Object.keys(deps);
  new Function(...names, handlerSource())(...names.map((n) => deps[n as keyof typeof deps]));
  btn.onclick!();
  const settle = () => Promise.all(pending).then(() => new Promise((r) => setImmediate(r)));
  return { calls, confirms, alerts, events, btn, settle };
}

/** The real service, with an empty account and a capturing insert. */
async function service(body: Record<string, unknown>) {
  let inserted: Record<string, unknown> | null = null;
  mockFrom.mockImplementation((table: string) => ({
    select: () => ({
      eq: () => (table === 'user_notification_settings'
        ? { maybeSingle: () => Promise.resolve({ data: { naics_codes: ['541512'] }, error: null }) }
        : Promise.resolve({ data: [], error: null })),
    }),
    insert: (row: Record<string, unknown>) => {
      inserted = row;
      return { select: () => ({ single: () => Promise.resolve({ data: { ...row, id: 'new', created_at: 'x', updated_at: 'x' }, error: null }) }) };
    },
  }));
  const res = await createSavedSearch({
    userEmail: String(body.email), name: String(body.name || 'n'), mode: body.mode as 'open',
    filters: body.filters as Record<string, unknown>, bbox: null,
  });
  return { res, inserted: inserted as Record<string, unknown> | null };
}

function emails(mode: 'open' | 'recompete', filters: Record<string, unknown>) {
  return { open: savedSearchWantsOpen(mode, filters), forecast: savedSearchWantsForecasts(mode, filters) };
}

describe('targeting matrix — signed-in Save search, real handler → real service → real cron rule', () => {
  beforeEach(() => { mockFrom.mockReset(); });

  it.each<[string, Horizons, Horizons | null, { open: boolean; forecast: boolean } | null]>([
    ['default (all three on)', { open: true, recompete: true, forecast: true }, { open: true, recompete: false, forecast: true }, { open: true, forecast: true }],
    ['Open only', { open: true, recompete: false, forecast: false }, { open: true, recompete: false, forecast: false }, { open: true, forecast: false }],
    ['Forecast only', { open: false, recompete: false, forecast: true }, { open: false, recompete: false, forecast: true }, { open: false, forecast: true }],
    ['Open + Forecast', { open: true, recompete: false, forecast: true }, { open: true, recompete: false, forecast: true }, { open: true, forecast: true }],
    ['Forecast + Recompete', { open: false, recompete: true, forecast: true }, { open: false, recompete: false, forecast: true }, { open: false, forecast: true }],
    ['Recompete only', { open: false, recompete: true, forecast: false }, null, null],
  ])('%s', async (_n, on, sent, delivered) => {
    const r = run({ horizons: on });
    if (sent === null) {
      // Nothing emailable: nothing is POSTed, and no Open is substituted.
      expect(r.calls).toEqual([]);
      expect(r.btn.textContent).toMatch(/Coming Back isn/);
      return;
    }
    expect(r.calls).toHaveLength(1);
    const body = r.calls[0].body;
    expect((body.filters as Record<string, unknown>).horizons).toEqual(sent);
    const { res, inserted } = await service(body);
    expect(res.ok).toBe(true);
    expect((inserted!.filters as Record<string, unknown>).horizons).toEqual(sent);
    // What the alert job will actually email for the stored row — never Open on a Forecast-only watch.
    expect(emails('open', inserted!.filters as Record<string, unknown>)).toEqual(delivered);
  });
});

describe('service — refusals are specific', () => {
  beforeEach(() => { mockFrom.mockReset(); });

  it('nothing deliverable selected → no_deliverable_horizon (not a recompete message)', async () => {
    const { res } = await service({ email: 'pat@example.com', mode: 'open', filters: { naics: '541512', horizons: { open: false, recompete: false, forecast: false } } });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('no_deliverable_horizon');
      expect(res.message).toMatch(/Turn on Open Now or Coming Soon/);
    }
  });

  it('a recompete request is still refused as unsupported_alert_scope (server rule unchanged)', async () => {
    const { res } = await service({ email: 'pat@example.com', mode: 'open', filters: { naics: '541512', horizons: { open: true, recompete: true, forecast: true } } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unsupported_alert_scope');
  });

  it('an invalid filter is invalid_filters, with the reason', async () => {
    const { res } = await service({ email: 'pat@example.com', mode: 'open', filters: { naics: '541512', sapBuyer: true } });
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.code).toBe('invalid_filters'); expect(res.message).toMatch(/sapBuyer/); }
  });
});

describe('anonymous saves and claimed watches — what activation can email', () => {
  it.each<[string, Horizons, string, { open: boolean; forecast: boolean } | null]>([
    ['default', { open: true, recompete: true, forecast: true }, 'partial', { open: true, forecast: true }],
    ['Forecast only', { open: false, recompete: false, forecast: true }, 'full', { open: false, forecast: true }],
    ['Open only', { open: true, recompete: false, forecast: false }, 'full', { open: true, forecast: false }],
    ['Recompete only', { open: false, recompete: true, forecast: false }, 'none', null],
  ])('%s', (_n, on, kind, delivered) => {
    // The anonymous save stores the view as it is …
    const r = run({ horizons: on, signedIn: false });
    expect(r.calls[0].url).toBe('/api/app/map-watch');
    expect((r.calls[0].body.filters as Record<string, unknown>).horizons).toEqual({ open: on.open !== false, recompete: !!on.recompete, forecast: !!on.forecast });
    // … and the claim (sign-in activation) emails only the deliverable part, never Recompete.
    const scope = alertableScope('open', { naics: '541512', horizons: on });
    expect(scope.kind).toBe(kind);
    if (delivered) expect(emails('open', scope.filters!)).toEqual(delivered);
    else expect(scope.filters).toBeNull();
  });
});

describe('a failed save says what to do — never a bare "Couldn\'t save"', () => {
  const H: Horizons = { open: true, recompete: false, forecast: true };
  it.each<[string, Reply, RegExp, RegExp]>([
    ['expired session (401)', { status: 401, body: { success: false, error: 'Sign in required' } }, /Sign in again/, /Sign in again, then click Save search/],
    ['nothing deliverable', { status: 400, body: { success: false, code: 'no_deliverable_horizon', error: 'x' } }, /Turn on Open Now or Coming Soon/, /Turn on Open Now or Coming Soon, then save again/],
    ['recompete refused', { status: 400, body: { success: false, code: 'unsupported_alert_scope', error: 'x' } }, /Coming Back isn/, /Track this recompete/],
    ['profile has no NAICS', { status: 400, body: { success: false, code: 'profile_scope_unavailable', error: 'x' } }, /Add NAICS to your profile/, /Add at least one in Settings/],
    ['invalid filter', { status: 400, body: { success: false, code: 'invalid_filters', error: 'Invalid sapBuyer value' } }, /A filter can/, /Invalid sapBuyer value.*Adjust it/],
    ['invalid mode', { status: 400, body: { success: false, code: 'invalid_mode', error: 'x' } }, /Switch to Opportunities/, /works on the Opportunities map/],
    ['missing name', { status: 400, body: { success: false, error: 'email and name are required' } }, /Name the search/, /Give this search a name/],
    ['scheduler down (503)', { status: 503, body: { success: false, code: 'scheduler_unavailable', error: 'x' } }, /Try again shortly/, /temporarily unavailable/],
    ['unexpected 500 with a message', { status: 500, body: { success: false, error: 'boom' } }, /Couldn.t save/, /Nothing was saved: boom.*support@getmindy\.ai/],
    ['non-JSON error page (502)', { status: 502, nonJson: true }, /Couldn.t save/, /Nothing was saved\..*support@getmindy\.ai/],
    ['no connection', { reject: true }, /No connection/, /Check your connection/],
  ])('%s', async (_n, reply, short, detail) => {
    const r = run({ horizons: H, reply });
    await r.settle();
    expect(r.btn.textContent).toMatch(short);
    expect(r.btn.textContent).not.toBe("Couldn't save");
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatch(detail);
    expect(r.events.some((e) => e[1] === 'watch_save_failed')).toBe(true);
  });

  it('a successful save shows no error', async () => {
    const r = run({ horizons: H });
    await r.settle();
    expect(r.btn.textContent).toMatch(/Saved/);
    expect(r.alerts).toEqual([]);
  });
});
