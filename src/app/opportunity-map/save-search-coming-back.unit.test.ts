/**
 * F1 (Learn copy review, 2026-10-08): a signed-in "Save search" from the DEFAULT map failed.
 *
 * The map boots with every horizon on, so the handler posted horizons.recompete=true. The
 * saved-search service refuses recompete scope (`unsupported_alert_scope` — the alert cron has
 * no recompete corpus), the route answered 400, and the button said "Couldn't save". Every
 * signed-in user saving from the default map hit it.
 *
 * The server rule is correct and is NOT relaxed here. These tests EXECUTE the real handler
 * extracted from route.ts and pin the client contract:
 *   · default map → the user is told recompetes are not emailed, then a watch is saved for the
 *     emailable horizons only (recompete=false); the map's own toggles are untouched;
 *   · declining the disclosure saves nothing;
 *   · recompete-only → nothing is posted, the user is told why;
 *   · user filters, mode and viewport are preserved in the payload;
 *   · a server refusal is explained, never a bare "Couldn't save".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WATCH_SCOPE_JS } from '@/lib/saved-searches/watch-scope-client';
import { isUnsupportedAlertScope, cronWillDeliverAlerts } from '@/lib/saved-searches/alert-scope';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function handlerSource(): string {
  const a = MAP.indexOf('  if(_ss)_ss.onclick=function(){');
  const b = MAP.indexOf('  // Apply a SAVED SEARCH to the map in-place', a);
  if (a < 0 || b < 0) throw new Error('save handler markers not found');
  // Template-literal escapes → the JS the browser actually receives.
  return MAP.slice(a, b).replace(/\\\\/g, '\\');
}

type Horizons = { open?: boolean; recompete?: boolean; forecast?: boolean };

function planFn() {
  const win: Record<string, unknown> = {};
  new Function('window', WATCH_SCOPE_JS)(win);
  return win.__watchScopePlan as (m: string, h: Horizons) => {
    kind: string; comingBack: boolean; horizons: Horizons | null;
  };
}

function run(opts: {
  mode?: string;
  horizons: Horizons;
  confirmAnswer?: boolean;
  resp?: Record<string, unknown>;
}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const confirms: string[] = [];
  const prompts: string[] = [];
  const events: unknown[][] = [];
  const horizons = { ...opts.horizons };
  const win: Record<string, unknown> = {
    __horizons: horizons,
    __track: (...a: unknown[]) => events.push(a),
  };
  new Function('window', WATCH_SCOPE_JS)(win);
  win.prompt = (_m: string, d: string) => { prompts.push(d); return 'My watch'; };
  const btn: { textContent: string; innerHTML: string; title: string; onclick: null | (() => void) } =
    { textContent: 'Save search', innerHTML: '', title: '', onclick: null };
  const pending: Promise<unknown>[] = [];
  const fetchFn = (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const p = Promise.resolve({ json: () => Promise.resolve(opts.resp ?? { success: true }) });
    pending.push(p);
    return p;
  };
  const deps = {
    window: win,
    localStorage: { getItem: () => 'tok.sig' },
    _uemail: () => 'pat@example.com',
    _anonId: () => 'anon',
    _track: () => {},
    _ss: btn,
    _ssReset: () => { btn.textContent = 'Save search'; },
    _ssMsg: (t: string) => { btn.textContent = t; },
    FILT: { naics: '541512', state: 'VA', setAside: 'all' },
    Q: 'cyber',
    MODE: opts.mode ?? 'open',
    map: { getBounds: () => ({ getWest: () => -80, getSouth: () => 36, getEast: () => -75, getNorth: () => 39 }) },
    confirm: (m: string) => { confirms.push(m); return opts.confirmAnswer ?? true; },
    prompt: (m: string, d: string) => { prompts.push(d); return 'My watch'; },
    fetch: fetchFn,
    location: { href: '' },
    setTimeout: () => 0,
  };
  const names = Object.keys(deps);
  new Function(...names, handlerSource())(...names.map((n) => deps[n as keyof typeof deps]));
  btn.onclick!();
  return { calls, confirms, prompts, events, btn, horizons, settle: () => Promise.all(pending).then(() => new Promise((r) => setImmediate(r))) };
}

describe('watch scope plan', () => {
  const plan = planFn();
  it('default map (all horizons) narrows to open + forecast', () => {
    expect(plan('open', { open: true, recompete: true, forecast: true })).toEqual({
      kind: 'partial', comingBack: true, horizons: { open: true, recompete: false, forecast: true },
    });
  });
  it('no recompete → nothing to narrow', () => {
    expect(plan('open', { open: true, recompete: false, forecast: true }).kind).toBe('full');
  });
  it('recompete only, or the legacy recompete dataset → nothing emailable', () => {
    expect(plan('open', { open: false, recompete: true, forecast: false }).kind).toBe('none');
    expect(plan('recompete', { open: true, recompete: true, forecast: true }).kind).toBe('none');
  });
  it('every saveable plan is accepted by the service rule it must satisfy', () => {
    for (const h of [
      { open: true, recompete: true, forecast: true },
      { open: true, recompete: true, forecast: false },
      { open: false, recompete: true, forecast: true },
    ]) {
      const p = plan('open', h);
      expect(p.horizons).not.toBeNull();
      expect(isUnsupportedAlertScope('open', { horizons: p.horizons! })).toBe(false);
      expect(cronWillDeliverAlerts('open', { horizons: p.horizons! })).toBe(true);
    }
  });
});

describe('signed-in Save search from the default map', () => {
  it('discloses, then saves a watch without recompete — map toggles untouched', async () => {
    const r = run({ horizons: { open: true, recompete: true, forecast: true } });
    expect(r.confirms[0]).toMatch(/Recompetes are not emailed/);
    expect(r.calls).toHaveLength(1);
    const body = r.calls[0].body as { mode: string; filters: Record<string, unknown>; bbox: unknown };
    expect(r.calls[0].url).toBe('/api/app/saved-searches');
    expect(body.mode).toBe('open');
    expect(body.filters.horizons).toEqual({ open: true, recompete: false, forecast: true });
    // user-selected filters preserved; the 'all' sentinel still skipped as before
    expect(body.filters).toMatchObject({ naics: '541512', state: 'VA', q: 'cyber' });
    expect(body.filters).not.toHaveProperty('setAside');
    expect(body.bbox).toEqual({ w: -80, s: 36, e: -75, n: 39 });
    // the default name no longer claims recompetes
    expect(r.prompts[0]).toMatch(/Open \+ Forecasts$/);
    expect(r.horizons).toEqual({ open: true, recompete: true, forecast: true });
    await r.settle();
    expect(r.btn.textContent).toMatch(/Saved/);
  });

  it('declining the disclosure saves nothing', () => {
    const r = run({ horizons: { open: true, recompete: true, forecast: true }, confirmAnswer: false });
    expect(r.calls).toHaveLength(0);
    expect(r.prompts).toHaveLength(0);
  });

  it('recompete-only posts nothing and says why', () => {
    const r = run({ horizons: { open: false, recompete: true, forecast: false } });
    expect(r.calls).toHaveLength(0);
    expect(r.btn.textContent).toMatch(/Recompetes aren.t emailed/);
  });

  it('a map without recompete saves exactly as before, with no extra prompt', () => {
    const r = run({ horizons: { open: true, recompete: false, forecast: false } });
    expect(r.confirms).toHaveLength(0);
    expect((r.calls[0].body.filters as Record<string, unknown>).horizons).toEqual({ open: true, recompete: false, forecast: false });
  });

  it('a deliberate server refusal is explained, not "Couldn\'t save"', async () => {
    const r = run({
      horizons: { open: true, recompete: false, forecast: false },
      resp: { success: false, code: 'unsupported_alert_scope' },
    });
    await r.settle();
    expect(r.btn.textContent).toMatch(/Recompetes aren.t emailed/);
  });
});

describe('the server rule is not relaxed', () => {
  it('recompete scope is still refused by the service', () => {
    expect(isUnsupportedAlertScope('open', { horizons: { recompete: true } })).toBe(true);
    expect(isUnsupportedAlertScope('recompete', {})).toBe(true);
  });
});

// F3 (2026-10-10): the signed-OUT save kept Recompetes and then offered "Get alerted?" with no word that
// recompetes are never emailed. The disclosure must come BEFORE sign-in turns alerts on.
function runAnon(horizons: Horizons, confirmAnswer = true) {
  const confirms: string[] = [];
  const signIns: string[] = [];
  const win: Record<string, unknown> = {
    __horizons: { ...horizons },
    requireSignIn: (why: string) => { signIns.push(why); return false; },
  };
  new Function('window', WATCH_SCOPE_JS)(win);
  const btn: { textContent: string; innerHTML: string; title: string; onclick: null | (() => void) } =
    { textContent: 'Save search', innerHTML: '', title: '', onclick: null };
  const later: Array<() => void> = [];
  const deps = {
    window: win,
    localStorage: { getItem: () => null },
    _uemail: () => '',
    _anonId: () => 'anon:57b9d751-9451-40c8-9f3e-2b1c4d5e6f70',
    _track: () => {},
    _ss: btn,
    _ssReset: () => { btn.textContent = 'Save search'; },
    _ssMsg: (t: string) => { btn.textContent = t; },
    FILT: { naics: '541512' },
    Q: '',
    MODE: 'open',
    map: { getBounds: () => ({ getWest: () => -80, getSouth: () => 36, getEast: () => -75, getNorth: () => 39 }) },
    confirm: (m: string) => { confirms.push(m); return confirmAnswer; },
    prompt: () => null,
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ success: true, name: 'n' }) }),
    location: { href: '' },
    setTimeout: (fn: () => void) => { later.push(fn); return 0; },
  };
  const names = Object.keys(deps);
  new Function(...names, handlerSource())(...names.map((n) => deps[n as keyof typeof deps]));
  btn.onclick!();
  // Run ONE level of timers (the offer), not the follow-up reset scheduled from inside it.
  const flush = async () => { await new Promise((r) => setImmediate(r)); later.splice(0).forEach((fn) => fn()); };
  return { confirms, signIns, btn, flush };
}

describe('F3 — signed-out watch: disclosure before alerts', () => {
  it('Recompetes on: the alert offer names Open + Forecasts and says Recompetes are not emailed', async () => {
    const r = runAnon({ open: true, recompete: true, forecast: true });
    await r.flush();
    expect(r.confirms[0]).toMatch(/email alerts for Open \+ Forecasts\?/);
    expect(r.confirms[0]).toMatch(/Recompetes are not emailed/);
    expect(r.signIns).toEqual(['get alerts for this market']);
  });

  it('declining the offer never reaches sign-in', async () => {
    const r = runAnon({ open: true, recompete: true, forecast: false }, false);
    await r.flush();
    expect(r.signIns).toHaveLength(0);
  });

  it('Recompete-only: no alert is offered at all', async () => {
    const r = runAnon({ open: false, recompete: true, forecast: false });
    await r.flush();
    expect(r.confirms).toHaveLength(0);
    expect(r.signIns).toHaveLength(0);
    expect(r.btn.textContent).toMatch(/Recompetes aren.t emailed/);
  });

  it('no Recompete: the original offer, unchanged', async () => {
    const r = runAnon({ open: true, recompete: false, forecast: false });
    await r.flush();
    expect(r.confirms[0]).toBe('Watching this market. Get alerted when new opportunities match? (sign-in required so we email the right person)');
  });
});
