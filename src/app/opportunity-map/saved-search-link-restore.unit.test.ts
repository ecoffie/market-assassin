/**
 * The saved-search email → Map journey (reported 2026-10-04).
 *
 * The October 3 alert "3 new matches in Atlantic Craft Partners JV — Navy Shipbuilding & Small
 * Craft" linked to /opportunity-map?ss=6e376442-…&src=saved_search_alert and promised "Your
 * filters are restored exactly as you saved them." The map opened UNFILTERED.
 *
 * ROOT CAUSE (measured on the serving page, 657801d8): the ?ss= handler lives in BOOT_VIEW_JS
 * (its own <script>) and waited for `typeof _uemail === 'function'` — but _uemail is declared
 * inside the VIEWPORT_JS IIFE, a different <script>. From the handler's block it never exists,
 * so it retried 40× and returned silently, for signed-in AND signed-out visitors. No saved
 * search was ever requested from 2026-08-13 (when the handler shipped) until this fix.
 *
 * These tests EXECUTE the handler extracted from route.ts with ONLY window-level globals in
 * scope — exactly what another <script> block can see — so a reference to another block's
 * private helper fails here the way it fails in the browser. The session helper and the
 * expiry check are the REAL ones, extracted from their own blocks.
 *
 * RED → GREEN: MAPS_ROUTE_SRC=<(git show 657801d8:src/app/opportunity-map/route.ts) fails the
 * signed-in, delayed-auth, refresh and failure-state cases; the current route passes them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(process.env.MAPS_ROUTE_SRC || join(__dirname, 'route.ts'), 'utf8');
/** The browser runs the template-literal text: backslashes are doubled in the TS source. */
const unT = (s: string) => s.replace(/\\\\/g, '\\');

function between(start: string, end: string, from = 0): string {
  const a = SRC.indexOf(start, from);
  if (a < 0) throw new Error(`marker not found: ${start}`);
  const b = SRC.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`end marker not found: ${end}`);
  return SRC.slice(a, b);
}

/** The ?ss= IIFE, from its own `(function(){ try{` to the next deep-link block. */
function ssHandler(): string {
  const at = SRC.indexOf("var m=(location.search||'').match(/[?&]ss=([^&]+)/)");
  if (at < 0) throw new Error('?ss= handler not found');
  const start = SRC.lastIndexOf('(function(){ try{', at);
  const end = SRC.indexOf('  // Deep-link: scope params', at);
  return unT(SRC.slice(start, end));
}

/** SAVE_JS's identity helpers + window.__mapSession (absent on the pre-fix route). */
function sessionHelpers(): string {
  const saveAt = SRC.indexOf('const SAVE_JS = `<script>');
  const helpers = between('  function tok(){', '  // THE flywheel gate', saveAt);
  return unT(helpers);
}
const TOKEN_EXPIRED = unT(between('  window.__tokenExpired = function(tk){', '  // A stable per-browser id'));

const SS_ID = '6e376442-819e-420f-b149-ef62861814ca';
const EMAIL_LINK = `?ss=${SS_ID}&src=saved_search_alert`;
const ROW = {
  id: SS_ID,
  user_email: 'reader@example.test',
  name: 'Atlantic Craft Partners JV — Navy Shipbuilding & Small Craft',
  mode: 'open',
  filters: { naics: '336611,336612', agency: 'DEFENSE', status: 'active' },
  bbox: null,
};
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenFor = (email: string, expMs: number) => `${b64u({ email, exp: expMs })}.sig`;

type Resp = { status: number; body: unknown } | 'network' | 'hang';

