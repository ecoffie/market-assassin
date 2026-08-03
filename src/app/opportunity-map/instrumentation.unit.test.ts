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

describe('the tracker itself', () => {
  it('posts to the SAME endpoint the panels use', () => {
    // Not a new table, not a new pipeline — the admin dashboard already reads
    // user_engagement, so map events show up there with no schema change.
    expect(MAP).toContain("fetch('/api/app/engagement'");
  });

  it('uses an allowlisted eventType', () => {
    // The endpoint rejects anything outside EventTypes. Map specifics ride in
    // metadata.action rather than inventing a type that would 400.
    const fn = MAP.slice(MAP.indexOf('function _track('), MAP.indexOf('function _track(') + 1400);
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
    const fn = MAP.slice(MAP.indexOf('function _track('), MAP.indexOf('function _track(') + 1400);
    expect(fn).toContain('.catch(function(){})');
    expect(fn).toMatch(/^\s*try\{/m);
    expect(fn).not.toContain('await ');
  });

  it('survives a navigation away', () => {
    // A listing_open immediately followed by a click-out would otherwise be lost.
    const fn = MAP.slice(MAP.indexOf('function _track('), MAP.indexOf('function _track(') + 1400);
    expect(fn).toContain('keepalive:true');
  });

  it('sends nothing for a signed-out visitor', () => {
    // No email means nothing to attribute, and the endpoint would 401 anyway.
    const fn = MAP.slice(MAP.indexOf('function _track('), MAP.indexOf('function _track(') + 1400);
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

  it('listing_share — the only event that can prove or kill the flywheel', () => {
    // Year five claims a shared listing brings a teaming partner in who browses too.
    // Without this event that claim is permanently unfalsifiable.
    expect(MAP).toMatch(/__track\('tool_use','listing_share'/);
  });
});
