import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Map launch (Eric 2026-08-12): start in the United States — never the world, never a foreign
// geo/IP. Last US view or US state if we have one; otherwise continental US.

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

describe('opportunity-map boot view — the United States, not the world', () => {
  it('opens on CONUS and never restores a view outside the US', () => {
    expect(route).toContain('var CONUS=[[38,-96],4.5];');
    expect(route).toContain('conus(); ensureUS(); return \'conus\';');
    expect(route).toContain('if(!inUS(v.lat,v.lng))return null;');
    expect(tmpl).toContain('setView(__lv?__lv.c:[38,-96], __lv?__lv.z:4.5)');
    expect(tmpl).toContain('function __inUS(lat,lng)');
    expect(tmpl).toContain('minZoom:4');
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
