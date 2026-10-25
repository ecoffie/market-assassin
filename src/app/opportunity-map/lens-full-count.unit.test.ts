/**
 * Today's Lens: the Map shows the FULL matching population the lens CTA promised, and says
 * separately how much of it is on the map (Eric 2026-10-25: "15 total · 12 displayed · 3 without
 * map locations — do not reduce the email count to 12").
 *
 * Lens mode ONLY. Every other Map view keeps the standard mappable-count behavior, because ~477
 * open notices are permanently location-less and listing them everywhere would change unrelated views.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

const page = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');
const api = readFileSync(join(process.cwd(), 'src/app/api/app/opportunity-map/route.ts'), 'utf8');

/** The shipped setMapCount, as the browser receives it (template literal un-doubles backslashes). */
function setMapCountSrc(): string {
  const start = page.indexOf('  function setMapCount(shown,total,more){');
  expect(start).toBeGreaterThan(-1);
  const end = page.indexOf('    el.hidden=false;\n  }', start);
  expect(end).toBeGreaterThan(start);
  return page.slice(start, end + '    el.hidden=false;\n  }'.length).replace(/\\\\/g, '\\');
}

function corner(opts: { lens: boolean; unplacedOpen: number; unmapped: number; shown: number; total: number; more: boolean }) {
  const dom = new JSDOM('<!doctype html><body><div id="mapCount" hidden></div></body>', { runScripts: 'outside-only' });
  const w = dom.window as unknown as Window & Record<string, unknown> & { eval: (s: string) => unknown };
  w.__lensFromLink = opts.lens;
  w.__unplacedOpenTotal = opts.unplacedOpen;
  w.__unmappedForFilters = opts.unmapped;
  w.eval(`var MODE='open'; function isContactMode(){return false;} function pinTooFar(){return false;} var map={};
    ${setMapCountSrc()}
    window.__run=setMapCount;`);
  (w.__run as (a: number, b: number, c: boolean) => void)(opts.shown, opts.total, opts.more);
  return w.document.getElementById('mapCount')!.textContent;
}

describe('map-corner count: full population vs on-the-map', () => {
  it('Lens mode, the browser example: 15 total, 12 located, 3 without a location (5 in view)', () => {
    // total=15 now INCLUDES the 3 listed location-less rows; unmapped hidden = 0 (all 3 are listed).
    expect(corner({ lens: true, unplacedOpen: 3, unmapped: 0, shown: 5, total: 15, more: true }))
      .toBe('5 of 12 on the map · 3 without a location');
  });
  it('Lens mode, everything located in view', () => {
    expect(corner({ lens: true, unplacedOpen: 3, unmapped: 0, shown: 12, total: 15, more: true }))
      .toBe('12 on the map · 3 without a location');
  });
  it('Lens mode with nothing location-less → the standard text', () => {
    expect(corner({ lens: true, unplacedOpen: 0, unmapped: 0, shown: 5, total: 12, more: true })).toBe('5 of 12 opportunities');
  });
  it('NOT lens mode → unchanged standard behavior ("N of M" + "K not shown on map")', () => {
    expect(corner({ lens: false, unplacedOpen: 0, unmapped: 3, shown: 5, total: 12, more: true }))
      .toBe('5 of 12 opportunities · 3 not shown on map');
  });
});

describe('location-less rows are requested ONLY in Lens mode, and only with a NAICS scope', () => {
  it('client: includeUnplaced=1 needs the lens flag AND NAICS AND applied strands', () => {
    expect(page).toContain("if(window.__lensFromLink&&FILT.naics&&FILT.strategy&&FILT.strategy.length)url+='&includeUnplaced=1';");
    expect((page.match(/url\+='&includeUnplaced=1'/g) || []).length).toBe(2);   // this one + Forecast's pre-existing one
  });
  it('client: lens mode starts from a lens link (strands + NAICS) and ends when the lens is cleared', () => {
    expect(page).toContain('if(strategy&&f.naics)window.__lensFromLink=true;');
    expect(page).toContain('x.onclick=function(){ try{ window.__lensFromLink=false;');
  });
  it('client: an Open location-less row is a SAM card with no pin, opened by notice_id', () => {
    expect(page).toContain("return m==='open'?openUnplacedToRow(u):unplacedToRow(u);");
    expect(page).toContain("var r=toRow(u,'open'); r.noPin=true; r.lat=null; r.lng=null;");
    // "not yet on SAM" stays a FORECAST-only footer — a SAM notice with no location IS on SAM.
    expect(page).toContain("${o.noPin&&o.src===\\'FORECAST\\'?\\'Forecast — not yet on SAM\\':\\'\\'}");
  });
  it('server: rows only with includeUnplaced=1 AND a NAICS scope; same filters; capped; full total kept', () => {
    expect(api).toContain("p.get('includeUnplaced') === '1' && (p.get('naics') || '').trim()");
    const block = api.slice(api.indexOf('let unplaced: Array'), api.indexOf("...(unplaced.length || unplacedTotal"));
    expect(block).toContain(".is('map_lat', null)");
    expect(block).toContain('uq = applyFilters(uq);');                 // identical eligibility
    expect(block).toContain('.limit(UNPLACED_OPEN_CAP)');
    expect(block).toContain("unplacedTotal = typeof unmappedForFilters === 'number' ? unmappedForFilters : unplaced.length;");
    expect(block).not.toMatch(/\.(update|insert|upsert|delete)\(/);      // display only — no data change
  });
});
