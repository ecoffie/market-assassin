import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPPORTUNITY_MAP_TEMPLATE } from './template-html';

// Tile-status notice readable and truthful (2026-11-21).
//
// When every keyless tile host fails (agency/corporate proxies), the Map shows
// "Map tiles blocked by your network. Pins still work…" (#tileStatus, created by setTileStatus).
//  1. PHONE: route.ts lifts the Leaflet controls over the bottom results bar
//     (`.mapwrap .leaflet-bottom{bottom:86px}`), but #tileStatus is not a Leaflet control, so it stayed
//     at the bottom, under the bar and the attribution. Measured: iPhone SE 0 of 3 rows visible,
//     iPhone 13 / Pixel 7 1 of 3.
//  2. DESKTOP: at bottom:16px it overlapped the legend (24–292px) and the attribution strip.
//  3. COPY: it said "try the basemap button", but route.ts removed that button from the served Map
//     (replaced by Draw), and mountTiles() already fails over across every provider before this shows.

const dir = __dirname;
const tmpl = readFileSync(join(dir, 'template.html'), 'utf8');
const route = readFileSync(join(dir, 'route.ts'), 'utf8');

const px = (re: RegExp, src: string, what: string): number => {
  const m = src.match(re);
  expect(m, `${what} not found`).toBeTruthy();
  return Number(m![1]);
};

describe('the tile-status notice is readable on every screen', () => {
  it('desktop: sits above the legend + attribution strip', () => {
    const bottom = px(/\.tilestatus\{position:absolute;bottom:(\d+)px;/, tmpl, 'base .tilestatus bottom');
    // Legend row and attribution occupy roughly the bottom 34px of the map (measured 19–33px / 0–18px).
    expect(bottom).toBeGreaterThanOrEqual(40);
  });

  it('phone: is lifted over the bottom results bar and the attribution, like the Leaflet controls', () => {
    const controls = px(/'\.mapwrap \.leaflet-bottom\{bottom:(\d+)px!important\}'/, route, 'phone .leaflet-bottom lift');
    const notice = px(/'\.mapwrap \.tilestatus\{bottom:(\d+)px!important[;}]/, route, 'phone .tilestatus lift');
    // The attribution sits at the controls' offset and is ~18px tall: clear it with a small gap.
    expect(notice).toBeGreaterThanOrEqual(controls + 24);
    // Both rules must live in the same (phone) block, i.e. next to each other.
    const a = route.indexOf("'.mapwrap .leaflet-bottom{bottom:");
    const b = route.indexOf("'.mapwrap .tilestatus{bottom:");
    expect(b - a).toBeGreaterThan(0);
    expect(b - a).toBeLessThan(600);
  });
});

describe('the tile-status notice only points at controls the served Map has', () => {
  it('the served Map removes the basemap button…', () => {
    expect(route).toMatch(/repl\(html,\s*'<button class="mpill" id="fitBtn">Fit to results<\/button>\\n\s*<button class="mpill" id="basemapBtn">Terrain<\/button>'/);
  });

  it('…so no tile message tells the customer to use it', () => {
    for (const src of [tmpl, OPPORTUNITY_MAP_TEMPLATE]) {
      const msgs = [...src.matchAll(/setTileStatus\('([^']*)'/g)].map((m) => m[1]).filter(Boolean);
      expect(msgs.length).toBeGreaterThan(0);
      for (const msg of msgs) expect(msg, msg).not.toMatch(/basemap|button/i);
    }
  });
});
