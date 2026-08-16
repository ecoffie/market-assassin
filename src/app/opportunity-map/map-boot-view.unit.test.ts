import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Map launch (Eric 2026-08-12): start in the United States — never the world, never a foreign
// geo/IP. Last US view or US state if we have one; otherwise continental US.

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

describe('opportunity-map boot view — the United States, not the world', () => {
  it('opens on CONUS and never restores a view outside the US', () => {
    // Boot zoom 5, not 4.5 (2026-08-16). PIN_DOT_ZOOM is 5, so a 4.5 arrival rendered ZERO pins
    // behind "Zoom in to see opportunities" — measured on prod. This floors the ARRIVAL only;
    // manual zoom-out still hits the Zillow prompt, so the 08-12 "drop the minzoom, handle like
    // zillow" decision below is untouched (Eric confirmed the distinction 2026-08-16).
    expect(route).toContain('var CONUS=[[38,-96],5];');
    expect(route).toContain('conus(); ensureUS(); return \'conus\';');
    expect(route).toContain('if(!inUS(v.lat,v.lng))return null;');
    expect(tmpl).toContain('setView(__lv?__lv.c:[38,-96], __lv?__lv.z:5)');
    // The autofit is the code that ACTUALLY decides the arrival zoom: it ran after conus() and
    // overrode it, which is why changing the constants alone fixed nothing. fitBounds had a
    // maxZoom but no minimum, so it fitted to the pins' national bounds at 4.5 and then hid the
    // markers it had just fitted to. Floor it, or the map opens empty again.
    expect(route).toMatch(/if\(map\.getZoom\(\)<PIN_DOT_ZOOM\)map\.setZoom\(PIN_DOT_ZOOM/);
    expect(tmpl).toContain('function __inUS(lat,lng)');
    // NO minZoom — Zillow parity (Eric 2026-08-12: "drop the minzoom, handle like zillow").
    // The clamp made the zoom-out button DEAD at the bottom of its range, which reads as a
    // broken control rather than a boundary. Zillow lets you zoom out to the continent and
    // simply stops drawing pins ("Zoom in to see homes.") — the .zoomhint pill already does
    // exactly that below PIN_DOT_ZOOM, so the clamp guarded a state that is already handled.
    // Asserted as an ABSENCE so re-adding any clamp fails here instead of shipping.
    expect(tmpl).not.toMatch(/minZoom:\s*[\d.]/);
    expect(tmpl).not.toContain('maxBounds:');
    expect(route).toContain('function ensureUS()');
  });

  it('restores last session view from localStorage only when it is in the US', () => {
    expect(route).toContain("var LAST_VIEW_KEY='mi_map_last_view'");
    expect(route).toContain('window.__saveMapView=function()');
    expect(route).toContain('!inUS(c.lat,c.lng)');
    expect(tmpl).toContain("localStorage.getItem('mi_map_last_view')");
  });

  it('centers on profile home state or US IP — foreign geo is ignored', () => {
    expect(route).toContain("fetch('/api/app/map-home?email='");
    expect(route).toContain('window.__IP_STATE');
    expect(route).toContain('if(!inUS(p.coords.latitude,p.coords.longitude)){ finish(\'\'); return; }');
    expect(route).toContain('function setStateView(st)');
    expect(route).toContain('m.setView(c,6,{animate:false})');
  });

  it('all three horizons are ON at launch', () => {
    expect(route).toContain('window.__horizons={open:true,recompete:true,forecast:true};');
    expect(route).toContain('<button class="hznrow on" data-hz="recompete"');
    expect(route).toContain('<button class="hznrow on" data-hz="forecast"');
  });
});
