/**
 * Phone menu vs the floating "Get help" button (2026-11-28).
 *
 * On a 390x844 phone with the menu open, "Get help" (.mhw-btn, z-index 2147482000) sat on top of
 * "Start 14-day free trial" (the menu is z-index 60), Sign in and the trial button were below the
 * first screen, and the 52px search box measured 20px because the scrolling column-flex menu shrank it.
 * jsdom has no layout, so this reads the real stylesheets through the CSSOM.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { helpWidgetScript } from '@/lib/support/help-widget';
import { MP_RAW_SITE_CSS, MP_SITE_CSS } from './css';
import { mpRawHeaderHtml } from './html';

type Decl = Record<string, string>;

/** Declarations for `selector` (exact selector-list member) inside `@media <media>`, last one wins. */
function rule(css: string, media: string, selector: string): Decl {
  const d = new JSDOM(`<!doctype html><style>${css}</style>`).window.document;
  const out: Decl = {};
  for (const r of [...d.styleSheets[0].cssRules]) {
    if (!('media' in r) || (r as CSSMediaRule).media.mediaText.replace(/\s/g, '') !== media) continue;
    for (const inner of [...(r as CSSMediaRule).cssRules] as CSSStyleRule[]) {
      if (!inner.selectorText?.split(',').map((s) => s.trim()).includes(selector)) continue;
      for (let i = 0; i < inner.style.length; i++) {
        const p = inner.style[i];
        out[p] = inner.style.getPropertyValue(p) + (inner.style.getPropertyPriority(p) ? ' !important' : '');
      }
    }
  }
  return out;
}

const PHONE = '(max-width:980px)';

describe.each([['MP_SITE_CSS', MP_SITE_CSS], ['MP_RAW_SITE_CSS', MP_RAW_SITE_CSS]])('phone menu in %s', (_name, css) => {
  it('hides the floating Get help button and its panel while the menu is open', () => {
    expect(rule(css, PHONE, 'html.mp-menu-open .mhw-btn').display).toBe('none !important');
    expect(rule(css, PHONE, 'html.mp-menu-open .mhw-p').display).toBe('none !important');
  });

  it('keeps the search box at its 52px height (does not shrink in the scrolling menu)', () => {
    const search = rule(css, PHONE, '.mp-menu-search');
    expect(search.height).toBe('52px');
    expect(search['flex-shrink'] ?? search.flex).toMatch(/^(0|none)$/);
  });

  it('pins Sign in + the trial button to the bottom of the menu so they show on the first screen', () => {
    const foot = rule(css, PHONE, '.mp-menu-foot');
    expect(foot.position).toBe('sticky');
    expect(foot.background || foot['background-color']).toBeTruthy();
    expect(foot['flex-shrink'] ?? foot.flex).toMatch(/^(0|none)$/);
  });
});

describe('call sites', () => {
  it('the help widget really renders .mhw-btn / .mhw-p above the menu, so hiding is required', () => {
    const js = helpWidgetScript();
    expect(js).toContain('btn.className="mhw-btn"');
    expect(js).toMatch(/\.mhw-p\{position:fixed/);
    const widgetZ = Number(js.match(/\.mhw-btn\{[^}]*z-index:(\d+)/)?.[1]);
    const menuZ = Number(MP_SITE_CSS.match(/\.mp-menu\{position:fixed[^}]*z-index:(\d+)/)?.[1]);
    expect(widgetZ).toBeGreaterThan(menuZ);
  });

  it('the real header renders the search box and the Sign in / trial footer inside the phone menu', () => {
    const d = new JSDOM(`<!doctype html><body>${mpRawHeaderHtml()}</body>`).window.document;
    const menu = d.querySelector('#mp-menu.mp-menu')!;
    expect(menu.querySelector(':scope > form.mp-menu-search')).toBeTruthy();
    const foot = menu.querySelector(':scope > .mp-menu-foot')!;
    expect([...foot.querySelectorAll('a')].map((a) => a.textContent?.trim())).toEqual(['Sign in', 'Start 14-day free trial']);
  });
});
