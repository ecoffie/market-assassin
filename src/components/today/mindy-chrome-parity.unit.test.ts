/**
 * DRIFT GUARD — /today's React chrome vs the map's HTML chrome.
 *
 * Eric 2026-08-15: *"Add a regression test for nav/rail labels and routes so the two
 * implementations cannot drift silently. Defer the true shared-source extraction until after the
 * homepage experience is stable."*
 *
 * The map's chrome is a raw HTML string in `src/app/opportunity-map/route.ts` (duplicated across
 * ~10 map routes, and carrying map-only `onclick` handlers). `/today` is React, so for now there
 * are TWO implementations. This test is the promise that keeps them honest: it reads the map's
 * ACTUAL source file — never a copy of the same list, which would pass while both drifted together
 * — and asserts every nav/rail label the map ships is also present on /today.
 *
 * WHEN THE MAP PHASE EXTRACTS A SHARED SOURCE: delete this test and make MindyChrome a thin wrapper
 * over it. A test asserting two copies match is a stopgap, not an architecture.
 *
 * ⚠️ This is a SOURCE-GREP test, which is blunt by nature. It asserts PRESENCE (the map's labels
 * exist on /today), NOT absence — /today is allowed to omit map-only affordances. If it fails, the
 * fix is to update MindyChrome to match the map, not to loosen the assertion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME_NAV_LABELS, CHROME_RAIL_LABELS } from './MindyChrome';

const MAP_ROUTE = join(process.cwd(), 'src/app/opportunity-map/route.ts');

describe('MindyChrome parity with the live map chrome', () => {
  const mapSrc = readFileSync(MAP_ROUTE, 'utf8');

  it('reads the real map route (guards against a silently-empty grep)', () => {
    // A test that greps a file it failed to read would pass vacuously forever.
    expect(mapSrc.length).toBeGreaterThan(10_000);
    expect(mapSrc).toContain('zhead');
  });

  // The map's TOP-NAV items. If the map renames one, /today must rename it too or this fails.
  const MAP_TOP_NAV = ['Opportunities', 'Network', 'Pursuits', 'Reports', 'Bid with confidence', 'Pricing'];

  it.each(MAP_TOP_NAV)('map top-nav item "%s" still exists in the map source', (label) => {
    expect(mapSrc).toContain(`>${label}<`);
  });

  it.each(MAP_TOP_NAV)('/today chrome renders top-nav item "%s"', (label) => {
    expect(CHROME_NAV_LABELS).toContain(label);
  });

  // The map's RAIL items (the "Your workspace" group + the two map modes).
  const MAP_RAIL = ['Opportunities', 'Network', 'Watchlist', 'Saved', 'Pursuits', 'Reports', 'Vault'];

  it.each(MAP_RAIL)('map rail item "%s" still exists in the map source', (label) => {
    expect(mapSrc).toContain(`</svg>${label}<`);
  });

  it.each(MAP_RAIL)('/today chrome renders rail item "%s"', (label) => {
    expect(CHROME_RAIL_LABELS).toContain(label);
  });

  // ROUTES matter as much as labels — a nav item pointing somewhere else is drift too.
  it.each([
    ['/opportunity-map/saved', 'Watchlist'],
    ['/opportunity-map/favorites', 'Saved'],
    ['/opportunity-map/pursuits', 'Pursuits'],
    ['/opportunity-map/reports', 'Reports'],
    ['/opportunity-map/vault', 'Vault'],
    ['/pricing', 'Pricing'],
    ['/bid', 'Bid with confidence'],
  ])('map still routes %s (for "%s")', (href) => {
    expect(mapSrc).toContain(`href="${href}"`);
  });
});
