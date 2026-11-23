/**
 * An old `/opportunity-map` bookmark must not leave a SIGNED-IN customer on the standalone map (its own
 * top bar + icon rail, no app sidebar). It sends them to the same view in the app, `/app?panel=map&…`
 * (call 2026-11-23: a paying customer kept landing on the standalone map and read it as an older
 * version). Signed-out visitors, crawlers, `?embed=` and the app's own `?shell=app` frame are untouched.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { SIGNED_IN_APP_REDIRECT_JS, applySignedInAppRedirect, isStandaloneMapRequest } from './app-shell';
import { appUrlForMapUrl } from '@/lib/app/map-shell';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const u = (s: string) => new URL(`https://getmindy.ai${s}`);

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Run the inline script in a fake browser; returns the URL it navigated to, or null. */
function run(opts: { token?: string | null; framed?: boolean; search?: string; hash?: string }): string | null {
  const js = SIGNED_IN_APP_REDIRECT_JS.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  let went: string | null = null;
  const win: Record<string, unknown> = {};
  win.self = win;
  win.top = opts.framed ? {} : win;
  runInNewContext(js, {
    window: win,
    localStorage: { getItem: (k: string) => (k === 'mi_beta_auth_token' ? opts.token ?? null : null) },
    location: { search: opts.search ?? '', hash: opts.hash ?? '', replace: (h: string) => { went = h; } },
    atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
    decodeURIComponent,
  });
  return went;
}

const live = `${b64url({ email: 'a@example.com', exp: Date.now() + 3_600_000 })}.sig`;
const expired = `${b64url({ email: 'a@example.com', exp: Date.now() - 1000 })}.sig`;

describe('the inline redirect script', () => {
  it('signed in, top window, bare bookmark → /app?panel=map', () => {
    expect(run({ token: live })).toBe('/app?panel=map');
  });

  it('builds the SAME /app address as appUrlForMapUrl (map params verbatim)', () => {
    for (const search of [
      '?opp=abc123&src=share&sh=11111111-2222-3333-4444-555555555555',
      '?naics=541512&state=VA&q=cyber%20ops',
      '?ss=abc&mode=recompete',
      '?q=a%26b&panel=dashboard&mview=pursuits',
      '?q=x+y&agency=Department%20of%20the%20Navy',
    ]) {
      expect(run({ token: live, search })).toBe(appUrlForMapUrl('map', search));
    }
  });

  it('keeps the hash', () => {
    expect(run({ token: live, search: '?opp=abc', hash: '#x' })).toBe('/app?panel=map&opp=abc#x');
  });

  it('signed out, expired, unreadable token, or framed → stays on the map', () => {
    expect(run({ token: null })).toBeNull();
    expect(run({ token: expired })).toBeNull();
    expect(run({ token: 'not-a-jwt' })).toBeNull();
    expect(run({ token: live, framed: true })).toBeNull();
  });

  it('only reads the session — never writes or clears it', () => {
    expect(SIGNED_IN_APP_REDIRECT_JS).not.toMatch(/setItem|removeItem|clear\(|document\.cookie/);
  });
});

describe('applySignedInAppRedirect', () => {
  const page = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';

  it('standalone map: injected first in <head>, identical for every query (Share Truth)', () => {
    const a = applySignedInAppRedirect(page, u('/opportunity-map?opp=abc'));
    const b = applySignedInAppRedirect(page, u('/opportunity-map?opp=abc&src=share&sh=x'));
    expect(a).toContain('<head><script id="mp-app-redirect">');
    expect(a).toBe(b);
  });

  it('the app frame (?shell=app) and the static hero (?embed=) are byte-identical to before', () => {
    expect(isStandaloneMapRequest(u('/opportunity-map?shell=app'))).toBe(false);
    expect(isStandaloneMapRequest(u('/opportunity-map?embed=1'))).toBe(false);
    expect(applySignedInAppRedirect(page, u('/opportunity-map?shell=app'))).toBe(page);
    expect(applySignedInAppRedirect(page, u('/opportunity-map?embed=1'))).toBe(page);
  });
});

describe('call site: the map route applies it', () => {
  it('route.ts wires applySignedInAppRedirect after the head is final, before the response', () => {
    expect(route).toContain("import { MAP_APP_SHELL_CSS, MAP_APP_SHELL_RESIZE_JS, applyAppShell, applySignedInAppRedirect, isAppShellRequest } from './app-shell';");
    const at = route.indexOf('html = applySignedInAppRedirect(html, reqUrl);');
    expect(at).toBeGreaterThan(route.indexOf('html = applyMapHead(html, shareHead, reqUrl.origin);'));
    expect(at).toBeLessThan(route.lastIndexOf("return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8'"));
  });

  it('the served standalone page carries the redirect first in <head>; the app frame does not', async () => {
    const { GET } = await import('./route');
    const plain = await (await GET(new Request('https://getmindy.ai/opportunity-map?naics=541512') as never)).text();
    expect(plain).toContain('<head><script id="mp-app-redirect">');
    expect(plain.match(/id="mp-app-redirect"/g)).toHaveLength(1);
    const shell = await (await GET(new Request('https://getmindy.ai/opportunity-map?naics=541512&shell=app') as never)).text();
    expect(shell).not.toContain('mp-app-redirect');
  }, 60_000);
});
