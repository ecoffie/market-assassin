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

function run(opts: { horizons: Horizons; mode?: string; signedIn?: boolean; reply?: Reply; replies?: Reply[]; filt?: Record<string, unknown>; q?: string; confirmAnswers?: boolean[]; win?: Record<string, unknown> }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const confirms: string[] = [];
  const alerts: string[] = [];
  const events: unknown[][] = [];
  const win: Record<string, unknown> = { __horizons: { ...opts.horizons }, __track: (...a: unknown[]) => events.push(a), ...(opts.win ?? {}) };
  new Function('window', WATCH_SCOPE_JS)(win);
  win.prompt = (_m: string, d: string) => d;
  const btn = { textContent: 'Save search', innerHTML: '', title: '', onclick: null as null | (() => void) };
  const pending: Promise<unknown>[] = [];
  const replies = opts.replies ? [...opts.replies] : null;
  const signedIn = opts.signedIn !== false;
  const answers = opts.confirmAnswers ? [...opts.confirmAnswers] : null;
  const fetchFn = (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const reply = (replies ? replies.shift() : opts.reply) ?? { status: 200, body: { success: true } };
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
    FILT: opts.filt ?? { naics: '541512', state: 'VA', setAside: 'all' },
    Q: opts.q ?? '',
    MODE: opts.mode ?? 'open',
    map: { getBounds: () => ({ getWest: () => -80, getSouth: () => 36, getEast: () => -75, getNorth: () => 39 }) },
    confirm: (m: string) => { confirms.push(m); return answers ? answers.shift() !== false : true; },
    prompt: (_m: string, d: string) => d,
    alert: (m: string) => { alerts.push(m); },
    fetch: fetchFn,
    location: { href: '' },
    setTimeout: () => 0,
  };
  const names = Object.keys(deps);
  new Function(...names, handlerSource())(...names.map((n) => deps[n as keyof typeof deps]));
  btn.onclick!();
  const settle = async () => {
    for (let i = 0; i < 5; i++) { await Promise.all(pending); await new Promise((r) => setImmediate(r)); }
  };
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
    ['nothing deliverable', { status: 400, body: { success: false, code: 'no_deliverable_horizon', error: 'x' } }, /Turn on Open Now or Coming Soon/, /Turn on Open Now or Coming Soon, then save again/],
    ['recompete refused', { status: 400, body: { success: false, code: 'unsupported_alert_scope', error: 'x' } }, /Coming Back isn/, /Track this recompete/],
    ['profile has no NAICS', { status: 400, body: { success: false, code: 'profile_scope_unavailable', error: 'x' } }, /Add NAICS to your profile/, /Add at least one in Settings/],
    ['invalid filter value', { status: 400, body: { success: false, code: 'invalid_filters', reason: 'invalid_value', refused_keys: ['sapBuyer'], error: 'Invalid sapBuyer value. Do not coerce or drop the filter and save a broader watch — ask the user to adjust.' } }, /Check a filter/, /Buyer type has a value Mindy can.t save/],
    ['unsupported filter keys', { status: 400, body: { success: false, code: 'invalid_filters', reason: 'unsupported_keys', refused_keys: ['valueRange', 'office'], error: 'Unsupported filter keys: valueRange, office. Do not drop unsupported filters and activate a broader watch — ask the user to adjust.' } }, /A filter can.t be watched/, /Contract value, Buying office can.t be used in email alerts\. Remove them/],
    ['unknown NAICS', { status: 400, body: { success: false, code: 'invalid_filters', reason: 'invalid_naics', refused_keys: ['naics'], error: 'Unknown NAICS code "999999" — confirm the intended code with the user' } }, /Check the industry code/, /isn.t a recognized NAICS code/],
    ['invalid filter, legacy body without reason', { status: 400, body: { success: false, code: 'invalid_filters', error: 'Invalid sapBuyer value' } }, /A filter can.t be saved/, /Adjust your filters, then save again/],
    ['invalid mode', { status: 400, body: { success: false, code: 'invalid_mode', error: 'x' } }, /Switch to Opportunities/, /works on the Opportunities map/],
    ['missing name', { status: 400, body: { success: false, error: 'email and name are required' } }, /Name the search/, /Give this search a name/],
    ['scheduler down (503)', { status: 503, body: { success: false, code: 'scheduler_unavailable', error: 'x' } }, /Try again shortly/, /temporarily unavailable/],
    ['unexpected 500 with a message', { status: 500, body: { success: false, error: 'boom' } }, /Couldn.t save/, /Nothing was saved\..*admin@getmindy\.ai/],
    ['non-JSON error page (502)', { status: 502, nonJson: true }, /Couldn.t save/, /Nothing was saved\..*admin@getmindy\.ai/],
    ['no connection', { reject: true }, /No connection/, /Check your connection/],
  ])('%s', async (_n, reply, short, detail) => {
    const r = run({ horizons: H, reply });
    await r.settle();
    expect(r.btn.textContent).toMatch(short);
    expect(r.btn.textContent).not.toBe("Couldn't save");
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatch(detail);
    expect(r.events.some((e) => e[1] === 'watch_save_failed')).toBe(true);
    // Agent-facing server text never reaches a customer.
    expect(r.alerts[0]).not.toMatch(/ask the user|Do not (coerce|drop)|confirm the intended code|boom/i);
  });

  it('a successful save shows no error', async () => {
    const r = run({ horizons: H });
    await r.settle();
    expect(r.btn.textContent).toMatch(/Saved/);
    expect(r.alerts).toEqual([]);
  });
});

