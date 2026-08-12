/**
 * Unit test for the Network map's drawer-open guards (the "clicking a gov contact does nothing" bug).
 *
 * Companies + Gov Buyers COEXIST on the ONE Network map: the dataset dropdown has a single
 * "Network" option whose value stays 'companies', and the two entity types are `__players`
 * sub-layers toggled on that one map — NOT separate modes. So `window.__mapMode` is 'companies'
 * for BOTH, and the click is routed by the row's own `ctype`, not by the mode.
 *
 * `openBuyerDrawer` guarded on `__mapMode!=='buyers'`, which is therefore never satisfied on the
 * Network map — every gov-buyer pin/card click returned before opening anything, a silent no-op
 * with no error. (`openCompanyDrawer` had the mirror-image guard, which would break companies the
 * moment anything set mode to 'buyers' — the legacy `openBuyerFromUrl` deep-link does exactly that.)
 *
 * The guards must reject only the OTHER maps (Opportunities / DLA), never the sibling entity type.
 * Extracted straight from route.ts and eval'd so the test tracks the SHIPPED source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

/**
 * Pull the `__mapMode` early-return guard out of one of the `window.<name>=function(...)` drawer
 * openers and return it as a predicate: true = the drawer bails out for that mode.
 */
function guardFor(name: string): (mode: string | undefined) => boolean {
  const start = routeSrc.indexOf(`window.${name}=function(`);
  expect(start, `${name} must exist in route.ts`).toBeGreaterThan(-1);

  const body = routeSrc.slice(start, start + 2000);
  const line = body.split('\n').find((l) => l.includes('window.__mapMode') && l.includes('return;'));
  expect(line, `${name} must still carry a __mapMode guard`).toBeTruthy();

  return new Function(
    'mode',
    `var window={__mapMode:mode};${(line as string).trim().replace('return;', 'return true;')}return false;`,
  ) as (mode: string | undefined) => boolean;
}

const bailsOut = { company: guardFor('openCompanyDrawer'), buyer: guardFor('openBuyerDrawer') };

describe('Network map drawer guards — both entity types open on the one Network map', () => {
  // The regression itself: mode is 'companies' for a gov buyer, because Network IS 'companies'.
  it('a GOV BUYER opens while the Network map reports mode "companies"', () => {
    expect(bailsOut.buyer('companies')).toBe(false);
  });

  it('a COMPANY opens while the map reports mode "buyers" (legacy deep-link sets this)', () => {
    expect(bailsOut.company('buyers')).toBe(false);
  });

  it('each type still opens under its own mode', () => {
    expect(bailsOut.company('companies')).toBe(false);
    expect(bailsOut.buyer('buyers')).toBe(false);
  });

  // The guard's real job — keep entity drawers off the Opportunities / DLA maps.
  it.each(['open', 'recompete', 'forecast', 'grants', 'dla'])('both stay closed on the %s map', (mode) => {
    expect(bailsOut.company(mode)).toBe(true);
    expect(bailsOut.buyer(mode)).toBe(true);
  });

  // Boot order: __mapMode is unset for a beat, and an undefined mode must not block the drawer.
  it('an unset __mapMode does not block either drawer', () => {
    expect(bailsOut.company(undefined)).toBe(false);
    expect(bailsOut.buyer(undefined)).toBe(false);
  });
});

/**
 * The second half of the same outage: `companyScaleTier` is defined in VIEWPORT_JS but was CALLED
 * bare from DRAWER_JS. Each injected <script> is its own IIFE, so that is a ReferenceError on every
 * company drawer open — and because the opener's trailing `.catch()` also catches whatever the
 * SUCCESS handler throws, it surfaced as "Couldn't load this company" while the API had returned
 * 200 with the full company. A green build and a 200 both looked fine; only a real click showed it.
 */
const DRAWER_JS = (() => {
  const start = routeSrc.indexOf('const DRAWER_JS');
  expect(start, 'DRAWER_JS block must exist').toBeGreaterThan(-1);
  const end = routeSrc.indexOf('\nconst ', start + 10);
  return routeSrc.slice(start, end === -1 ? routeSrc.length : end);
})();

describe('cross-script-block scope — DRAWER_JS cannot see VIEWPORT_JS locals', () => {
  it('exports companyScaleTier onto window so the drawer can reach it', () => {
    expect(routeSrc).toContain('window.companyScaleTier=companyScaleTier;');
  });

  it('DRAWER_JS never calls companyScaleTier bare (that is the ReferenceError)', () => {
    const bare = DRAWER_JS.split('\n').filter(
      (l) => /(^|[^.\w])companyScaleTier\s*\(/.test(l) && !/window\.companyScaleTier\s*\(/.test(l),
    );
    expect(bare, `bare cross-block call(s):\n${bare.join('\n')}`).toEqual([]);
  });

  it('both drawer openers log the real error instead of swallowing it', () => {
    expect(DRAWER_JS).toContain('[company-drawer] load/render failed:');
    expect(DRAWER_JS).toContain('[buyer-drawer] load/render failed:');
  });
});
