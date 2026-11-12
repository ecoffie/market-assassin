/**
 * PERMANENT GUARD for the opportunity-map MOBILE layout (phone ≤640px).
 *
 * On a phone the desktop 3-column grid (rail · map · cards) collapses into a Zillow-style
 * single surface: the MAP is the default (since 2026-11-06), a bottom bar flips to the list
 * and a floating "Map" pill flips back, a tapped pin shows a bottom card, and the fixed icon
 * rail is replaced by a hamburger drawer. Before this,
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
/** The route's CSS with its string concatenations joined, so a rule split across lines reads as one. */
const joined = routeSrc.replace(/'\s*\n\s*\+\s*'/g, '');

describe('opportunity-map mobile responsive invariants', () => {
  it('has a phone breakpoint that collapses the grid to one column', () => {
    expect(routeSrc.includes('@media(max-width:640px)'), 'the ≤640px mobile media query must exist').toBe(true);
    // The single-column grid override (zhead / ztop / znote / zcards stacked; znote = the saved-search
    // notice row, 0 px when absent).
    expect(routeSrc.includes('"zhead" "ztop" "znote" "zcards"'), 'mobile grid must stack to a single column').toBe(true);
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

  it('map is the default; body.m-list flips to the list (the Zillow toggle contract)', () => {
    expect(/\.panel\{grid-area:zcards[^}']*visibility:hidden/.test(joined), 'the list must be hidden by default').toBe(true);
    expect(/body\.m-list \.panel\{[^}']*visibility:visible/.test(routeSrc), 'body.m-list must reveal the list').toBe(true);
    expect(/body\.m-list \.mapwrap\{[^}']*visibility:hidden/.test(routeSrc), 'body.m-list must hide the map').toBe(true);
    expect(routeSrc.includes('<span id="mToggleLbl">List</span>'), 'the toggle starts on the map, offering the list').toBe(true);
  });

  it('the bottom bar keeps the map-truth count (mirrors #mapCount, which is hidden on phones)', () => {
    expect(routeSrc.includes('id="mToggleCount"'), 'bottom bar count slot must exist').toBe(true);
    expect(/getElementById\("mapCount"\)[^']*mToggleCount|mToggleCount[^']*getElementById\("mapCount"\)/.test(joined), 'the bar must copy #mapCount').toBe(true);
  });

  it('a tapped pin shows a bottom card on phones', () => {
    expect(routeSrc.includes('id="mCard"'), '#mCard must exist').toBe(true);
    expect(routeSrc.includes('map.on("popupopen"'), 'popup content must be moved into the card on open').toBe(true);
  });

  it('mobile .ztop must NOT overflow-clip filter/sort menus', () => {
    // Absolute dropdowns (Horizons, Sort, .zsp, sheets) nest under .ztop. overflow-x:auto on
    // .ztop was shipping and silently clipping every menu on phones — same permanent rule as
    // .fscroll. Guard: the ≤640px block must set overflow:visible on .ztop, never overflow-x:auto.
    const mobileBlock = routeSrc.match(/@media\(max-width:640px\)\{[\s\S]*?\n  \+   '\}'/);
    expect(mobileBlock, '≤640px mobile CSS block must exist').toBeTruthy();
    const block = mobileBlock![0];
    expect(block.includes("overflow:visible!important"), '.ztop must overflow:visible on mobile').toBe(true);
    expect(/\.ztop\{[^}]*overflow-x:auto/.test(block), '.ztop must NOT use overflow-x:auto on mobile').toBe(false);
  });

  it('mobile header: the homepage bar owns the account menu; the map row only hides its links', () => {
    // Since 2026-11-12 the account menu lives in the homepage bar (siteTopHtml), whose own phone
    // CSS shows it once signed in. The map must not force it visible (that showed it signed out).
    expect(routeSrc.includes('+ siteTopHtml()'), 'map header must render the homepage bar').toBe(true);
    expect(routeSrc.includes("'.zh-left{display:none!important}'"), 'map links hide on phones (they live in #mDrawer)').toBe(true);
    expect(routeSrc.includes('.mindy-acct{display:inline-flex!important}'), 'must not force the account menu visible').toBe(false);
  });

  it('the event banner is hidden on the map on phones only', () => {
    const mobileBlock = routeSrc.match(/@media\(max-width:640px\)\{[\s\S]*?\n  \+   '\}'/)![0];
    expect(mobileBlock.includes(".zhead .mp-evb-band{display:none!important}"), 'banner hidden inside the phone block').toBe(true);
    const outside = routeSrc.replace(mobileBlock, '');
    expect(outside.includes('.mp-evb-band{display:none'), 'banner must still show on desktop').toBe(false);
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
