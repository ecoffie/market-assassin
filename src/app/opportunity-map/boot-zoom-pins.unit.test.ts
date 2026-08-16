/**
 * The interactive map arrived EMPTY: zero pins and "Zoom in to see opportunities".
 *
 * MEASURED on prod 2026-08-16 at getmindy.ai/opportunity-map, 15s after load:
 *   zoom 4.5 · markerIcons 0 · leaflet-marker-pane children 0 · "Zoom in to see opportunities"
 * Zoom one step in and the pins are all there — 2,970 markers at DC (zoom 9), fetched
 * per-viewport (the map is NOT capped; it pulled 1000 pins on load and refetched 959 for DC).
 *
 * THE CAUSE IS A HALF-LEVEL GAP, not missing data: the map boots at CONUS `[[38,-96],4.5]`
 * (route.ts ~7212) while `PIN_DOT_ZOOM=5` suppresses pins below 5. So the default view sits
 * BELOW the map's own pin threshold and every visitor's first impression is a blank map with a
 * prompt — on a page whose whole job is showing that the market is busy.
 *
 * FIX = boot at the threshold, not below it. The threshold itself stays 5: it is a deliberate
 * legibility call (route.ts ~905, "the right call for the INTERACTIVE map — a user can zoom"),
 * and lowering it would put national-scale pin soup back on screen. Moving the boot zoom is the
 * smaller, safer half of the same fix.
 *
 * ⚠️ Do NOT "fix" this by dropping PIN_DOT_ZOOM to 4.5 — that re-litigates a decision made for
 * legibility, and the embed already has its own floor of 0 via _EMBCL for the front-page hero.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('the map boots at a zoom that actually draws pins', () => {
  it('CONUS boot zoom is at or above the pin threshold', () => {
    const conus = map.match(/var CONUS\s*=\s*\[\[[-\d.,\s]+\],\s*([\d.]+)\]/);
    expect(conus, 'CONUS boot view not found').toBeTruthy();
    const bootZoom = Number(conus![1]);
    const floor = Number((map.match(/var PIN_DOT_ZOOM=\(_EMBCL\?0:([\d.]+)\)/) || [])[1]);
    expect(floor, 'PIN_DOT_ZOOM not found').toBeGreaterThan(0);
    // The bug: 4.5 < 5, so the default view rendered nothing at all.
    expect(bootZoom).toBeGreaterThanOrEqual(floor);
  });

  it('keeps PIN_DOT_ZOOM at 5 — the threshold is deliberate, the boot zoom was the bug', () => {
    expect(map).toContain('var PIN_DOT_ZOOM=(_EMBCL?0:5);');
  });

  it('leaves the embed floor at 0 so the hero still paints at any zoom', () => {
    expect(map).toMatch(/PIN_DOT_ZOOM=\(_EMBCL\?0:/);
  });
});
