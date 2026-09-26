/**
 * #1696 — one discovery round per Maps load. A LAYOUT move (container resize, centre + zoom unchanged)
 * is not navigation; boot resolves the layout before its first round. See layout-move.ts for the trace.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAYOUT_MOVE_PURE_JS } from './layout-move';

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const pure = new Function(LAYOUT_MOVE_PURE_JS + '; return { mapMoveKind, layoutMoveNeedsFetch };')() as {
  mapMoveKind: (p: unknown, n: unknown) => 'layout' | 'navigate';
  layoutMoveNeedsFetch: (released: boolean, requested: number[] | null, view: number[]) => boolean;
};
const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const templateSrc = readFileSync(join(__dirname, 'template.html'), 'utf8');

// The measured boot: round 1 asked for the 698-px view; the catch-up resize made it 696 px.
const REQUESTED = [-85.7813, 32.7873, -67.8076, 44.6999];
const AFTER_2PX = [-85.78125, 32.80574473290688, -67.80761718750001, 44.68427737181225];

describe('mapMoveKind — only a pure container resize is a layout move', () => {
  it('same zoom, centre within a rounding pixel → layout', () => {
    expect(pure.mapMoveKind({ x: 1000, y: 800, z: 6 }, { x: 1000.6, y: 799.5, z: 6 })).toBe('layout');
  });
  it('a pan (centre moved) → navigate, however small the bbox change', () => {
    expect(pure.mapMoveKind({ x: 1000, y: 800, z: 6 }, { x: 1003, y: 800, z: 6 })).toBe('navigate');
  });
  it('a zoom → navigate, even if the centre is identical', () => {
    expect(pure.mapMoveKind({ x: 1000, y: 800, z: 6 }, { x: 1000, y: 800, z: 6.5 })).toBe('navigate');
  });
  it('the first move of a load (no previous view) → navigate', () => {
    expect(pure.mapMoveKind(null, { x: 1, y: 1, z: 5 })).toBe('navigate');
  });
});

describe('layoutMoveNeedsFetch — layout only fetches the area it exposed', () => {
  it('THE #1696 CASE: the 2-px catch-up resize after round 1 → no second round', () => {
    expect(pure.layoutMoveNeedsFetch(true, REQUESTED, AFTER_2PX)).toBe(false);
  });
  it('before boot releases → never (the release round reads the view as it is then)', () => {
    expect(pure.layoutMoveNeedsFetch(false, null, AFTER_2PX)).toBe(false);
    expect(pure.layoutMoveNeedsFetch(false, REQUESTED, [-100, 20, -60, 50])).toBe(false);
  });
  it('a layout that GREW the view (rail collapsed, window enlarged) → fetch the new area', () => {
    expect(pure.layoutMoveNeedsFetch(true, REQUESTED, [-86.5, 32.7873, -67.8076, 44.6999])).toBe(true);
  });
  it('no round asked yet → fetch', () => {
    expect(pure.layoutMoveNeedsFetch(true, null, AFTER_2PX)).toBe(true);
  });
  it('bbox() rounds to 4 decimals — sub-rounding overhang still counts as inside', () => {
    expect(pure.layoutMoveNeedsFetch(true, REQUESTED, [-85.78134, 32.78726, -67.80755, 44.69994])).toBe(false);
  });
});

describe('wiring', () => {
  it('boot syncs the map size before releasing the first round (every release path goes through releaseFit)', () => {
    const rf = routeSrc.slice(routeSrc.indexOf('function releaseFit(){'), routeSrc.indexOf('function releaseFit(){') + 400);
    expect(rf.indexOf('__mapSyncSize')).toBeGreaterThan(-1);
    expect(rf.indexOf('__mapSyncSize')).toBeLessThan(rf.indexOf('__suppressFetchView=false'));
    expect(templateSrc).toContain('window.__mapSyncSize=resize;');
  });
  it('moveend classifies before scheduling, and a skipped layout move leaves a pending pan fetch alone', () => {
    const h = routeSrc.slice(routeSrc.indexOf("map.on('moveend'"), routeSrc.indexOf("map.on('zoomend'"));
    expect(h).toContain('window.__mapMoveKind(');
    expect(h).toContain('window.__layoutMoveNeedsFetch(!window.__suppressFetchView, window.__lastRoundBox');
    expect(h.indexOf('if(skip)return;')).toBeLessThan(h.indexOf('clearTimeout(t)'));
  });
  it('every round records the bbox it asked for', () => {
    expect(routeSrc).toContain("window.__lastRoundBox=bbox().split(',').map(Number)");
  });
  it('the helpers are injected before VIEWPORT_JS reads them', () => {
    expect(routeSrc).toContain('LAYOUT_MOVE_JS + MARKET_FEEDBACK_JS + VIEWPORT_JS');
  });
});
