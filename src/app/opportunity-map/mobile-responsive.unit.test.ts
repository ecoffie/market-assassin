/**
 * PERMANENT GUARD for the opportunity-map MOBILE layout (phone ≤640px).
 *
 * On a phone the desktop 3-column grid (rail · map · cards) collapses into a Zillow-style
 * single surface: the LIST is the default, a floating "Map"/"List" toggle flips to a
 * full-screen map, and the fixed icon rail is replaced by a hamburger drawer. Before this,
 * the page rendered desktop-only at 390px — the rail ate 64px, the cards panel was clipped
 * off the right edge, and the map computed to width:0 (invisible).
 *
 * Two failure modes this locks down:
 *  1. The mobile CSS breakpoint / rules disappear (someone "cleans up" the media query).
 *  2. MOBILE_HTML gets re-ordered AFTER LOGIN_MODAL_HTML in bodyInject — LOGIN_MODAL_HTML has
 *     a latent unclosed <div> (.lgm-ov, display:none), so anything parsed after it nests INSIDE
 *     that hidden overlay and the fixed FAB/drawer compute to 0×0. MOBILE_HTML MUST lead the body.
 *
 * If this fails, DO NOT delete the assertion — the phone layout is broken. Re-verify at 390px.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('opportunity-map mobile responsive invariants', () => {
  it('has a phone breakpoint that collapses the grid to one column', () => {
    expect(routeSrc.includes('@media(max-width:640px)'), 'the ≤640px mobile media query must exist').toBe(true);
    // The single-column grid override (zhead / ztop / zcards stacked).
    expect(routeSrc.includes('"zhead" "ztop" "zcards"'), 'mobile grid must stack to a single column').toBe(true);
    // The fixed rail is hidden on phones (moves into the drawer).
    expect(/\.zrail\{display:none!important\}/.test(routeSrc), '.zrail must be display:none on mobile').toBe(true);
  });

  it('ships the three mobile chrome elements: hamburger, toggle FAB, drawer', () => {
    expect(routeSrc.includes('id="mHam"'), 'hamburger button must exist').toBe(true);
    expect(routeSrc.includes('id="mToggle"'), 'Map/List floating toggle must exist').toBe(true);
    expect(routeSrc.includes('id="mDrawer"'), 'nav drawer must exist').toBe(true);
    expect(routeSrc.includes('id="mScrim"'), 'drawer scrim must exist').toBe(true);
    // The wiring globals the buttons call.
    expect(routeSrc.includes('window.__mToggle'), '__mToggle wiring must exist').toBe(true);
    expect(routeSrc.includes('window.__mDrawer'), '__mDrawer wiring must exist').toBe(true);
  });

  it('body.m-map flips map ↔ list (the Zillow toggle contract)', () => {
    // Map layer shows only under body.m-map; list hides under it.
    expect(/body\.m-map \.mapwrap\{[^}']*visibility:visible/.test(routeSrc), 'body.m-map must reveal the map').toBe(true);
    expect(/body\.m-map \.panel\{[^}']*visibility:hidden/.test(routeSrc), 'body.m-map must hide the list').toBe(true);
  });

  it('mobile .ztop must NOT overflow-clip filter/sort menus', () => {
    // Absolute dropdowns (Horizons, Sort, .zsp, sheets) nest under .ztop. overflow-x:auto on
    // .ztop was shipping and silently clipping every menu on phones — same permanent rule as
    // .fscroll. Guard: the ≤640px block must set overflow:visible on .ztop, never overflow-x:auto.
    const mobileBlock = routeSrc.match(/@media\(max-width:640px\)\{[\s\S]*?\n  \+   '\}'/);
    expect(mobileBlock, '≤640px mobile CSS block must exist').toBeTruthy();
    const block = mobileBlock![0];
    expect(block.includes("overflow:visible!important"), '.ztop must overflow:visible on mobile').toBe(true);
    expect(block.includes('overflow-x:auto'), '.ztop must NOT use overflow-x:auto on mobile').toBe(false);
  });

  it('mobile header keeps the account avatar (inside .zh-right) reachable', () => {
    // Hiding ALL of .zh-right also hid .mindy-acct. We hide .zh-left + .zh-right > a only.
    expect(routeSrc.includes(".zh-right > a{display:none!important}"), 'text links in zh-right must hide').toBe(true);
    expect(routeSrc.includes(".mindy-acct{display:inline-flex!important}"), 'account avatar must stay visible').toBe(true);
    expect(
      /\.zh-left,\.zh-right\{display:none!important\}/.test(routeSrc),
      'must NOT hide all of .zh-right (that buries the account menu)',
    ).toBe(false);
  });

  it('Agency/Industry/Horizons popovers escape overflow via position:fixed + __placeHznPop', () => {
    // Absolute .hznpop was clipped by .app{overflow:hidden} (and mobile .ztop overflow). Same
    // escape hatch as .saselpanel: fixed + pin to the trigger rect on open.
    expect(/\.hznpop\{[^}]*position:fixed/.test(routeSrc), '.hznpop must be position:fixed').toBe(true);
    expect(routeSrc.includes('window.__placeHznPop='), '__placeHznPop placer must exist').toBe(true);
    expect(routeSrc.includes('getBoundingClientRect'), 'placer must use getBoundingClientRect').toBe(true);
    expect(routeSrc.includes('maxHeight'), 'placer must cap maxHeight to the remaining viewport').toBe(true);
    expect(routeSrc.includes('__scrollIsInsideHznPop'), 'scroll-inside-pop must not dismiss the menu').toBe(true);
  });

  it('MOBILE_HTML is injected BEFORE LOGIN_MODAL_HTML (else the FAB nests in a hidden overlay → 0×0)', () => {
    const inject = routeSrc.match(/const bodyInject =([^;]*);/);
    expect(inject, 'bodyInject assembly must exist').toBeTruthy();
    const order = inject![1];
    const mobileIdx = order.indexOf('MOBILE_HTML');
    const loginIdx = order.indexOf('LOGIN_MODAL_HTML');
    expect(mobileIdx, 'MOBILE_HTML must be in bodyInject').toBeGreaterThanOrEqual(0);
    expect(loginIdx, 'LOGIN_MODAL_HTML must be in bodyInject').toBeGreaterThanOrEqual(0);
    expect(mobileIdx, 'MOBILE_HTML must come BEFORE LOGIN_MODAL_HTML').toBeLessThan(loginIdx);
  });
});