describe('P0b — map filters the alert engine cannot apply are never dropped silently', () => {
  const H: Horizons = { open: true, recompete: false, forecast: false };
  beforeEach(() => { mockFrom.mockReset(); });

  it('multi-selects are translated to the keys alerts read (same meaning as the map request)', async () => {
    const r = run({ horizons: H, filt: { naics: '541512', setAside: 'SBA', setAsideMulti: 'WOSB,SBA', noticeType: '', noticeMulti: 'Solicitation' } });
    expect(r.confirms).toEqual([]);
    expect(r.calls).toHaveLength(1);
    const f = r.calls[0].body.filters as Record<string, unknown>;
    expect(f.setAside).toBe('SBA,WOSB');
    expect(f.noticeType).toBe('Solicitation');
    expect(f).not.toHaveProperty('setAsideMulti');
    expect(f).not.toHaveProperty('noticeMulti');
    const { res } = await service(r.calls[0].body);
    expect(res.ok).toBe(true);
  });

  it('map-only filters: asks first, names them in the Filters-panel words, then saves the rest', async () => {
    // The real 2026-10-29 failure: valueRange rode along with naics/psc and refused the whole save.
    const r = run({ horizons: H, filt: { naics: '541512', psc: 'DJ01', valueRange: '-5772114', office: 'W912PL' } });
    expect(r.confirms[0]).toMatch(/can.t use Contract value, Buying office/);
    expect(r.confirms[0]).toMatch(/match the same opportunities/);
    const f = r.calls[0].body.filters as Record<string, unknown>;
    expect(f).toMatchObject({ naics: '541512', psc: 'DJ01' });
    expect(f).not.toHaveProperty('valueRange');
    expect(f).not.toHaveProperty('office');
    const { res } = await service(r.calls[0].body);
    expect(res.ok).toBe(true);
    const ev = r.events.find((e) => e[1] === 'watch_filters_excluded');
    expect(ev?.[2]).toEqual({ keys: 'valueRange,office', confirmed: true });
    expect(JSON.stringify(r.events)).not.toContain('5772114');
    expect(JSON.stringify(r.events)).not.toContain('W912PL');
  });

  it('declining the exclusion saves nothing', () => {
    const r = run({ horizons: H, filt: { naics: '541512', valueRange: '100-200' }, confirmAnswers: [false] });
    expect(r.calls).toEqual([]);
    expect(r.events.find((e) => e[1] === 'watch_filters_excluded')?.[2]).toEqual({ keys: 'valueRange', confirmed: false });
  });

  it('an unknown key still reaches the server and is refused (strict validation preserved)', async () => {
    const r = run({ horizons: H, filt: { naics: '541512', brandNewMapFilter: 'x' } });
    expect(r.calls[0].body.filters).toHaveProperty('brandNewMapFilter');
    const { res } = await service(r.calls[0].body);
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.code).toBe('invalid_filters'); expect(res.reason).toBe('unsupported_keys'); expect(res.refusedKeys).toEqual(['brandNewMapFilter']); }
  });

  it('default map: the server refuses a whole-market watch; Mindy offers the profile market and retries once', async () => {
    const r = run({
      horizons: H, filt: { setAside: 'all', strategy: [] },
      replies: [
        { status: 400, body: { success: false, code: 'invalid_filters', reason: 'no_narrowing', refused_keys: [], error: 'At least one narrowing filter is required' } },
        { status: 200, body: { success: true } },
      ],
    });
    await r.settle();
    expect(r.confirms.some((m) => /too broad to watch/.test(m) && /industries on your profile/.test(m))).toBe(true);
    expect(r.calls).toHaveLength(2);
    expect((r.calls[1].body.filters as Record<string, unknown>).scope).toBe('profile');
    expect(r.btn.textContent).toMatch(/Saved/);
    // The retry is accepted by the real service and is narrowing (scope=profile).
    const { res } = await service(r.calls[1].body);
    expect(res.ok).toBe(true);
  });

  it('default map, offer declined: plain-English guidance, no retry', async () => {
    const r = run({
      horizons: H, filt: {},
      replies: [{ status: 400, body: { success: false, code: 'invalid_filters', reason: 'no_narrowing', refused_keys: [], error: 'x' } }],
      confirmAnswers: [false],
    });
    await r.settle();
    expect(r.calls).toHaveLength(1);
    expect(r.btn.textContent).toMatch(/Narrow the map first/);
    expect(r.alerts[0]).toMatch(/Search for a word, place or agency/);
  });

  it('default map, profile has no industries: the second refusal is explained, never retried again', async () => {
    const r = run({
      horizons: H, filt: {},
      replies: [
        { status: 400, body: { success: false, code: 'invalid_filters', reason: 'no_narrowing', refused_keys: [], error: 'x' } },
        { status: 400, body: { success: false, code: 'profile_scope_unavailable', error: 'x' } },
      ],
    });
    await r.settle();
    expect(r.calls).toHaveLength(2);
    expect(r.btn.textContent).toMatch(/Add NAICS to your profile/);
  });

  it('Companies / Buyers view: Save does nothing but explain', () => {
    for (const mode of ['companies', 'buyers']) {
      const r = run({ horizons: H, mode });
      expect(r.calls).toEqual([]);
      expect(r.btn.textContent).toMatch(/Save works on Opportunities/);
    }
    expect(MAP).toContain("'body.is-network #saveSearchBtn{display:none!important}'");
  });
});