/** A tiny DOM: enough for the status pill (create / append / find by id / remove). */
function makeDom() {
  const byId: Record<string, FakeEl> = {};
  class FakeEl {
    id = ''; children: FakeEl[] = []; attrs: Record<string, string> = {}; style: Record<string, string> = {};
    textContent = ''; className = ''; type = ''; onclick: null | (() => void) = null; parent: FakeEl | null = null;
    constructor(public tag: string) {}
    set innerHTML(_v: string) { this.children = []; }
    setAttribute(k: string, v: string) { this.attrs[k] = v; if (k === 'id') this.id = v; }
    getAttribute(k: string) { return this.attrs[k] ?? null; }
    appendChild(c: FakeEl) { c.parent = this; this.children.push(c); if (c.id) byId[c.id] = c; return c; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); if (this.id) delete byId[this.id]; }
    get text(): string { return [this.textContent, ...this.children.map((c) => c.text)].join(' ').trim(); }
  }
  const body = new FakeEl('body');
  const document = {
    body,
    createElement: (t: string) => new FakeEl(t),
    getElementById: (id: string) => byId[id] || null,
    querySelector: (sel: string) => (sel === '.mapwrap' ? body : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const pill = () => byId.ssPill || null;
  const state = () => pill()?.getAttribute('data-state') || null;
  const actions = () => (pill()?.children || []).filter((c) => c.className === 'ss-act').map((c) => c.getAttribute('data-act'));
  const click = (act: string) => (pill()?.children || []).find((c) => c.getAttribute('data-act') === act)?.onclick?.();
  return { document, pill, state, actions, click };
}

interface Harness {
  win: Record<string, unknown> & { __ssPending?: boolean; __ssOwnsView?: boolean; __ssDeferredRound?: boolean };
  store: Record<string, string>;
  fetches: { url: string; headers: Record<string, string> }[];
  applied: { ss: unknown; opts: unknown }[];
  refetches: unknown[];
  modal: string[];
  events: unknown[][];
  storageListeners: ((e: { key: string; newValue: string }) => void)[];
  dom: ReturnType<typeof makeDom>;
  respond: Resp[];
  run: () => void;
}

function harness(opts: { search?: string; token?: string | null; respond?: Resp[]; restorerLate?: boolean } = {}): Harness {
  const store: Record<string, string> = {};
  if (opts.token) store.mi_beta_auth_token = opts.token;
  const fetches: Harness['fetches'] = [];
  const applied: Harness['applied'] = [];
  const refetches: unknown[] = [];
  const modal: string[] = [];
  const events: unknown[][] = [];
  const storageListeners: Harness['storageListeners'] = [];
  const dom = makeDom();
  const respond: Resp[] = opts.respond ? [...opts.respond] : [{ status: 200, body: { success: true, search: ROW } }];
  const localStorage = { getItem: (k: string) => (k in store ? store[k] : null), setItem: (k: string, v: string) => { store[k] = v; } };
  const location = { search: opts.search ?? EMAIL_LINK, pathname: '/opportunity-map', href: '' };
  const win: Harness['win'] = {
    __track: (...a: unknown[]) => { events.push(a); },
    __mapRefetch: (o: unknown) => { refetches.push(o); },
    openSignInModal: (phrase: string) => { modal.push(phrase); },
    addEventListener: (type: string, fn: Harness['storageListeners'][number]) => { if (type === 'storage') storageListeners.push(fn); },
    __mapIntentSig: () => 'sig-after-restore',
  };
  const restorer = (ss: unknown, o: unknown) => { applied.push({ ss, opts: o }); return { unsupported: [] }; };
  if (!opts.restorerLate) win.__applySavedSearch = restorer;
  // Boot sets the hold BEFORE the handler runs (BOOT_VIEW_JS top) — taken from the real source,
  // so a route without the hold has none here either.
  const hold = SRC.match(/  window\.__ssPending=[^\n]*\n  window\.__ssOwnsView=window\.__ssPending;\n/);
  // eslint-disable-next-line no-new-func
  if (hold) new Function('window', 'location', unT(hold[0]))(win, location);
  const fetchFn = (url: string, init: { headers: Record<string, string> }) => {
    fetches.push({ url, headers: init.headers });
    const r = respond.length > 1 ? respond.shift()! : respond[0];
    if (r === 'hang') return new Promise(() => {});
    if (r === 'network') return Promise.reject(new Error('offline'));
    return Promise.resolve({ status: r.status, ok: r.status >= 200 && r.status < 300, json: () => Promise.resolve(r.body) });
  };
  const atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
  // Block 1: SAVE_JS helpers (exports window.__mapSession). Block 2: VIEWPORT's __tokenExpired.
  // Block 3: the ?ss= handler. Each sees ONLY window globals, never another block's locals.
  const block = (code: string) =>
    // eslint-disable-next-line no-new-func
    new Function('window', 'localStorage', 'location', 'document', 'fetch', 'atob', 'setTimeout', 'clearTimeout', code)(
      win, localStorage, location, dom.document, fetchFn, atob, setTimeout, clearTimeout,
    );
  block(sessionHelpers());
  block(TOKEN_EXPIRED);
  if (opts.restorerLate) setTimeout(() => { win.__applySavedSearch = restorer; }, 900);
  return { win, store, fetches, applied, refetches, modal, events, storageListeners, dom, respond, run: () => block(ssHandler()) };
}

const live = () => tokenFor('reader@example.test', Date.now() + 3600_000);
const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('signed in — the exact email link', () => {
  it('requests THAT search by id with the session, and applies it through the shared restorer', async () => {
    const h = harness({ token: live() });
    h.run();
    expect(h.dom.state()).toBe('loading');                      // visible from the first frame
    await settle(200);
    expect(h.fetches).toHaveLength(1);
    expect(h.fetches[0].url).toBe(`/api/app/saved-searches?email=reader%40example.test&id=${SS_ID}`);
    expect(h.fetches[0].headers['x-mi-auth-token']).toBe(h.store.mi_beta_auth_token);
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0].ss).toEqual(ROW);
    expect(h.applied[0].opts).toEqual({ savedSearch: true });   // saved-search semantics, not a scope link
    expect(h.dom.state()).toBe('applied');
    expect(h.dom.pill()!.text).toContain('Atlantic Craft Partners JV');
    expect(h.dom.pill()!.text).toContain('nationwide');            // bbox:null is NOT "this view"
    expect(h.win.__ssPending).toBe(false);
    expect(h.events).toContainEqual(['tool_use', 'saved_search_link', expect.objectContaining({ outcome: 'applied', src: 'saved_search_alert' })]);
  });

  it('holds boot round 1 and the viewport for the restore, then hands round 1 to the saved market', async () => {
    const h = harness({ token: live(), respond: ['hang'] });
    h.run();
    expect(h.win.__ssPending).toBe(true);
    expect(h.win.__ssOwnsView).toBe(true);                       // map-home / geolocation must not move it
    h.win.__ssDeferredRound = true;                               // boot released while we were loading
    expect(h.refetches).toHaveLength(0);                          // ...and did NOT paint the default
  });

  it('a refresh of the same URL restores again (nothing consumes the link)', async () => {
    for (let i = 0; i < 2; i++) {
      const h = harness({ token: live() });
      h.run(); await settle(200);
      expect(h.applied).toHaveLength(1);
    }
  });

  it('waits for a restorer that is defined late (block order / slow parse)', async () => {
    const h = harness({ token: live(), restorerLate: true });
    h.run(); await settle(1500);
    expect(h.applied).toHaveLength(1);
  });
});

