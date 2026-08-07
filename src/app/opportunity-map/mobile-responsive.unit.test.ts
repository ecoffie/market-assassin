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
