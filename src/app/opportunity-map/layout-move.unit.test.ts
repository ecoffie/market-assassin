/**
 * #1696 — one discovery round per Maps load. A LAYOUT move (container resize, centre + zoom unchanged)
 * is not navigation; boot resolves the layout before its first round. See layout-move.ts for the trace.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LAYOUT_MOVE_PURE_JS } from './layout-move';

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const pure = new Function(LAYOUT_MOVE_PURE_JS + '; return { mapMoveKind, layoutMoveNeedsFetch, moveStartsRound };')() as {
  mapMoveKind: (p: unknown, n: unknown) => 'layout' | 'navigate';
  layoutMoveNeedsFetch: (released: boolean, requested: number[] | null, view: number[]) => boolean;
  moveStartsRound: (released: boolean, kind: 'layout' | 'navigate', layoutExposed: boolean) => boolean;
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

describe('auto-fit waits for the round to settle (#1696 second boot trigger)', () => {
  it('the render wrapper does not auto-fit while any horizon of the round is still loading', () => {
    const w = routeSrc.slice(routeSrc.indexOf('var _render=render; render=function(){'), routeSrc.indexOf('var _render=render; render=function(){') + 900);
    expect(w).toContain('if(!(window.__horizonsLoading&&window.__horizonsLoading.length))maybeAutoFit();');
    expect(w).not.toMatch(/_render\(\); updateHeader\(\); maybeAutoFit\(\);/);
  });
  it('the settled paint still auto-fits (the one place a round may move the map)', () => {
    const p = routeSrc.slice(routeSrc.indexOf('function _paintRoundNow(round){'));
    const settledAt = p.indexOf('if(!settled)return;');
    expect(settledAt).toBeGreaterThan(-1);
    expect(p.indexOf('maybeAutoFit();', settledAt)).toBeGreaterThan(settledAt);
  });
});

// C (2026-10-04) — production __mapBootTrace, ?mode=companies, one clean load: contacts-map was asked the
// SAME query (same bbox, same type, counts) three times — release round, +600 ms, +4.9 s. The opportunity
// horizons hid the same three triggers behind join/cache (no request), so only Players paid for them.
describe('one discovery round per boot — no automatic re-ask of the release query (C)', () => {
  it('THE C CASE: boot placing its view fires a navigate moveend before release → no round', () => {
    expect(pure.moveStartsRound(false, 'navigate', true)).toBe(false);
    expect(pure.moveStartsRound(false, 'layout', true)).toBe(false);
  });
  it('after release, navigation always starts a round; layout only when it exposed area', () => {
    expect(pure.moveStartsRound(true, 'navigate', false)).toBe(true);
    expect(pure.moveStartsRound(true, 'layout', true)).toBe(true);
    expect(pure.moveStartsRound(true, 'layout', false)).toBe(false);
  });
  it('the moveend handler consults moveStartsRound with the release state before scheduling', () => {
    const h = routeSrc.slice(routeSrc.indexOf("map.on('moveend'"), routeSrc.indexOf("map.on('zoomend'"));
    expect(h).toContain('window.__moveStartsRound(!window.__suppressFetchView, kind, true)');
    expect(h.indexOf('window.__moveStartsRound(')).toBeLessThan(h.indexOf('if(skip)return;'));
  });
  it('no legacy untagged initial fetch — boot release owns round 1', () => {
    expect(routeSrc).not.toMatch(/setTimeout\(\s*fetchView\s*,/);
  });
  it('the 4 s failsafe does nothing once boot has released', () => {
    const i = routeSrc.indexOf('var _bootReleased=false;');
    expect(i).toBeGreaterThan(-1);
    const rf = routeSrc.slice(routeSrc.indexOf('function releaseFit(){'));
    expect(rf.indexOf('_bootReleased=true;')).toBeGreaterThan(-1);
    expect(rf.indexOf('_bootReleased=true;')).toBeLessThan(rf.indexOf('__suppressFetchView=false'));
    const fs = routeSrc.slice(routeSrc.indexOf('},4000);') - 900, routeSrc.indexOf('},4000);'));
    expect(fs).toContain('if(_bootReleased)return;');
    expect(fs.indexOf('if(_bootReleased)return;')).toBeLessThan(fs.indexOf('__mapRefetch({system:true})'));
  });
});
