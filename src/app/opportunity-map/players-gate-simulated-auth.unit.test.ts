/**
 * Simulated-auth behavioral tests for __playersGate — no real MI session required.
 * Mirrors the production queue in route.ts; source-assertions keep the mirror honest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const loginModal = readFileSync(join(__dirname, 'login-modal.ts'), 'utf8');

function extractBlock(startMarker: string, endMarker: string): string {
  const start = map.indexOf(startMarker);
  expect(start, startMarker).toBeGreaterThan(-1);
  const end = map.indexOf(endMarker, start);
  expect(end, endMarker).toBeGreaterThan(start);
  return map.slice(start, end);
}

type Harness = {
  gate: (mode: string, onResume?: () => void) => void;
  flush: () => void;
  setMapModeCalls: string[];
  mapMode: string;
  modalOpens: number;
  phrases: string[];
  simulateAuthSuccess: () => void;
  simulateAuthCancel: () => void;
  getResumeCallbacks: () => Array<() => void>;
  document: Document;
};

function makeHarness(opts: {
  token?: string;
  expired?: boolean;
  miEmail?: string;
} = {}): Harness {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://getmindy.ai/opportunity-map?mode=buyers' });
  const { window } = dom;
  const store: Record<string, string> = {};
  if (opts.token) store.mi_beta_auth_token = opts.token;
  if (opts.miEmail) store.mi_beta_email = opts.miEmail;

  const setMapModeCalls: string[] = [];
  let mapMode = 'open';
  let modalOpens = 0;
  const phrases: string[] = [];
  let resumeCallbacks: Array<() => void> = [];

  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
  });

  (window as unknown as { __tokenExpired: (t: string) => boolean }).__tokenExpired = () => !!opts.expired;
  (window as unknown as { __playersUnlockHtml: () => string }).__playersUnlockHtml = () => '<div>unlock</div>';

  const setMapModeFn = (m: string) => {
    setMapModeCalls.push(m);
    mapMode = m;
  };

  const gateSlice = extractBlock('var _pgPending = null', 'window.setMapMode=function');
  // eslint-disable-next-line no-new-func
  const boot = new Function('window', 'document', 'setMapMode', 'localStorage', `${gateSlice} return { gate: window.__playersGate, flush: window.__flushPlayersGateQueue };`);
  const api = boot(window, window.document, setMapModeFn, window.localStorage) as { gate: Harness['gate']; flush: Harness['flush'] };

  const installModal = () => {
    (window as unknown as { openSignInModal: (phrase: string, cb: () => void) => void }).openSignInModal = (
      phrase: string,
      cb: () => void,
    ) => {
      modalOpens += 1;
      phrases.push(phrase);
      resumeCallbacks.push(cb);
    };
  };

  return {
    gate: api.gate,
    flush: () => {
      installModal();
      api.flush();
    },
    setMapModeCalls,
    get mapMode() { return mapMode; },
    get modalOpens() { return modalOpens; },
    phrases,
    simulateAuthSuccess: () => {
      const cbs = resumeCallbacks.splice(0);
      for (const cb of cbs) cb();
    },
    simulateAuthCancel: () => { resumeCallbacks = []; },
    getResumeCallbacks: () => resumeCallbacks,
    document: window.document,
  };
}

describe('Players gate — production source contract', () => {
  it('uses a single coalesced queue flushed when the sign-in modal becomes ready', () => {
    expect(map).toContain('var _pgPending = null');
    expect(map).toContain('window.__flushPlayersGateQueue');
    expect(map).not.toMatch(/window\.__playersGate\(mode, onResume, _defer/);
    expect(loginModal).toContain('window.__flushPlayersGateQueue');
    const signedOut = extractBlock('window.__playersGate = function', 'window.setMapMode=function');
    expect(signedOut).not.toMatch(/location\.href\s*=\s*['"]\/app/);
  });
});

describe('Players gate — simulated auth (no real session)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('deep link waits for modal readiness, then opens exactly once', () => {
    const h = makeHarness();
    h.gate('buyers', () => { /* applyScopeLink */ });
    expect(h.modalOpens).toBe(0);
    expect(h.mapMode).toBe('open');
    h.flush();
    expect(h.modalOpens).toBe(1);
    expect(h.mapMode).toBe('open');
  });

  it('successful modal callback changes mode and runs onResume exactly once', () => {
    const h = makeHarness();
    let resumeRuns = 0;
    h.gate('companies', () => { resumeRuns += 1; });
    h.flush();
    h.simulateAuthSuccess();
    expect(h.setMapModeCalls).toEqual(['companies']);
    expect(resumeRuns).toBe(1);
    expect(h.mapMode).toBe('companies');
  });

  it('company/buyer drawer resume fires once through auth', () => {
    const h = makeHarness();
    let drawerOpens = 0;
    h.gate('companies', () => { drawerOpens += 1; });
    h.flush();
    h.simulateAuthSuccess();
    h.simulateAuthSuccess();
    expect(h.setMapModeCalls).toEqual(['companies']);
    expect(drawerOpens).toBe(1);
  });

  it('cancellation keeps mode=open and does not run onResume', () => {
    const h = makeHarness();
    let resumeRuns = 0;
    h.gate('companies', () => { resumeRuns += 1; });
    h.flush();
    h.simulateAuthCancel();
    expect(h.mapMode).toBe('open');
    expect(h.setMapModeCalls).toEqual([]);
    expect(resumeRuns).toBe(0);
  });

  it('repeated Players clicks stay idempotent (one modal, latest destination)', () => {
    const h = makeHarness();
    let resumeRuns = 0;
    h.gate('buyers', () => { resumeRuns += 1; });
    h.gate('companies', () => { resumeRuns += 1; });
    h.gate('companies', () => { resumeRuns += 1; });
    h.flush();
    expect(h.modalOpens).toBe(1);
    h.simulateAuthSuccess();
    expect(h.setMapModeCalls).toEqual(['companies']);
    expect(resumeRuns).toBe(1);
  });

  it('repeated clicks while modal is open update destination without re-opening', () => {
    const h = makeHarness();
    h.gate('buyers');
    h.flush();
    expect(h.modalOpens).toBe(1);
    h.gate('companies', () => {});
    expect(h.modalOpens).toBe(1);
    h.simulateAuthSuccess();
    expect(h.setMapModeCalls).toEqual(['companies']);
  });

  it('expired-session copy differs from anonymous first-time copy', () => {
    const anon = makeHarness();
    anon.gate('companies');
    anon.flush();
    expect(anon.phrases[0]).toContain('meet the buyers behind the opportunities');

    const expiredEmail = makeHarness({ miEmail: 'user@example.com' });
    expiredEmail.gate('companies');
    expiredEmail.flush();
    expect(expiredEmail.phrases[0]).toContain('continue where you left off');

    const expiredToken = makeHarness({ token: 'a.b.c', expired: true });
    expiredToken.gate('companies');
    expiredToken.flush();
    expect(expiredToken.phrases[0]).toContain('continue where you left off');
    expect(expiredToken.phrases[0]).not.toContain('meet the buyers behind the opportunities');
  });

  it('timeout leaves the map unchanged and shows a recoverable message (never /app)', () => {
    const h = makeHarness();
    h.gate('buyers');
    expect(h.modalOpens).toBe(0);
    vi.advanceTimersByTime(6000);
    expect(h.modalOpens).toBe(0);
    expect(h.mapMode).toBe('open');
    expect(h.setMapModeCalls).toEqual([]);
    expect(h.document.getElementById('playersGateNotice')?.textContent).toMatch(/Try Players again/i);
  });

  it('uses only one wait timer chain per pending destination', () => {
    const h = makeHarness();
    const spy = vi.spyOn(global, 'setTimeout');
    h.gate('buyers');
    h.gate('companies');
    h.gate('buyers');
    const waitTimers = spy.mock.calls.filter((c) => c[1] === 6000);
    expect(waitTimers.length).toBe(1);
    spy.mockRestore();
  });
});
