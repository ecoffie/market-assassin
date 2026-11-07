/**
 * DIBBS is parked on the maps (2026-11-07): no sustainable source, the sync is disabled, so the
 * map must not offer a DLA mode or return DIBBS pins. Re-enabling is one constant
 * (DIBBS_MAP_ENABLED); these tests pin the parked state so it can't drift back in by accident.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const getDibbsMapPins = vi.fn(async () => [{ id: 'SPE7M1-26-T-0001', src: 'DLA' }]);
const getDibbsViewportPins = vi.fn(async () => []);
const getMapOpportunities = vi.fn(async () => [{ id: 'sam1', src: 'SAM' }]);

vi.mock('@/lib/opportunities/map-data', async (orig) => {
  const real = await orig<typeof import('@/lib/opportunities/map-data')>();
  return { ...real, getDibbsMapPins, getDibbsViewportPins, getMapOpportunities };
});

import { DIBBS_MAP_ENABLED } from './availability';

const ROOT = join(__dirname, '..', '..', 'app');
const mapSrc = readFileSync(join(ROOT, 'opportunity-map', 'route.ts'), 'utf8');
const apiSrc = readFileSync(join(ROOT, 'api', 'app', 'opportunity-map', 'route.ts'), 'utf8');

describe('DIBBS parked on the maps', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('the switch is off', () => {
    expect(DIBBS_MAP_ENABLED).toBe(false);
  });

  it('the dataset dropdown only emits the DLA option behind the switch', () => {
    expect(mapSrc).toContain(`(DIBBS_MAP_ENABLED ? '<option value="dla">DLA Supply Bids</option>' : '')`);
    // no unconditional copy of the option anywhere else
    expect(mapSrc.split('<option value="dla">').length - 1).toBe(1);
  });

  it('the client drops the dla mode so a saved/linked dla mode is a no-op', () => {
    expect(mapSrc).toContain('if(!window.__DIBBS_MAP_ENABLED){ delete MODES.dla; }');
    expect(mapSrc).toContain("const DIBBS_FLAG_JS = '<script>window.__DIBBS_MAP_ENABLED=' + String(DIBBS_MAP_ENABLED) + ';</script>';");
    // the flag script is injected into the page
    expect(mapSrc).toContain('LOGIN_MODAL_HTML + DIBBS_FLAG_JS + WATCH_SCOPE_SCRIPT');
    // ...and it lands before the viewport script that reads it
    const inject = mapSrc.slice(mapSrc.indexOf('const bodyInject ='));
    expect(inject.indexOf('DIBBS_FLAG_JS')).toBeLessThan(inject.indexOf('VIEWPORT_JS'));
    // setMapMode refuses unknown modes, which is what makes the delete effective
    expect(mapSrc).toMatch(/if\(!MODES\[mode\]\|\|mode===MODE\)return;/);
  });

  it('every DIBBS query in the API sits behind wantDlaSources, which checks the switch first', () => {
    expect(apiSrc).toMatch(/function wantDlaSources\(raw: string \| null\): boolean \{\s*if \(!DIBBS_MAP_ENABLED\) return false;/);
    // the two DIBBS fetches and the dibbs_rfqs head count are each inside a wantDla* branch
    expect(apiSrc.match(/getDibbsMapPins\(/g)?.length).toBe(1);
    expect(apiSrc.match(/getDibbsViewportPins\(/g)?.length).toBe(1);
    expect(apiSrc.match(/from\('dibbs_rfqs'\)/g)?.length).toBe(1);
    const legacy = apiSrc.indexOf('if (wantDla) {');
    const viewport = apiSrc.indexOf("if (wantDlaSources(p.get('sources'))) {");
    expect(legacy).toBeGreaterThan(-1);
    expect(viewport).toBeGreaterThan(-1);
    expect(apiSrc.indexOf('getDibbsMapPins(')).toBeGreaterThan(legacy);
    expect(apiSrc.indexOf('getDibbsViewportPins(')).toBeGreaterThan(viewport);
    expect(apiSrc.indexOf("from('dibbs_rfqs')")).toBeGreaterThan(viewport);
  });

  for (const sources of ['dla', 'sam,dla', 'dibbs', 'all']) {
    it(`?sources=${sources} returns no DLA pins and never queries DIBBS`, async () => {
      const { GET } = await import('@/app/api/app/opportunity-map/route');
      const { NextRequest } = await import('next/server');
      const res = await GET(new NextRequest(`https://getmindy.ai/api/app/opportunity-map?sources=${sources}`));
      const body = await res.json();
      expect(getDibbsMapPins).not.toHaveBeenCalled();
      expect(getDibbsViewportPins).not.toHaveBeenCalled();
      expect(body.success).toBe(true);
      expect(body.countsBySource.DLA).toBe(0);
      expect((body.opps as { src?: string }[]).some((o) => o.src === 'DLA')).toBe(false);
    });
  }
});
