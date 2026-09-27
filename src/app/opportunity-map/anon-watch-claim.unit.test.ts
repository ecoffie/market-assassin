/**
 * P0-F (Learn repair board, 2026-09-26): an anonymous watch must be claimable after sign-in.
 *
 * `window.__claimAnonWatches` lives in SAVE_JS but called `_uemail()`, `_anonId()`, `_track()`
 * and `_ss/_ssMsg/_ssReset` — all private to the VIEWPORT_JS IIFE. It threw a ReferenceError
 * on its first statement, so "turn on alerts" after an anonymous save never claimed anything.
 * Production 2026-09-26: 37 `anon:` watches unclaimed, 0 `watch_claimed` events ever.
 *
 * These tests EXECUTE the claim extracted from route.ts together with ONLY the SAVE_JS
 * helpers it may legitimately use — so any out-of-scope identifier is a ReferenceError here,
 * exactly as it is in the browser.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function slice(start: string, end: string, from = 0) {
  const a = MAP.indexOf(start, from);
  if (a < 0) throw new Error(`marker not found: ${start}`);
  const b = MAP.indexOf(end, a);
  if (b < 0) throw new Error(`end marker not found: ${end}`);
  return MAP.slice(a, b).replace(/\\\\/g, '\\');
}

const SAVE_START = MAP.indexOf('const SAVE_JS = `<script>');
// SAVE_JS's own identity helpers (tok / decodeEmail / email) and its anon-id accessor.
const HELPERS =
  slice('  function tok(){', '  // THE flywheel gate', SAVE_START) +
  slice('  function _anonKey(){', '\n', SAVE_START) + '\n';
const CLAIM = slice("  window.__claimAnonWatches=function(){", '  // ── RESTORE', SAVE_START);

const ANON = '3f2b8c1e-7a4d-4b8e-9c1f-2a6d5e8b7c90';
const token = (email: string) =>
  `${Buffer.from(JSON.stringify({ email })).toString('base64').replace(/=+$/, '')}.sig`;

function run(opts: { signedIn: boolean; anonId?: string; resp?: unknown; ok?: boolean }) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const events: unknown[][] = [];
  const ui: string[] = [];
  const store: Record<string, string> = opts.signedIn ? { mi_beta_auth_token: token('pat@example.com') } : {};
  const win: Record<string, unknown> = {
    __anonId: () => opts.anonId ?? ANON,
    __track: (...a: unknown[]) => { events.push(a); },
    __ssMsg: (m: string) => ui.push(`msg:${m}`),
    __ssReset: () => ui.push('reset'),
  };
  const fetchFn = (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return Promise.resolve({ ok: opts.ok ?? true, json: () => Promise.resolve(opts.resp ?? { success: true, claimed: 1 }) });
  };
  const fn = new Function('window', 'localStorage', 'fetch', 'atob', `${HELPERS}\n${CLAIM}\nreturn window.__claimAnonWatches;`);
  const claim = fn(win, { getItem: (k: string) => store[k] ?? null }, fetchFn, (s: string) => Buffer.from(s, 'base64').toString('binary'));
  return { claim: claim as () => void, calls, events, ui };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the claim runs in SAVE_JS scope', () => {
  it('does not throw (it was a ReferenceError on its first statement)', () => {
    const h = run({ signedIn: true });
    expect(() => h.claim()).not.toThrow();
  });

  it('posts the anon id with the session token; identity comes from the token, not a body email', async () => {
    const h = run({ signedIn: true });
    h.claim(); await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe('/api/app/map-watch');
    expect(h.calls[0].body).toEqual({ action: 'claim', anonId: ANON });
    expect(h.calls[0].headers['x-mi-auth-token']).toBe(token('pat@example.com'));
  });

  it('a verified claim fires watch_claimed and says Alerts on', async () => {
    const h = run({ signedIn: true, resp: { success: true, claimed: 2 } });
    h.claim(); await flush(); await flush();
    expect(h.events).toEqual([['tool_use', 'watch_claimed', { watches: 2 }]]);
    expect(h.ui).toEqual(['msg:✓ Alerts on']);
  });

  it('claiming nothing (or a refusal) fires no event and claims no success', async () => {
    for (const resp of [{ success: true, claimed: 0 }, { success: false, error: 'Unauthorized' }]) {
      const h = run({ signedIn: true, resp, ok: resp.success });
      h.claim(); await flush(); await flush();
      expect(h.events).toHaveLength(0);
      expect(h.ui).toEqual(['reset']);
    }
  });

  it('signed out, or no anon id in this browser: sends nothing', async () => {
    for (const h of [run({ signedIn: false }), run({ signedIn: true, anonId: '' })]) {
      h.claim(); await flush();
      expect(h.calls).toHaveLength(0);
    }
  });
});

describe('the Save-search UI hooks the claim needs are exported', () => {
  it('VIEWPORT_JS exports __ssMsg and __ssReset', () => {
    expect(MAP).toMatch(/window\.__ssMsg=_ssMsg; window\.__ssReset=_ssReset;/);
  });
});
