/**
 * window.__proGate — the map's client lock for Pro features (owner decision 2026-11-13):
 * Players, M-Win, Save to CRM and the proposal workspace. Executes the REAL block from route.ts.
 * The server is the authority (every gated endpoint returns 402); this is the friendly front.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function gateSource(): string {
  const start = map.indexOf('  window.__proState = ');
  const end = map.indexOf('  window.__playersUnlockHtml = function(){');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // The block sits inside a TS template literal: undo its one level of escaping.
  return map.slice(start, end).replace(/\\\\/g, '\\');
}

async function boot(opts: { token?: string; me?: Record<string, unknown> | null; meStatus?: number }) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://getmindy.ai/opportunity-map' });
  const w = dom.window as unknown as Record<string, unknown> & Window;
  const store: Record<string, string> = {};
  if (opts.token) store.mi_beta_auth_token = opts.token;
  Object.defineProperty(w, 'localStorage', { value: { getItem: (k: string) => store[k] ?? null, setItem() {}, removeItem() {} } });
  const tracked: Array<[string, string, unknown]> = [];
  w.__track = (a: string, b: string, c: unknown) => { tracked.push([a, b, c]); };
  const signIns: Array<() => void> = [];
  w.openSignInModal = (_p: string, cb: () => void) => { signIns.push(cb); };
  const fetchCalls: string[] = [];
  const fetchFn = vi.fn(async (u: string) => {
    fetchCalls.push(u);
    const status = opts.meStatus ?? 200;
    return { ok: status === 200, status, json: async () => opts.me ?? null } as unknown as Response;
  });
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'localStorage', 'fetch', 'location', gateSource())(w, w.document, w.localStorage, fetchFn, w.location);
  await new Promise((r) => setTimeout(r, 0));
  return { w, tracked, signIns, fetchCalls, store };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('__proGate', () => {
  it('Pro (or Team / trial / staff — proFeatures:true) → onAllowed, no lock', async () => {
    const { w } = await boot({ token: 'p.s', me: { plan: 'pro', proFeatures: true } });
    let ran = 0;
    (w.__proGate as (f: string, ok: () => void) => void)('Players', () => { ran += 1; });
    await flush();
    expect(ran).toBe(1);
    expect(w.document.getElementById('proLock')).toBeNull();
  });

  it('signed-in FREE → the lock with the trial button, tracked, and onAllowed never runs', async () => {
    const { w, tracked } = await boot({ token: 'p.s', me: { plan: 'free', proFeatures: false } });
    let ran = 0, denied = 0;
    (w.__proGate as (f: string, ok: () => void, no: () => void) => void)('Players', () => { ran += 1; }, () => { denied += 1; });
    await flush();
    expect(ran).toBe(0);
    expect(denied).toBe(1);
    const lock = w.document.getElementById('proLock');
    expect(lock).not.toBeNull();
    expect(lock!.textContent).toContain('🔒 Players is a Mindy Pro feature');
    const cta = lock!.querySelector('a') as HTMLAnchorElement;
    expect(cta.textContent).toBe('Start 14-day free trial');
    expect(cta.getAttribute('href')).toBe('/pricing');
    expect(lock!.textContent).toContain('Maybe later');
    expect(tracked).toContainEqual(['tool_use', 'pro_gate_shown', { feature: 'Players' }]);
    cta.onclick?.(new w.MouseEvent('click') as unknown as MouseEvent);
    expect(tracked).toContainEqual(['link_click', 'pro_gate_trial_click', { feature: 'Players' }]);
  });

  it('"Maybe later" closes the lock', async () => {
    const { w } = await boot({ token: 'p.s', me: { proFeatures: false } });
    (w.__proGate as (f: string) => void)('M-Win');
    await flush();
    const btn = w.document.querySelector('#proLock button') as HTMLButtonElement;
    btn.click();
    expect(w.document.getElementById('proLock')).toBeNull();
  });

  it('signed out → the sign-in modal first, then the plan is rechecked', async () => {
    const env = await boot({ me: { proFeatures: false } });
    let ran = 0;
    (env.w.__proGate as (f: string, ok: () => void) => void)('Save to CRM', () => { ran += 1; });
    expect(env.signIns).toHaveLength(1);
    expect(env.fetchCalls).toHaveLength(0);
    env.store.mi_beta_auth_token = 'p.s';
    env.signIns[0]();
    await flush(); await flush();
    expect(ran).toBe(0);
    expect(env.w.document.getElementById('proLock')).not.toBeNull();
  });

  it('an unreadable plan lets the click through — the server 402 is the authority', async () => {
    const { w } = await boot({ token: 'p.s', meStatus: 500 });
    let ran = 0;
    (w.__proGate as (f: string, ok: () => void) => void)('Proposal workspace', () => { ran += 1; });
    await flush();
    expect(ran).toBe(1);
  });

  it('every Pro feature on the map is wired through the gate', () => {
    expect(map).toMatch(/window\.__proGate\('Players'/);
    expect(map).toMatch(/window\.__proGate\('Save to CRM'/);
    expect(map).toMatch(/window\.__proGate\('Proposal workspace'/);
    expect(map).toMatch(/res\.reason==='pro_required'/);              // M-Win teaser
    expect(map).toContain('See your fit score \\\\u2014 Pro');
    expect(map).toMatch(/r\.status===402\)_proLocked=true/);           // Players fallback lock
  });
});
