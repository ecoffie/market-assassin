/**
 * Zoom-aware switch (Eric 2026-07-28, threshold 990): the recompete-map endpoint returns COUNT
 * BUBBLES when the view is dense and the $-tag PIN WALL below the threshold (Zillow shows a wall).
 * These pin the route's switch + the client render wiring at source level.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, '../api/app/recompete-map/route.ts'), 'utf8'); // the API endpoint
const openRoute = readFileSync(join(__dirname, '../api/app/opportunity-map/route.ts'), 'utf8');
const pageRoute = readFileSync(join(__dirname, 'route.ts'), 'utf8'); // serves the page + VIEWPORT_JS fetch handler
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');

describe('recompete-map endpoint — zoom-aware cluster switch', () => {
  it('threshold is 990 (below the 1000 cap, so the pin wall at the switch is the FULL set)', () => {
    expect(route).toContain('CLUSTER_THRESHOLD = 990');
  });
  it('returns view:clusters when in-view count >= threshold, view:pins otherwise', () => {
    expect(route).toContain('(inViewCount ?? 0) >= CLUSTER_THRESHOLD');
    expect(route).toContain("view: 'clusters'");
    expect(route).toContain("view: 'pins'");
    expect(route).toContain('fetchRecompeteStateClusters');
  });
});

describe('client — bubble mode vs the $-tag wall', () => {
  it('the fetch handler (page route VIEWPORT_JS) branches on view:clusters and clears the pin set', () => {
    expect(pageRoute).toContain("if(d.view==='clusters')"); // the branch lives in the viewport fetch JS
    expect(pageRoute).toContain('renderClusters();');
    expect(pageRoute).toContain('OPPS=[];'); // pin set cleared in bubble mode (no double-draw)
  });
  it('renderClusters is defined in the template (draws one divIcon bubble per state)', () => {
    expect(tmpl).toContain('function renderClusters(');
    expect(tmpl).toContain('clusterBubble(c,maxCount)');
  });
  it('a bubble click zooms into that state so the view drops under the threshold → pins load', () => {
    expect(tmpl).toContain('map.setView([c.lat,c.lng], 7');
  });
  it('bubble mode shows the in-view count + a "zoom in" hint on the COUNT line (no subtitle)', () => {
    // The unknown count is still returned by the API (count conservation) but the HEADER stays a
    // clean count — the sumline subtitle is blank per Eric's Jul-26 "no SDVOSB/closing subtitle" rule
    // (Eric 2026-07-28: "you snuck in the 23 sdvosb language"). The zoom hint rides on rescount.
    expect(tmpl).toContain('in view \\\\u2014 zoom in to see each');
  });
});

describe('opportunity-map endpoint (Open) — same zoom-aware switch, JS-aggregation path', () => {
  it('threshold 990; returns view:clusters via fetchOpenStateClusters when dense', () => {
    expect(openRoute).toContain('CLUSTER_THRESHOLD = 990');
    expect(openRoute).toContain('(inViewCount ?? 0) >= CLUSTER_THRESHOLD');
    expect(openRoute).toContain('fetchOpenStateClusters');
    expect(openRoute).toContain("view: 'clusters'");
    expect(openRoute).toContain("view: 'pins'");
  });
});