describe('signed out, then signed in', () => {
  it('never fetches, says the map is not filtered, and offers sign-in', async () => {
    const h = harness({ token: null });
    h.run(); await settle(200);
    expect(h.fetches).toHaveLength(0);
    expect(h.applied).toHaveLength(0);
    expect(h.dom.state()).toBe('signin');
    expect(h.dom.pill()!.text).toMatch(/isn.t filtered yet/);
    expect(h.dom.actions()).toEqual(['signin', 'dismiss']);
    expect(h.win.__ssPending).toBe(false);                        // the default map is allowed to load...
    h.dom.click('signin');
    expect(h.modal).toEqual(['open your saved search']);          // ...and the reader can recover
  });

  it('resumes when authentication arrives later (another tab writes the token)', async () => {
    const h = harness({ token: null });
    h.run(); await settle(200);
    expect(h.fetches).toHaveLength(0);
    h.store.mi_beta_auth_token = live();
    h.storageListeners.forEach((fn) => fn({ key: 'mi_beta_auth_token', newValue: h.store.mi_beta_auth_token }));
    await settle(200);
    expect(h.fetches).toHaveLength(1);
    expect(h.applied).toHaveLength(1);
    expect(h.dom.state()).toBe('applied');
  });

  it('the in-page sign-in keeps ?ss= — the modal reloads THIS url (no callback overrides it)', async () => {
    const h = harness({ token: null });
    h.run(); await settle(200);
    h.dom.click('signin');
    // openSignInModal(phrase) with no resume → the modal's default resume is location.reload()
    expect(h.modal).toEqual(['open your saved search']);
  });
});

