/**
 * Guards the Opportunity Map's engagement instrumentation.
 *
 * THE GAP (found 2026-08-03): there were 26 track() calls across the /app panels and
 * ZERO in the map. Every page_view we recorded was a panel — dashboard, research,
 * forecasts, pipeline — so the map showed 14 events from 7 users in 30 days, all
 * leaking in from elsewhere. That is not low usage; it is no measurement.
 *
 * The consequence was strategic, not cosmetic: "the map is the primary interface" is
 * the claim the entire product direction rests on, and it could not be checked. We were
 * about to rebuild the listing page with no baseline to judge the rebuild against.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');
const ENG = readFileSync(join(process.cwd(), 'src/lib/engagement.ts'), 'utf8');

// Slice _track to its REAL end (the window.__track assignment right after it), not a fixed
// character count: a 1400-char window silently truncated the moment an expiry guard was added
// above the fetch, and three assertions failed against code that was completely intact.
function trackBody(): string {
  const start = MAP.indexOf('function _track(');
  const end = MAP.indexOf('window.__track=_track');
  return MAP.slice(start, end);
}

describe('the tracker itself', () => {
  it('posts to the SAME endpoint the panels use', () => {
    // Not a new table, not a new pipeline — the admin dashboard already reads
    // user_engagement, so map events show up there with no schema change.
    expect(MAP).toContain("fetch('/api/app/engagement'");
  });

  it('uses an allowlisted eventType', () => {
    // The endpoint rejects anything outside EventTypes. Map specifics ride in
    // metadata.action rather than inventing a type that would 400.
    const fn = trackBody();
    expect(fn).toMatch(/eventType:\s*kind/);
    for (const t of ['page_view', 'tool_use']) {
      expect(MAP, `${t} must be an allowed type`).toContain(`'${t}'`);
    }
  });

  it('tags every event with an opportunity_map source', () => {
    expect(MAP).toContain("eventSource:'opportunity_map'");
    expect(ENG).toContain("OPPORTUNITY_MAP: 'opportunity_map'");
  });

  it('is FIRE AND FORGET — never blocks, never throws', () => {
    // Tracking must not delay a pan, block a click, or throw into the render path.
    const fn = trackBody();
    expect(fn).toContain('.catch(function(){})');
    expect(fn).toMatch(/^\s*try\{/m);
    expect(fn).not.toContain('await ');
  });

  it('survives a navigation away', () => {
    // A listing_open immediately followed by a click-out would otherwise be lost.
    const fn = trackBody();
    expect(fn).toContain('keepalive:true');
  });

  it('sends nothing for a signed-out visitor', () => {
    // No email means nothing to attribute, and the endpoint would 401 anyway.
    const fn = trackBody();
    expect(fn).toMatch(/if\(!em\) return;/);
    expect(fn).toMatch(/if\(!tk\) return;/);
  });
});

describe('the four events that answer the open questions', () => {
  it('listing_open — which listings actually get opened', () => {
    // The metric the listing redesign has to be judged against.
    expect(MAP).toMatch(/__track\('tool_use','listing_open'/);
  });

  it('map_view — do brief-clickers land here, or bounce to a panel', () => {
    expect(MAP).toMatch(/__track\('page_view','map_view'/);
  });

  it('map_view fires ONCE per session, not per pan', () => {
    // A pan is not a visit. Counting one would drown the arrival signal.
    const fn = MAP.slice(MAP.indexOf('function _trackMapView('), MAP.indexOf('function _trackMapView(') + 500);
    expect(fn).toContain('if(_viewSent)return');
  });

  it('map_view carries attribution, so a brief click-through is distinguishable', () => {
    const fn = MAP.slice(MAP.indexOf('function _trackMapView('), MAP.indexOf('function _trackMapView(') + 500);
    expect(fn).toContain('referrer');
    expect(fn).toContain('utm_source');
  });

  it('map_search — what people type when they are meant to be browsing', () => {
    expect(MAP).toMatch(/__track\('tool_use','map_search'/);
  });

  it('cards_shown — the DENOMINATOR listing_open is meaningless without', () => {
    // 40 opens is excellent against 200 cards shown and dismal against 20,000.
    // Only the ratio can test "the Decision Card earns the click".
    expect(MAP).toMatch(/_track\('page_view','cards_shown'/);
  });

  it('cards_shown counts a RENDER PASS, not a card', () => {
    // drawFeed() re-runs on every filter change, pan, sort and horizon switch. One event
    // per card would write thousands of rows an hour and measure scrolling, not seeing.
    const emit = MAP.slice(MAP.indexOf('function _emitCardsShown'), MAP.indexOf('function _emitCardsShown') + 1600);
    expect(emit).toContain('count:n');
    expect(emit).toContain('if(!n) return');   // an empty state is not an impression
    const inst = MAP.slice(MAP.indexOf('function _installCardImpressions'), MAP.indexOf('function _installCardImpressions') + 1200);
    expect(inst).toMatch(/setTimeout\(_emitCardsShown,\s*\d+\)/); // debounced
  });

  it('cards_shown observes the DOM — it must NOT wrap drawFeed', () => {
    // REGRESSION GUARD. The first version wrapped window.drawFeed, passed every unit test
    // in this file, and fired ZERO events against 1,000 real cards: the template declares
    // drawFeed as a plain function declaration and calls it UNQUALIFIED from render(), so
    // resolves to the closure binding. Reassigning window.drawFeed rebinds a name that
    // nothing ever reads. Observing the DOM the feed writes cannot be bypassed.
    const fn = MAP.slice(MAP.indexOf('function _installCardImpressions'), MAP.indexOf('function _installCardImpressions') + 1200);
    expect(fn).toContain('MutationObserver');
    expect(fn).toContain("getElementById('feed')");
    expect(fn, 'wrapping drawFeed does not work — see the comment above').not.toContain('window.drawFeed');
  });

  it('cards_shown catches a feed painted before the observer attached', () => {
    // The template may finish its first render before this block runs; without the
    // immediate call, the very first (and most important) impression is lost.
    const fn = MAP.slice(MAP.indexOf('function _installCardImpressions'), MAP.indexOf('function _installCardImpressions') + 1200);
    expect(fn).toMatch(/_emitCardsShown\(\);\s*\/\/ catch a feed already painted/);
  });

  it('cards_shown dedupes on the feed IDENTITY, not its size', () => {
    // Two traps this guards, both found at runtime against real data:
    //  - count alone UNDERCOUNTS a growing feed (fired at 600, settled at 1,000)
    //  - "only if larger" would silently DROP a real filter: 1,000 narrowed to 40 is
    //    40 different cards seen, and must count as an impression.
    const emit = MAP.slice(MAP.indexOf('function _emitCardsShown'), MAP.indexOf('function _emitCardsShown') + 1400);
    expect(emit).toContain('key===_lastKey');
    expect(emit).toContain('dataset.sol');     // first+last card id identifies the set
    expect(emit, 'size-based dedupe undercounts a progressive load').not.toMatch(/n\s*<=\s*_lastN/);
  });

  it('cards_shown distinguishes a browsed feed from a searched one', () => {
    // Principle 01 rests on the gap between browsing and searching. A feed arrived at by
    // typing is a different product surface than one arrived at by panning.
    expect(MAP).toContain('window.__lastQuery=q');
    const emit = MAP.slice(MAP.indexOf('function _emitCardsShown'), MAP.indexOf('function _emitCardsShown') + 1600);
    expect(emit).toContain('__lastQuery');
  });

  it('listing_share — the only event that can prove or kill the flywheel', () => {
    // Year five claims a shared listing brings a teaming partner in who browses too.
    // Without this event that claim is permanently unfalsifiable.
    expect(MAP).toMatch(/__track\('tool_use','listing_share'/);
  });
});
