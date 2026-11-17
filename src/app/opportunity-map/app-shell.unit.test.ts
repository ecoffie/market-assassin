/**
 * `?shell=app` — the map inside the signed-in app (/app?panel=map, Option A 2026-11-16).
 * It may hide ONLY the map's site top bar (.zhead) and icon rail (.zrail); it must never ship on the
 * standalone page or the ?embed= hero, and it must not add a second URL writer to the map.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_SHELL_JS, MAP_APP_SHELL_CSS, SUBPAGE_APP_SHELL_CSS, applyAppShell, isAppShellRequest } from './app-shell';
import { GET as savedGET } from './saved/route';
import { GET as favoritesGET } from './favorites/route';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

/** Every selector list whose rule sets display:none. */
function hiddenSelectors(css: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css.replace(/<\/?style[^>]*>/g, '')))) {
    if (/display\s*:\s*none/.test(m[2])) out.push(...m[1].split(',').map((s) => s.trim().replace(/^@media[^{]*/, '')));
  }
  return out;
}

describe('shell=app hides only the site top bar and the icon rail', () => {
  it('main map CSS', () => {
    expect(hiddenSelectors(MAP_APP_SHELL_CSS).sort()).toEqual(['.zhead', '.zrail']);
  });
  it('sub-page CSS', () => {
    expect(hiddenSelectors(SUBPAGE_APP_SHELL_CSS).sort()).toEqual(['.zhead', '.zrail']);
  });
  it('the filter bar WRAPS in shell mode (never scrolls — overflow clips its dropdowns), desktop only', () => {
    const desk = MAP_APP_SHELL_CSS.slice(MAP_APP_SHELL_CSS.indexOf('@media(min-width:641px)'));
    expect(desk).toContain('.ztop{flex-wrap:wrap!important');
    expect(desk).toContain('.ztop .fbar .fscroll{flex-wrap:wrap!important');
    expect(MAP_APP_SHELL_CSS).not.toMatch(/overflow(-x)?\s*:\s*(auto|scroll|hidden)/);
  });

  it('re-grids .app without the header row or rail column — no blank gap', () => {
    expect(MAP_APP_SHELL_CSS).toContain('grid-template-areas:"ztop ztop" "znote znote" "zmap zcards"');
    expect(MAP_APP_SHELL_CSS).not.toMatch(/grid-template-areas:[^;]*zhead/);
    expect(MAP_APP_SHELL_CSS).not.toMatch(/grid-template-areas:[^;]*zrail/);
    expect(MAP_APP_SHELL_CSS).toContain('--zh-h:0px!important');
    // the filter bar, list, map and drawers are never hidden
    for (const keep of ['.ztop', '.zcards', '.mapwrap', '.panel', '.oppdrawer', '#map']) {
      expect(hiddenSelectors(MAP_APP_SHELL_CSS)).not.toContain(keep);
    }
  });
});

describe('shell=app wiring', () => {
  it('reads exactly shell=app', () => {
    expect(isAppShellRequest(new URL('https://x/opportunity-map?shell=app'))).toBe(true);
    expect(isAppShellRequest(new URL('https://x/opportunity-map?shell=1'))).toBe(false);
    expect(isAppShellRequest(new URL('https://x/opportunity-map'))).toBe(false);
  });

  it('the map route applies it only off the embed branch, after the page is built', () => {
    expect(route).toContain('if (!embed && isAppShellRequest(reqUrl)) html = applyAppShell(html, MAP_APP_SHELL_CSS + MAP_APP_SHELL_RESIZE_JS);');
    // it is not ?embed= — the embed boot branch is untouched
    expect(route).not.toMatch(/if \(embed\)[^\n]*shell/);
  });

  it('adds no second URL WRITER to the map (the only replaceState call stays in __syncQueryUrl)', () => {
    expect(APP_SHELL_JS).not.toMatch(/history\.(replaceState|pushState)\(/);
    // it posts only to its own origin
    expect(APP_SHELL_JS).toContain('postMessage(m,O)');
    expect(APP_SHELL_JS).toContain('if(window.parent===window)return;');
  });

  it('injects into head + the last </body> and leaves a page without shell untouched', () => {
    const page = '<html><head></head><body><script>"</body>"</script></body></html>';
    const out = applyAppShell(page, SUBPAGE_APP_SHELL_CSS);
    expect(out.indexOf('mp-app-shell')).toBeLessThan(out.indexOf('</head>'));
    expect(out.endsWith(APP_SHELL_JS + '</body></html>')).toBe(true);
  });

  it('Watchlist and Saved pages serve shell mode only when asked', async () => {
    for (const GET of [savedGET, favoritesGET]) {
      const plain = await (await GET()).text();
      expect(plain).not.toContain('mp-app-shell');
      const plain2 = await (await GET(new Request('https://x/opportunity-map/saved'))).text();
      expect(plain2).not.toContain('mp-app-shell');
      const shell = await (await GET(new Request('https://x/opportunity-map/saved?shell=app'))).text();
      expect(shell).toContain('<style id="mp-app-shell">');
      expect(shell).toContain('mindy:map-shell-url');
    }
  });
});

describe('map sub-pages open inside the app (shell=app)', () => {
  const subs = ['pursuits', 'proposal', 'reports', 'vault', 'forecasts', 'market'] as const;
  for (const sub of subs) {
    it(`/opportunity-map/${sub} honours shell=app and is unchanged without it`, async () => {
      const mod = await import(`./${sub}/route`);
      const shell = await (await mod.GET(new Request(`https://x/opportunity-map/${sub}?shell=app`))).text();
      expect(shell).toContain('id="mp-app-shell"');
      expect(shell).toContain('mindy:map-shell-nav');
      const plain = await (await mod.GET()).text();
      expect(plain).not.toContain('mp-app-shell');
    });
  }
  it('the frame routes window.open of a map page or app tab into the app', () => {
    expect(APP_SHELL_JS).toContain('window.open=function(href)');
    expect(APP_SHELL_JS).toContain('IN=/^\\/(app|pricing|opportunity-map)(\\/|$)/');
  });
});
