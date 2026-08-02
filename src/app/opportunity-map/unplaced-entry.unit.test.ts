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
const API = readFileSync(join(process.cwd(), 'src/app/api/forecasts/unplaced/route.ts'), 'utf8');
const PAGE = readFileSync(join(process.cwd(), 'src/app/opportunity-map/unplaced/route.ts'), 'utf8');
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
    expect(MAP).toContain("location.href='/opportunity-map/unplaced?q='");
  });
});

describe('entry point B — foot of the feed', () => {
  it('appends a standing row after each render', () => {
    expect(MAP).toContain('_unplacedFoot()');
  });

  it('shows ONLY on the forecast horizon', () => {
    // On an Open-only map a forecast count is a non-sequitur.
    const fn = MAP.slice(MAP.indexOf('function _unplacedFoot'), MAP.indexOf('function _unplacedFoot') + 700);
    expect(fn).toMatch(/if\(!H\.forecast\) return;/);
  });

  it('caches the count so panning does not refetch it', () => {
    const fn = MAP.slice(MAP.indexOf('function _unplacedFoot'), MAP.indexOf('function _unplacedFoot') + 900);
    expect(fn).toContain('if(_unplacedN!=null)');
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

describe('destination page mirrors the sidebar pages', () => {
  it('carries the same top nav and left rail as Favorites', () => {
    for (const marker of ['class="zhead"', 'class="zrail"', '/opportunity-map/saved', '/opportunity-map/favorites']) {
      expect(PAGE, `chrome marker ${marker}`).toContain(marker);
    }
  });

  it('marks ITSELF active in the rail, not another page', () => {
    expect(PAGE).toMatch(/<a class="on" href="\/opportunity-map\/unplaced"/);
    expect(PAGE).not.toMatch(/<a class="on" href="\/opportunity-map\/favorites"/);
  });

  it('keeps EVERY rail destination in sync across all four pages', () => {
    // The rail is duplicated per page by convention, so an item added to one page and
    // not the others is a nav that changes shape as you walk through it. This bit twice
    // in one day: /opportunity-map/unplaced (mine) and /market-explorer (from main) each
    // landed on one page only. Assert the whole set, not one destination.
    const SAVED = readFileSync(join(process.cwd(), 'src/app/opportunity-map/saved/route.ts'), 'utf8');
    const DESTINATIONS = ['/opportunity-map/saved', '/opportunity-map/favorites',
                          '/opportunity-map/unplaced', '/market-explorer'];
    for (const [name, src] of [['map', MAP], ['favorites', FAVS], ['saved', SAVED], ['unplaced', PAGE]] as const) {
      for (const d of DESTINATIONS) {
        expect(src, `${name} rail is missing ${d}`).toContain(d);
      }
    }
  });

  it('states WHY there is no pin rather than showing a blank', () => {
    expect(PAGE).toContain('whyNoPin');
    expect(PAGE).toContain('Location withheld');
    expect(PAGE).toContain('No location published');
  });
});
