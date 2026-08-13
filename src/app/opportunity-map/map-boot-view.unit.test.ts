import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Map launch view (Eric 2026-08-12): dots not cluster-bursts, all three horizons on, start
// zoomed into a single state (last view → profile → IP/geo) instead of flashing CONUS.

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

describe('opportunity-map boot view — state, not the whole country', () => {
  it('does not flash CONUS first — bootPlace returns empty and waits for profile/geo', () => {
    expect(route).toContain("if(ip&&setStateView(ip))return 'ip';");
    expect(route).toContain("return '';");
    expect(route).toContain('function fallbackGeoThenConus(');
    expect(route).not.toContain('conus(); return \'\';');
  });

  it('restores last session view from localStorage (last-login location)', () => {
    expect(route).toContain("var LAST_VIEW_KEY='mi_map_last_view'");
    expect(route).toContain('window.__saveMapView=function()');
    expect(tmpl).toContain("localStorage.getItem('mi_map_last_view')");
  });

  it('centers on profile home state, IP region, or browser geo — never the world', () => {
    expect(route).toContain("fetch('/api/app/map-home?email='");
    expect(route).toContain('window.__IP_STATE');
    expect(route).toContain('navigator.geolocation.getCurrentPosition');
    expect(route).toContain('function setStateView(st)');
    expect(route).toContain('m.setView(c,6,{animate:false})');
  });

  it('all three horizons are ON at launch', () => {
    expect(route).toContain('window.__horizons={open:true,recompete:true,forecast:true};');
    expect(route).toContain('<button class="hznrow on" data-hz="recompete"');
    expect(route).toContain('<button class="hznrow on" data-hz="forecast"');
  });
});
