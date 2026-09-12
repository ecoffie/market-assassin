/**
 * THE MAP-TRUTH CONTRACT must hold for ALL THREE HORIZONS, not just Open.
 *
 * THE BUG THIS GUARDS (browser-verified on prod 2026-09-12): the merged pill read
 *   "3,122 of 135,054 opportunities · 477 not shown on map"
 * 135,054 is the SUM of all three horizons (Open 9,341 + Awarded 106,965 + Forecast 18,748),
 * but 477 counted OPEN ONLY. Awarded carries 45,069 unmapped rows and Forecast 14,939 — none
 * of them disclosed. So the numerator and denominator were denominated differently and the
 * figure UNDER-REPORTED what the map was hiding, which is the precise failure this contract
 * exists to prevent. Under-disclosure is worse than no disclosure: it looks like an answer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const openSrc = readFileSync(join(__dirname, '../api/app/opportunity-map/route.ts'), 'utf8');
const recompeteSrc = readFileSync(join(__dirname, '../api/app/recompete-map/route.ts'), 'utf8');
const forecastSrc = readFileSync(join(__dirname, '../api/app/forecast-map/route.ts'), 'utf8');
const clientSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('every horizon reports what it cannot draw', () => {
  it('Open reports unmappedForFilters', () => {
    expect(openSrc).toContain('unmappedForFilters');
    expect(openSrc).toContain("is('map_lat', null)");
  });
  it('Awarded reports unmappedForFilters (45,069 rows were invisible)', () => {
    expect(recompeteSrc).toContain('unmappedForFilters');
    expect(recompeteSrc).toContain("is('map_lat', null)");
  });
  it('Forecast reports unmappedForFilters (14,939 rows were invisible)', () => {
    expect(forecastSrc).toContain('unmappedForFilters');
    expect(forecastSrc).toContain("is('map_lat', null)");
  });
  it('each treats an unestablished count as UNKNOWN, never 0', () => {
    for (const src of [openSrc, recompeteSrc, forecastSrc]) {
      expect(src).toMatch(/unmappedForFilters[^\n]*null|unmappedForFilters = uc \?\? null/);
    }
  });
});

describe('Forecast counts unconditionally', () => {
  it('the COUNT is not gated behind includeUnplaced (only the ROWS are)', () => {
    // It used to sit inside `if (hasSearchKey && includeUnplaced==='1')`, so an unfiltered view
    // reported 0 unmapped forecasts when the truth was ~14,939.
    const i = forecastSrc.indexOf('let unmappedForFilters');
    const gate = forecastSrc.indexOf("p.get('includeUnplaced') === '1'");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(gate);   // computed BEFORE the gate → unconditional
  });
});

describe('client aggregation', () => {
  it('sums unmapped across horizons, matching the summed denominator', () => {
    expect(clientSrc).toContain('unmappedTot+=');
  });
  it('does NOT double-count forecast rows already surfaced in the list', () => {
    // forecast `unplaced` rows are concat'd into OPPS and counted in TOTAL; counting them again
    // as "not shown on map" would report the same rows twice.
    expect(clientSrc).toContain("unmappedTot+=Math.max(0,(p.unmappedTotal||0)-(p.unplacedTotal||0))");
  });
  it('one UNKNOWN horizon makes the whole figure unknown (never silently 0)', () => {
    expect(clientSrc).toContain('unmappedUnknown=true');
  });
});