describe('P0a — a failed save records why, by key NAME only', () => {
  it('watch_save_failed carries status, code, reason and refused key names', async () => {
    const r = run({
      horizons: { open: true }, filt: { naics: '541512' },
      reply: { status: 400, body: { success: false, code: 'invalid_filters', reason: 'unsupported_keys', refused_keys: ['valueRange', 'x"<script>', 'office'], error: 'Unsupported filter keys: valueRange' } },
    });
    await r.settle();
    const ev = r.events.find((e) => e[1] === 'watch_save_failed');
    expect(ev?.[2]).toEqual({ status: 400, code: 'invalid_filters', reason: 'unsupported_keys', refused_keys: 'valueRange,office' });
  });

  it('a failure with no body records the status and empty fields', async () => {
    const r = run({ horizons: { open: true }, filt: { naics: '541512' }, reply: { reject: true } });
    await r.settle();
    expect(r.events.find((e) => e[1] === 'watch_save_failed')?.[2]).toEqual({ status: 0, code: '', reason: '', refused_keys: '' });
  });
});

describe('expired sign-in: keep the filters, ask, never switch identity silently', () => {
  const H: Horizons = { open: true, recompete: false, forecast: false };

  it('a locally expired token: nothing is sent; sign-in again resumes the SAME save', async () => {
    let expired = true;
    let resume: (() => void) | null = null;
    const r = run({
      horizons: H, filt: { naics: '541512', valueRange: '1-2' },
      win: { __tokenExpired: () => expired, openSignInModal: (_p: string, cb: () => void) => { resume = cb; } },
    });
    // map-only filter confirm, then the sign-in offer; no request yet
    expect(r.confirms[0]).toMatch(/can.t use Contract value/);
    expect(r.confirms[1]).toMatch(/sign-in has expired/);
    expect(r.calls).toEqual([]);
    expect(r.events.find((e) => e[1] === 'watch_session_expired')?.[2]).toEqual({ source: 'local', choice: 'sign_in' });
    // the person signs in; the save resumes with the same planned filters and does not re-ask about them
    expired = false;
    resume!();
    await r.settle();
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].url).toBe('/api/app/saved-searches');
    expect(r.calls[0].body.filters).toMatchObject({ naics: '541512' });
    expect(r.calls[0].body.filters).not.toHaveProperty('valueRange');
    expect(r.confirms.filter((m) => /can.t use Contract value/.test(m))).toHaveLength(1);
  });

  it('declines sign-in, explicitly chooses device-only: an anonymous watch with the same filters', async () => {
    const r = run({ horizons: H, filt: { naics: '541512', state: 'VA' }, confirmAnswers: [false, true, false], win: { __tokenExpired: () => true } });
    await r.settle();
    expect(r.confirms[1]).toMatch(/on this device only, without email alerts/);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].url).toBe('/api/app/map-watch');
    expect(r.calls[0].body).toHaveProperty('anonId');
    expect(r.calls[0].body).not.toHaveProperty('email');
    expect(r.calls[0].body.filters).toMatchObject({ naics: '541512', state: 'VA' });
  });

  it('declines both: nothing is saved', () => {
    const r = run({ horizons: H, filt: { naics: '541512' }, confirmAnswers: [false, false], win: { __tokenExpired: () => true } });
    expect(r.calls).toEqual([]);
  });

  it('a server 401 gets the same choice, and the refusal is logged', async () => {
    const r = run({ horizons: H, filt: { naics: '541512' }, reply: { status: 401, body: { success: false, error: 'Sign in required' } }, confirmAnswers: [false, false] });
    await r.settle();
    expect(r.calls).toHaveLength(1);
    expect(r.confirms.some((m) => /sign-in has expired/.test(m))).toBe(true);
    expect(r.events.find((e) => e[1] === 'watch_save_failed')?.[2]).toMatchObject({ status: 401 });
    expect(r.events.find((e) => e[1] === 'watch_session_expired')?.[2]).toEqual({ source: 'server', choice: 'declined' });
  });
});

