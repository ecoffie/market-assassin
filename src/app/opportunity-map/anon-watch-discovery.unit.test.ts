/**
 * Option A (2026-10-10): a signed-out visitor can FIND the watches this browser saved.
 * Before: Watchlist said "Please sign in" and the watch was unreachable — 117 anonymous watches on prod.
 *
 * Executes the real signed-out Watchlist branch (saved/route.ts) and pins the signed-out ?ss= path
 * (route.ts). Fakes: fetch and storage (SIMULATED, not production acceptance).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SAVED = readFileSync(join(process.cwd(), 'src/app/opportunity-map/saved/route.ts'), 'utf8');
const MAP = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');
const AID = 'anon:3f2b8c1e-7a4d-4b8e-9c1f-2a6d5e8b7c90';

// The signed-out branch, as the browser receives it (template-literal escapes resolved).
const BRANCH = (() => {
  const a = SAVED.indexOf('  if(!t||!em){');
  const b = SAVED.indexOf('  function hdrs()', a);
  return SAVED.slice(a, b).replace(/\\\\/g, '\\');
})();

async function render(opts: { aid?: string | null; resp?: unknown; fail?: boolean }) {
  const body = { innerHTML: '' };
  const calls: string[] = [];
  const fetchFn = (url: string) => { calls.push(url); return opts.fail ? Promise.reject(new Error('x')) : Promise.resolve({ json: () => Promise.resolve(opts.resp) }); };
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
  const ls = { getItem: (k: string) => (k === 'mindy_anon_id' ? opts.aid ?? null : null) };
  new Function('t', 'em', 'bodyEl', 'esc', 'fetch', 'localStorage', `(function(){${BRANCH}})();`)(null, '', body, esc, fetchFn, ls);
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
  return { html: body.innerHTML, calls };
}

describe('signed-out Watchlist lists this browser’s watches', () => {
  it('shows each watch, its horizons, "Alerts off" and an Open-on-map link', async () => {
    const r = await render({ aid: AID, resp: { success: true, watches: [
      { id: 'w1', name: 'MINDY AUDIT TEST roofing', filters: { horizons: { open: true, recompete: false, forecast: true } } },
    ] } });
    expect(r.calls).toEqual([`/api/app/map-watch?anonId=${encodeURIComponent(AID)}`]);
    expect(r.html).toContain('Saved on this browser');
    expect(r.html).toContain('MINDY AUDIT TEST roofing');
    expect(r.html).toContain('Open Now · Coming Soon · Alerts off');
    expect(r.html).toContain('href="/opportunity-map?ss=w1"');
  });
  it('says honestly what happens on sign-in and what cannot be recovered', async () => {
    const r = await render({ aid: AID, resp: { success: true, watches: [{ id: 'w1', name: 'x', filters: {} }] } });
    expect(r.html).toMatch(/move over with alerts still off/);
    expect(r.html).toMatch(/If this browser’s data is cleared before you sign in, Mindy can’t tell they were yours and can’t recover them/);
  });
  it('escapes names', async () => {
    const r = await render({ aid: AID, resp: { success: true, watches: [{ id: 'w1', name: '<img src=x>', filters: {} }] } });
    expect(r.html).not.toContain('<img src=x>');
  });
  it('no stored anon id (or none saved): the original sign-in prompt, no request', async () => {
    for (const aid of [null, 'garbage']) {
      const r = await render({ aid });
      expect(r.calls).toHaveLength(0);
      expect(r.html).toContain('to see your Morning Brief');
    }
    const none = await render({ aid: AID, resp: { success: true, watches: [] } });
    expect(none.html).toContain('to see your Morning Brief');
  });
  it('a failed request is shown as a failure, never as "nothing saved"', async () => {
    const r = await render({ aid: AID, fail: true });
    expect(r.html).toMatch(/Couldn’t load the searches saved on this browser/);
  });
});

describe('signed-out ?ss= opens a watch only when THIS browser owns it', () => {
  const block = MAP.slice(MAP.indexOf("        // SIGNED OUT: a watch this BROWSER saved"), MAP.indexOf('        if(sess.expired){ waitForAuth(); return failExpired(); }'));
  it('asks the server with the stored anon id and the watch id together', () => {
    expect(block).toContain("localStorage.getItem('mindy_anon_id')");
    expect(block).toContain("fetch('/api/app/map-watch?anonId='+encodeURIComponent(aid)+'&id='+encodeURIComponent(wantId))");
  });
  it('without a stored anon id, or when the watch is not this browser’s, it still asks to sign in', () => {
    expect(block).toMatch(/if\(!\/\^anon:\[0-9a-f-\]\{36\}\$\/i\.test\(aid\)\)\{ waitForAuth\(\); return failSignin\(\); \}/);
    expect(block).toMatch(/if\(!w\|\|String\(w\.id\)!==wantId\)\{ waitForAuth\(\); return failSignin\(\); \}/);
  });
  it('the page-load safety net never mints an anon id and never opts into alerts', () => {
    const net = MAP.slice(MAP.indexOf('  // Safety net for sessions'), MAP.indexOf('  // ── RESTORE'));
    expect(net).toContain("aid=localStorage.getItem('mindy_anon_id')||''");
    expect(net).not.toContain('_anonKey()');
    expect(net).toContain('window.__claimAnonWatches();');
  });
});

describe('Learn B5 says what really happens', () => {
  it('kept on this browser, Watchlist, alerts off on sign-in, the recovery limit', () => {
    const missions = readFileSync(join(process.cwd(), 'src/lib/learn/missions.ts'), 'utf8');
    expect(missions).toMatch(/find it under Watchlist\. When you sign in it moves to your account with alerts still off/);
    expect(missions).toMatch(/can\\u2019t recover it/);
  });
});
