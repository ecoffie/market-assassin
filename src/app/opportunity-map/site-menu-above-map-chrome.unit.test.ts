import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { siteTopHtml, SITE_NAV_CSS } from '@/lib/public-site/site-nav';

// Site ☰ menu above the Map's phone chrome (2026-11-21).
//
// The homepage ☰ menu (.mp-menu) is rendered INSIDE the Map header (.zhead), so its z-index can never
// rise above the header's own (1100). On phones the map's bottom results sheet (#mToggle, 1400), the
// selected-pin card (#mCard, 1300) and Save search (1200) are fixed layers ABOVE 1100, so they covered
// the bottom of the open menu. Measured in a browser (iPhone SE / 13, Pixel 7, every menu item
// scrolled into view and hit-tested): "Start 14-day free trial" was under #mToggle on all three, and
// with a pin card open "Sign in" was under #mCard as well. A tap went to the sheet, not the link.
//
// Guard: while html.mp-menu-open is set, .zhead must sit above every map layer that can be on screen
// with the menu, and below the user-opened overlays (Ask Mindy, filter pop-overs, login modal).

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');

/** z-index declared for the first CSS rule whose text starts with `prefix` in route.ts. */
function zOf(prefix: string): number {
  const at = route.indexOf(prefix);
  expect(at, `rule ${prefix} not found in route.ts`).toBeGreaterThan(-1);
  // Rules are split across concatenated string literals; read until the rule's closing brace.
  const tail = route.slice(at, at + 1200).replace(/'\s*\+\s*'/g, '');
  const rule = tail.slice(0, tail.indexOf('}') + 1);
  const m = rule.match(/z-index:(\d+)/);
  expect(m, `no z-index in ${rule.slice(0, 120)}`).toBeTruthy();
  return Number(m![1]);
}

const OPEN_RULE = /html\.mp-menu-open \.zhead\{z-index:(\d+)!important\}/;

describe('the site ☰ menu opens above the Map phone chrome', () => {
  it('the menu is rendered inside .zhead and opens by toggling html.mp-menu-open', () => {
    // If either of these changes, the fix below no longer targets the right element/state.
    expect(route).toMatch(/const zheadHtml = \(\): string => '<header class="zhead">'\s*\+ siteTopHtml\(\)/);
    expect(siteTopHtml()).toContain('class="mp-menu" id="mp-menu"');
    expect(siteTopHtml()).toContain("classList.toggle('mp-menu-open')");
    expect(SITE_NAV_CSS).toContain('html.mp-menu-open .mp-menu{display:flex}');
  });

  it('raises .zhead above every map layer while the menu is open', () => {
    const m = route.match(OPEN_RULE);
    expect(m, 'missing html.mp-menu-open .zhead{z-index:…!important}').toBeTruthy();
    const open = Number(m![1]);
    const mapChrome = {
      '#mToggle (results sheet)': zOf("'#mToggle{display:flex!important"),
      '#mCard (selected pin)': zOf("'#mCard{display:block!important"),
      '#saveSearchBtn': zOf("'#saveSearchBtn{position:fixed!important"),
      '#mScrim': zOf("'#mScrim{display:block!important"),
      '#mDrawer': zOf("'#mDrawer{display:block!important"),
      '.oppbd (listing backdrop)': zOf("'.oppbd{position:fixed"),
      '.zhead (closed)': zOf("'.zhead{grid-area:zhead"),
    };
    for (const [name, z] of Object.entries(mapChrome)) {
      expect(open, `${name} is z ${z}`).toBeGreaterThan(z);
    }
  });

  it('stays below overlays the user opened on purpose', () => {
    const open = Number(route.match(OPEN_RULE)![1]);
    expect(open).toBeLessThan(zOf("'.amk-ov{position:fixed"));       // Ask Mindy
    expect(open).toBeLessThan(zOf('.hznpop{position:fixed'));         // horizon pop-over
    expect(open).toBeLessThan(zOf('.saselpanel{position:fixed'));     // set-aside picker
  });

  it('the phone header rule keeps 1100 when the menu is closed', () => {
    expect(route).toContain("'.zhead{z-index:1100!important}");
  });
});
