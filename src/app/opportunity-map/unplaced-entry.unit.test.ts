/**
 * Guards the two UNPLACED entry points and the reason they are separate from the feed.
 *
 * Eric, 2026-08-02: "how would someone find it otherwise?" — 11,174 current/future
 * forecasts (38% of what matches a default search) have NO coordinate, so the map can
 * never show them. The map is the product now, so without these entry points they are
 * invisible to anyone who does not already know to ask chat or the MCP tool.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');

// Slice to the function's REAL end, never a fixed character count. The two checks below used
// +700 / +900 magic windows, so simply making the markup inside _unplacedFoot longer (swapping a
// ◎/→ glyph for an SVG, 2026-08-17) pushed a still-present guard outside the window and failed a
// test on UNTOUCHED logic. That is the documented brittle-anchor class in this repo.
function unplacedFootBody(): string {
  const start = MAP.indexOf('function _unplacedFoot');
  if (start < 0) return '';
  // The next top-level `function ` at the same indentation marks the end; fall back to EOF.
  const next = MAP.indexOf('\n  function ', start + 10);
  return MAP.slice(start, next > 0 ? next : MAP.length);
}
const API = readFileSync(join(process.cwd(), 'src/app/api/forecasts/unplaced/route.ts'), 'utf8');
// /opportunity-map/unplaced was RETIRED to a redirect; the destination is now the redesigned
// /opportunity-map/forecasts browse page (Eric 2026-08-02 — "the design is bad, redesign it").
const REDIRECT = readFileSync(join(process.cwd(), 'src/app/opportunity-map/unplaced/route.ts'), 'utf8');
const PAGE = readFileSync(join(process.cwd(), 'src/app/opportunity-map/forecasts/route.ts'), 'utf8');
const FAVS = readFileSync(join(process.cwd(), 'src/app/opportunity-map/favorites/route.ts'), 'utf8');

describe('the API returns what the map CANNOT', () => {
  it('filters for map_lat IS NULL — the inverse of the pin query', () => {
    // getForecastViewportPins does .not('map_lat','is',null). This is the other half;
    // together they cover the corpus with no overlap and no gap.
    expect(API).toContain(".is('map_lat', null)");
  });

  it('excludes past fiscal years but KEEPS undated rows', () => {
    // Same rule as the map and the MCP tool. Most of this corpus is undated — dropping
    // NULLs would empty the page it exists to fill.
    expect(API).toContain('fiscal_year.is.null');
  });

  it('checks {error} on the read', () => {
    // A failed query returning data=null must not render as "no unplaced forecasts
    // exist" — that is the exact shape of the silent-failure bug class.
    expect(API).toMatch(/if \(error\)[\s\S]{0,200}console\.error/);
  });

  it('pages the facet count past PostgREST\'s 1,000-row cap', () => {
    // A single select caps at 1,000, so un-paged facet counts would describe the first
    // 1,000 of ~11k and quietly understate every agency.
    expect(API).toMatch(/for \(let from = 0; ; from \+= 1000\)/);
  });
});

describe('entry point A — search dropdown', () => {
  it('adds a row scoped to the typed query', () => {
    expect(MAP).toContain('_unplacedRow(q, panel)');
    expect(MAP).toContain("data-act','unplaced'");
  });

  it('is SILENT when nothing matches', () => {
    // A row that always appears reads as "the map is broken". It renders only on a
    // non-zero count.
    expect(MAP).toMatch(/if\(!d\|\|!d\.success\|\|!d\.total\) return;/);
  });

  it('fails silently — a suggestions panel that errors is worse than one missing a row', () => {
    const fn = MAP.slice(MAP.indexOf('function _unplacedRow'), MAP.indexOf('function _unplacedRow') + 900);
    expect(fn).toContain('.catch(function(){})');
  });

  it('routes to the destination carrying the query', () => {
    // Retired /unplaced → redesigned /forecasts (query carried through).
    expect(MAP).toContain("location.href='/opportunity-map/forecasts?q='");
  });
  it('the old /unplaced route is now a 308 redirect to /forecasts', () => {
    expect(REDIRECT).toContain('/opportunity-map/forecasts');
    expect(REDIRECT).toMatch(/NextResponse\.redirect\([\s\S]{0,80}308\)/);
  });
});

describe('entry point B — foot of the feed', () => {
  it('appends a standing row after each render', () => {
    expect(MAP).toContain('_unplacedFoot()');
  });

  it('shows ONLY on the forecast horizon', () => {
    // On an Open-only map a forecast count is a non-sequitur.
    expect(unplacedFootBody()).toMatch(/if\(!H\.forecast\) return;/);
  });

  it('caches the count so panning does not refetch it', () => {
    expect(unplacedFootBody()).toContain('if(_unplacedN!=null)');
  });
});

describe('unplaced rows are NOT merged into OPPS', () => {
  it('never pushes them into the array that builds markers', () => {
    // THE CONSTRAINT: render() does rows=OPPS.filter(pass) and then calls mkPin(o) /
    // L.circleMarker([o.lat,o.lng]) per row, with NO coordinate guard. A locationless row
    // in OPPS produces a broken marker. It would also swamp the list — 11,174 unplaced
    // against a 1,000-pin viewport cap, sorted together, when they are not in the
    // viewport at all.
    expect(MAP).not.toMatch(/OPPS\s*=\s*OPPS\.concat\([^)]*unplaced/i);
    expect(MAP).not.toMatch(/OPPS\.push\([^)]*unplaced/i);
  });
});

describe('destination page (the redesigned /forecasts) mirrors the sidebar pages', () => {
  it('carries the same top nav and left rail as Favorites', () => {
    for (const marker of ['class="zhead"', 'class="zrail"', '/opportunity-map/saved', '/opportunity-map/favorites']) {
      expect(PAGE, `chrome marker ${marker}`).toContain(marker);
    }
  });

  it('keeps the SHARED rail destinations in sync across the sub-view pages', () => {
    // The rail is duplicated per page by convention, so a destination present on one page and
    // not the others is a nav that changes shape as you walk through it. The rail was RELABELLED +
    // reduced (Eric 2026-08-05): Search→Map, Updates→Watchlist (/saved), Favorites→Saved (/favorites),
    // and MARKET WAS REMOVED from the rail ("the map is the market now — Market shouldn't compete with
    // the four core actions"). So the shared rail-destination set is now just Watchlist + Saved (Map is
    // the current page, /opportunity-map). Assert every sub-view carries the same two.
    const SAVED = readFileSync(join(process.cwd(), 'src/app/opportunity-map/saved/route.ts'), 'utf8');
    const DESTINATIONS = ['/opportunity-map/saved', '/opportunity-map/favorites'];
    for (const [name, src] of [['map', MAP], ['favorites', FAVS], ['saved', SAVED], ['forecasts', PAGE]] as const) {
      for (const d of DESTINATIONS) {
        expect(src, `${name} rail is missing ${d}`).toContain(d);
      }
      // Market is GONE from every rail (it lives under Reports / advanced now, not the primary rail).
      expect(src, `${name} rail must NOT link Market`).not.toContain('title="Market');
    }
  });

  it('the retired Unplaced rail item + /market-explorer are gone from the map rail', () => {
    // Eric's directive: forecasts surface inline (results list / Market / Ask Mindy / the
    // /forecasts browse), so there is NO standalone Unplaced rail item, and the old
    // Market-Explorer hub is retired to a redirect.
    expect(MAP).not.toMatch(/<span>Unplaced<\/span>/);
    expect(MAP).not.toContain("href=\"/market-explorer\"");
  });

  it('states WHY there is no pin rather than showing a blank', () => {
    // The redesigned page derives the reason honestly from real columns (never a guessed place):
    // a null/USA-only place → "no location"; a nationwide sentinel → "Nationwide".
    expect(PAGE).toContain('no location');
    expect(PAGE).toContain('Nationwide');
  });
});