describe('anonymous saves use the same plan and the same customer copy', () => {
  it('translates multi-selects and asks before leaving map-only filters out', () => {
    const r = run({ horizons: { open: true }, signedIn: false, filt: { naics: '541512', setAsideMulti: 'WOSB', fsc: '7030' } });
    expect(r.confirms[0]).toMatch(/DLA Supply Class/);
    const f = r.calls[0].body.filters as Record<string, unknown>;
    expect(f).toMatchObject({ naics: '541512', setAside: 'WOSB' });
    expect(f).not.toHaveProperty('fsc');
    expect(f).not.toHaveProperty('setAsideMulti');
  });
  it('a refused anonymous save explains itself (no bare "Couldn\'t save")', async () => {
    const r = run({ horizons: { open: true }, signedIn: false, filt: {}, reply: { status: 400, body: { success: false, code: 'invalid_filters', reason: 'no_narrowing', refused_keys: [], error: 'x' } } });
    await r.settle();
    expect(r.btn.textContent).toMatch(/Narrow the map first/);
  });
});

describe('the default map (Open Now + Coming Soon, nothing else) is never saved as a whole-market alert', () => {
  beforeEach(() => { mockFrom.mockReset(); });
  it('the real service refuses it as no_narrowing, and the Map offers the profile market', async () => {
    // Default map boots with all three horizons; F1 narrows the saved payload to Open + Coming Soon.
    const r = run({ horizons: { open: true, recompete: true, forecast: true }, filt: { setAside: 'all', strategy: [] } });
    const body = r.calls[0].body;
    expect((body.filters as Record<string, unknown>).horizons).toEqual({ open: true, recompete: false, forecast: true });
    const { res } = await service(body);
    expect(res.ok).toBe(false);
    if (!res.ok) { expect(res.code).toBe('invalid_filters'); expect(res.reason).toBe('no_narrowing'); }
  });
});
