/**
 * A Featured card on /today renders its DNA strands as chips — then dropped them from the link.
 *
 * The card said "Repeat Buyer · SB-Friendly" and its href was ?opp=<id> alone, so the map behind
 * the drawer opened unfiltered. Adding &strategy=<keys> makes the map show the rest of the
 * market that shares the card's DNA — Today's Intel CONFIGURING the map rather than just
 * pointing at it. Both params are already read by the map, in independent IIFEs, so they compose
 * with no new map code: ?opp= opens the drawer (route.ts ~7110), ?strategy= checks the strand
 * boxes and refetches (~7177).
 *
 * ⚠️ THE CONSTRAINT THAT MATTERS: the map applies ?strategy= by CHECKING .mf-strategy CHECKBOXES,
 * so only keys that HAVE a checkbox do anything. That client set is SIX keys — closes_soon,
 * posts_early, repeat_buyer, sb_friendly, set_aside, sources_sought — and is NARROWER than the
 * server allowlist STRATEGY_STRAND_KEYS (11 keys). Measured over live sam_opportunities, three
 * real DNA keys have no checkbox: full_open (24,608 rows — the 2nd most common strand),
 * early_cycle (15,779) and last_chance (4,924). Emitting those would put a param in the URL that
 * silently applies nothing — a link that LOOKS filtered and isn't, which is worse than no param.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILTERABLE_STRANDS, strategyParam } from './intel';

const mapSrc = readFileSync(
  join(__dirname, '..', '..', 'app', 'opportunity-map', 'route.ts'), 'utf8',
);

describe('featured cards deep-link their DNA into the map', () => {
  it('emits only strands the map can actually apply', () => {
    expect(strategyParam([{ key: 'repeat_buyer' }, { key: 'sb_friendly' }]))
      .toBe('repeat_buyer,sb_friendly');
    // full_open / early_cycle / last_chance are real DNA keys with NO checkbox — drop them.
    expect(strategyParam([{ key: 'full_open' }, { key: 'repeat_buyer' }])).toBe('repeat_buyer');
    expect(strategyParam([{ key: 'early_cycle' }])).toBe('');
    expect(strategyParam([{ key: 'last_chance' }])).toBe('');
  });

  it('returns empty rather than a param that would apply nothing', () => {
    expect(strategyParam([])).toBe('');
    expect(strategyParam([{ key: 'full_open' }, { key: 'early_cycle' }])).toBe('');
    // A card whose every strand is unfilterable must link with ?opp= only.
  });

  it('the emitted set matches the map checkboxes EXACTLY (both ends pinned)', () => {
    // If someone adds a .mf-strategy checkbox, this fails until the emitter learns the key —
    // and if someone removes one, it fails until the emitter stops sending it. That is the
    // point: the two ends cannot drift into disagreeing about what is filterable.
    const boxes = [...mapSrc.matchAll(/class="mf-strategy"[^>]*value="([^"]+)"/g)].map((m) => m[1]);
    const alt = [...mapSrc.matchAll(/value="([^"]+)"[^>]*class="mf-strategy"/g)].map((m) => m[1]);
    const inMap = [...new Set([...boxes, ...alt])].sort();
    expect(inMap.length).toBeGreaterThan(0);
    expect([...FILTERABLE_STRANDS].sort()).toEqual(inMap);
  });

  it('dedupes and ignores junk without emitting an empty entry', () => {
    expect(strategyParam([{ key: 'repeat_buyer' }, { key: 'repeat_buyer' }])).toBe('repeat_buyer');
    expect(strategyParam([{ key: '' }, { key: 'not_a_strand' }])).toBe('');
  });
});

/**
 * The ?strategy= handler was INERT ON PROD — measured 2026-08-15, before this work.
 *
 * It lives in DRAWER_JS and guarded on `typeof readDeep==='function' && typeof fetchView===
 * 'function'`. Both are VIEWPORT_JS **locals** — different <script> IIFE, never globals — so the
 * guard could never pass. The retry loop spun 40x and gave up in silence: no error, no log, the
 * URL looking perfectly correct. Both surfaces that emit the param (the /app "Open Today's Lens"
 * hero and the daily alert "Open Today's Map" button) had been landing on an unfiltered map.
 *
 * route.ts:1671 already warns about exactly this ("SEARCH_PANEL_JS is a SEPARATE <script> IIFE,
 * so it can NOT touch FILT / fetchView directly"). The fix is the same pattern that comment
 * prescribes: an explicit window.* bridge.
 */
describe('the strategy handler guards on a real global, not cross-block locals', () => {
  it('exposes window.__applyStrategyBoxes from the block that owns FILT/fetchView', () => {
    expect(mapSrc).toContain('window.__applyStrategyBoxes = function()');
    // It must live in VIEWPORT_JS (where readDeep/fetchView are in scope), not in DRAWER_JS.
    const viewport = mapSrc.indexOf('const VIEWPORT_JS');
    const drawer = mapSrc.indexOf('const DRAWER_JS');
    const bridge = mapSrc.indexOf('window.__applyStrategyBoxes = function()');
    expect(bridge).toBeGreaterThan(viewport);
    expect(bridge).toBeLessThan(drawer);
  });

  it('does not guard the deep link on VIEWPORT_JS locals it cannot see', () => {
    const handler = mapSrc.slice(mapSrc.indexOf("// \"Today's Lens\" pill names the lens"));
    const guard = handler.slice(0, handler.indexOf('applied.length'));
    expect(guard).toContain('window.__applyStrategyBoxes');
    expect(guard).not.toMatch(/typeof\s+readDeep\s*===?\s*'function'/);
    expect(guard).not.toMatch(/typeof\s+fetchView\s*===?\s*'function'/);
  });

  // The "Today's Lens" PILL was removed 2026-08-17 (it was absolutely positioned over
  // .map-controls and covered the "Pursuits" nav item). Its label-rendering test went with it.
  // What replaces it is the guard that actually matters: removing the BADGE must never remove
  // the FILTERING. If someone deletes the apply call while cleaning up leftover pill code, the
  // map would arrive unfiltered from Today's Intel and nothing else would catch it.
  it('still APPLIES the strategy filters after the pill was removed', () => {
    const handler = mapSrc.slice(mapSrc.indexOf("// \"Today's Lens\" pill names the lens"));
    const block = handler.slice(0, handler.indexOf('if(tries++<40)'));
    // the boxes are checked from the ?strategy= param...
    expect(block).toContain('b.checked=true');
    // ...and the change is pushed through the bridge that actually refetches the view.
    expect(block).toContain('window.__applyStrategyBoxes()');
    // and the removed pill stays removed — no absolutely-positioned badge over the nav.
    expect(block).not.toContain('todaysLensPill');
  });
});
