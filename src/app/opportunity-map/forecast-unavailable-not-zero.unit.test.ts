/**
 * Maps: an UNAVAILABLE or UNKNOWN horizon count can never render as "0" (2026-09-23).
 *
 * After canonical Forecast coverage (#1667) the forecast-map API returns totalForFilters: null and
 * discovery.coverage 'unestablished' for a buyer with no forecast publisher (NOAA, HUD, SBA, COMMERCE,
 * FAA). The client used to read it as `d.totalForFilters||0` and print "0". Four meanings must survive
 * to the screen: ok (0 is real) · partial (measured count + named gaps) · unavailable · unknown.
 * The client helpers are EXECUTED here (extracted from the served source), not just grepped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const served = readFileSync(join(__dirname, 'template-html.ts'), 'utf8');

function extractFn(src: string, name: string): string {
  const s = src.indexOf(`function ${name}(`); const o = src.indexOf('{', s); let d = 0;
  for (let i = o; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(s, i + 1); } }
  throw new Error(name + ' not found');
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lib = new Function(['horizonCount', 'horizonCountLabel', 'coverageNote'].map((n) => extractFn(route, n)).join('\n')
  + ';return {horizonCount, horizonCountLabel, coverageNote};')() as any;
const fmt = (n: number) => String(n);

// Real production responses (getmindy.ai @ 1151aa9a, 2026-09-23), trimmed to the fields that matter.
const NOAA = { success: true, totalForFilters: null, unmappedForFilters: null, pins: [], discovery: { coverage: 'unestablished', coverage_gaps: [{ requested: 'NOAA', reason: 'unresolved_publisher' }] } };
const FAA = { success: true, totalForFilters: null, unmappedForFilters: null, pins: [], discovery: { coverage: 'unestablished', coverage_gaps: [{ requested: 'FAA', reason: 'publisher_without_forecasts' }] } };
const EPA_ZERO = { success: true, totalForFilters: 0, unmappedForFilters: 0, pins: [], discovery: { coverage: 'ok' } };
const PARTIAL = { success: true, totalForFilters: 15, unmappedForFilters: 1, pins: [], discovery: { coverage: 'partial', coverage_gaps: [{ requested: 'NOAA', reason: 'unresolved_publisher' }] } };
const COUNT_FAILED = { success: true, totalForFilters: null, unmappedForFilters: 3, pins: [] };

describe('horizonCount keeps four meanings apart', () => {
  it('unavailable (NOAA, FAA) → total null, never 0', () => {
    for (const d of [NOAA, FAA]) {
      const c = lib.horizonCount(d);
      expect(c.state).toBe('unavailable');
      expect(c.total).toBeNull();
      expect(lib.horizonCountLabel(c, fmt)).toBe('n/a');
    }
  });
  it('covered + zero results → a real 0', () => {
    const c = lib.horizonCount(EPA_ZERO);
    expect(c).toEqual({ total: 0, state: 'ok', gaps: [] });
    expect(lib.horizonCountLabel(c, fmt)).toBe('0');
    expect(lib.coverageNote({ forecast: c })).toBe('');
  });
  it('partial → the measured count, marked, with the missing buyer named', () => {
    const c = lib.horizonCount(PARTIAL);
    expect(c).toEqual({ total: 15, state: 'partial', gaps: ['NOAA'] });
    expect(lib.horizonCountLabel(c, fmt)).toBe('15*');
    expect(lib.coverageNote({ forecast: c })).toBe('Forecasts partial — not measured for NOAA');
  });
  it('a failed count (null, coverage ok) → unknown, never 0', () => {
    const c = lib.horizonCount(COUNT_FAILED);
    expect(c.state).toBe('unknown');
    expect(c.total).toBeNull();
    expect(lib.horizonCountLabel(c, fmt)).toBe('?');
  });
  it('the note names the unavailable buyer and says it is not zero', () => {
    expect(lib.coverageNote({ forecast: lib.horizonCount(NOAA) })).toBe('Forecasts unavailable for NOAA (no forecast publisher) — not zero');
  });
});

describe('wiring — no null-to-zero coercion left on the horizon path', () => {
  // The OPPORTUNITY horizon path only — the Players (contacts) branch shares _fetchViewNow but is a
  // different dataset with its own count contract.
  const _fb = route.slice(route.indexOf('function _partFrom('), route.indexOf('_unplacedFoot();'));
  const fetchBlock = _fb.slice(0, _fb.indexOf('// ── Companies / Gov Buyers')) + _fb.slice(_fb.indexOf('// ── OPPORTUNITIES map'));
  it('the per-horizon fetch uses horizonCount, not `totalForFilters||0`', () => {
    expect(fetchBlock).toContain('var hc=horizonCount(d);');
    expect(fetchBlock).toContain('total:hc.total,count:hc,');
    expect(fetchBlock).not.toMatch(/total:d\.totalForFilters\|\|0/);
  });
  it('the headline sums only MEASURED totals; a null contributes nothing rather than a fake 0 row', () => {
    expect(fetchBlock).toContain("tot+=(typeof p.total==='number'?p.total:0)");
    expect(fetchBlock).toContain('window.__coverageAllUnavailable=');
  });
  it('the header renders "Unavailable" BEFORE the empty-total early return', () => {
    const hdr = extractFn(route, 'updateHeader');
    const unav = hdr.indexOf('if(window.__coverageAllUnavailable){');
    const early = hdr.indexOf('if(!TOTAL)return;');
    expect(unav).toBeGreaterThan(-1);
    expect(unav).toBeLessThan(early);
    expect(hdr).toContain('>Unavailable</span>');
  });
  it('a MEASURED zero or an UNKNOWN count repaints the header and hides the stale map pill (browser-found, 2026-09-23)', () => {
    const hdr = extractFn(route, 'updateHeader');
    const branch = hdr.indexOf('var _reported=');
    const early = hdr.lastIndexOf('if(!TOTAL)return;');
    expect(branch).toBeGreaterThan(-1);
    expect(branch).toBeLessThan(early);
    const block = hdr.slice(branch, early);
    expect(block).toContain("_hc[h].state==='unknown'");
    expect(block).toContain("'<span style=\"font-weight:700;color:var(--ink)\">?</span>");   // unknown → "?", never 0
    expect(block).toContain("_mc0.hidden=true");                                             // no stale "3,174 of 129,849"
  });
  it('the Horizons dropdown prints the count STATE label, not fmt(null) = "0"', () => {
    expect(route).toContain('horizonCountLabel(C,fmt)');
  });
  it('the empty feed says "coverage unavailable", not "No opportunities match" (source + served)', () => {
    for (const src of [tmpl, served]) {
      expect(src).toContain('window.__coverageAllUnavailable');
      expect(src).toContain('Forecast coverage unavailable');
    }
    const draw = extractFn(tmpl, 'drawFeed');
    expect(draw.indexOf('window.__coverageAllUnavailable')).toBeLessThan(draw.indexOf('No opportunities match'));
  });
});