describe('expired session', () => {
  it('a token past its exp is not sent; the reader is asked to sign in again', async () => {
    const h = harness({ token: tokenFor('reader@example.test', Date.now() - 1000) });
    h.run(); await settle(200);
    expect(h.fetches).toHaveLength(0);
    expect(h.dom.state()).toBe('expired');
    expect(h.dom.actions()).toContain('signin');
  });

  it('a session the SERVER rejects (401) is treated as expired, not as "not found"', async () => {
    const h = harness({ token: live(), respond: [{ status: 401, body: { success: false, error: 'Two-factor session expired' } }] });
    h.run(); await settle(200);
    expect(h.applied).toHaveLength(0);
    expect(h.dom.state()).toBe('expired');
  });
});

describe('missing, foreign and failed lookups never present the default as the saved search', () => {
  it('deleted or another account\'s id (404) → a clear message with recovery actions', async () => {
    const h = harness({ token: live(), respond: [{ status: 404, body: { success: false, code: 'not_found' } }] });
    h.run(); await settle(200);
    expect(h.applied).toHaveLength(0);
    expect(h.dom.state()).toBe('not_found');
    expect(h.dom.pill()!.text).toContain('reader@example.test');   // which account looked
    expect(h.dom.actions()).toEqual(['saved', 'switch', 'dismiss']);
    expect(h.win.__ssPending).toBe(false);
  });

  it('a 200 whose body is not the requested search is not applied', async () => {
    const h = harness({ token: live(), respond: [{ status: 200, body: { success: true, search: { ...ROW, id: 'someone-else' } } }] });
    h.run(); await settle(200);
    expect(h.applied).toHaveLength(0);
    expect(h.dom.state()).toBe('error');
  });

  it('a 5xx or a network failure says so and offers a retry that works', async () => {
    const h = harness({ token: live(), respond: ['network', { status: 200, body: { success: true, search: ROW } }] });
    h.run(); await settle(200);
    expect(h.dom.state()).toBe('error');
    expect(h.dom.pill()!.text).toMatch(/isn.t filtered/);
    h.dom.click('retry'); await settle(200);
    expect(h.applied).toHaveLength(1);
    expect(h.dom.state()).toBe('applied');
  });

  it('a lookup that never answers releases the map at 8 s and fails visibly at 15 s', async () => {
    const h = harness({ token: live(), respond: ['hang'] });
    h.run();
    h.win.__ssDeferredRound = true;
    await settle(8100);
    expect(h.win.__ssPending).toBe(false);
    expect(h.refetches).toEqual([{ system: true }]);            // the deferred boot round finally runs
    expect(h.dom.state()).toBe('slow');                        // ...under a pill that says it is NOT filtered
    expect(h.dom.pill()!.text).toMatch(/isn.t filtered yet/);
    expect(h.dom.pill()!.text).not.toContain('Atlantic');      // never the saved search's name
    await settle(7000);
    expect(h.dom.state()).toBe('error');
  });
});

describe('ordinary map entry is untouched', () => {
  it('no ?ss= → no fetch, no pill, no hold', async () => {
    const h = harness({ search: '?opp=abc', token: live() });
    h.run(); await settle(200);
    expect(h.fetches).toHaveLength(0);
    expect(h.dom.pill()).toBeNull();
    expect(h.win.__ssPending).toBeFalsy();
  });
});
