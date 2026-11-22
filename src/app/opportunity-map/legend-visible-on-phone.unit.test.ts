import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pin-colour legend visible on phones (2026-11-21).
//
// #mapLegend (Open Now / Coming Back / Coming Soon) sits at bottom:12px in template.html. On phones the
// fixed results bar (#mToggle) covers the bottom of the map, and route.ts lifts only the Leaflet controls
// (`.mapwrap .leaflet-bottom{bottom:86px}`) — the legend is not a Leaflet control, so it was entirely
// under the bar on iPhone SE / 13 / 15 Pro Max and Pixel 7 (hit-test: covered by #mToggleCount).
// After: it sits above the attribution row, wraps before the zoom control, and the tile notice sits
// above it. Measured: 0 new overlaps among legend, tile notice, attribution, zoom, bar, Save, Draw.

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

const px = (re: RegExp, src: string, what: string) => {
  const m = src.match(re);
  expect(m, `${what} not found`).toBeTruthy();
  return Number(m![1]);
};

describe('the map legend is visible on phones', () => {
  it('the legend is not a Leaflet control (so the .leaflet-bottom lift never moved it)', () => {
    expect(tmpl).toMatch(/\.maplegend\{position:absolute;left:12px;bottom:12px;/);
    expect(tmpl).toContain('<div class="maplegend" id="mapLegend"');
  });

  it('phone: lifted above the Leaflet controls offset and the ~18px attribution row', () => {
    const controls = px(/'\.mapwrap \.leaflet-bottom\{bottom:(\d+)px!important\}'/, route, 'phone controls lift');
    const legend = px(/'\.mapwrap \.maplegend\{bottom:(\d+)px!important;/, route, 'phone legend lift');
    expect(legend).toBeGreaterThanOrEqual(controls + 20);
  });

  it('phone: capped to wrap before the zoom control on the right', () => {
    const gutter = px(/'\.mapwrap \.maplegend\{bottom:\d+px!important;max-width:calc\(100% - (\d+)px\)\}'/, route, 'legend max-width');
    // left:12px + zoom control (~34px wide, 10px from the edge) → at least ~56px must stay free.
    expect(gutter).toBeGreaterThanOrEqual(56);
    expect(route).toContain("'.mapwrap .maplegend .lg-grp{flex-wrap:wrap;");
  });

  it('phone: the tile notice sits above the legend (two wrapped rows ≈ 46px)', () => {
    const legend = px(/'\.mapwrap \.maplegend\{bottom:(\d+)px!important;/, route, 'phone legend lift');
    const notice = px(/'\.mapwrap \.tilestatus\{bottom:(\d+)px!important;/, route, 'phone tile notice lift');
    expect(notice).toBeGreaterThanOrEqual(legend + 50);
  });

  it('all three phone rules live together in the phone block', () => {
    const a = route.indexOf("'.mapwrap .leaflet-bottom{bottom:");
    const c = route.indexOf("'.mapwrap .maplegend .lg-grp{");
    expect(a).toBeGreaterThan(0);
    expect(c - a).toBeGreaterThan(0);
    expect(c - a).toBeLessThan(1500);
  });
});
