/**
 * Maps P0 (2026-09-24): market truth vs viewport pins. `counts=0` lets a PAN skip every
 * bbox-independent count on all three horizon routes — and the skipped fields are OMITTED
 * (countsSkipped:true), never reported as 0 or null (null already means "unknown").
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wantsMarketCounts } from './map-counts-mode';

const q = (s: string) => new URLSearchParams(s);
const api = (r: string) => readFileSync(join(__dirname, '../../app/api/app', r, 'route.ts'), 'utf8');
const recompetePaths = () => readFileSync(join(__dirname, '../recompete/recompete-map-paths.ts'), 'utf8');

describe('wantsMarketCounts', () => {
  it('only an explicit counts=0 skips market truth; every other caller is unchanged', () => {
    expect(wantsMarketCounts(q(''))).toBe(true);
    expect(wantsMarketCounts(q('counts=1'))).toBe(true);
    expect(wantsMarketCounts(q('counts=false'))).toBe(true);
    expect(wantsMarketCounts(q('counts=0'))).toBe(false);
  });
});

describe('each Maps horizon route honors counts=0 without fabricating a number', () => {
  for (const r of ['opportunity-map', 'recompete-map', 'forecast-map']) {
    it(`${r}: uses the shared switch and flags the skip`, () => {
      // Gate 2 (2026-09-24): the recompete reads + body builder live in recompete-map-paths.ts.
      const src = r === 'recompete-map' ? api(r) + recompetePaths() : api(r);
      expect(src).toContain("import { wantsMarketCounts } from '@/lib/opportunities/map-counts-mode';");
      expect(src).toContain('const withCounts = wantsMarketCounts(p);');
      expect(src).toContain('countsSkipped: true');
      // never "0 because we skipped it"
      expect(src).not.toMatch(/withCounts\s*\?\s*[^:]+:\s*0\b/);
    });
  }
  it('opportunity-map skips BOTH whole-corpus counts (paged distinct walk + unmapped head)', () => {
    const src = api('opportunity-map');
    expect(src).toContain('const totalP = withCounts ? countUniqueListingsForFilters() : Promise.resolve(0);');
    expect(src).toContain('const unmappedP = withCounts ? countUnmappedForFilters() : Promise.resolve(null);');
    expect(src).toContain('totalForFilters: withCounts || earlyFiltered ?');
  });
  it('recompete-map runs its market counts CONCURRENTLY with the pins (no sequential phase) and skips them on a pan', () => {
    const src = recompetePaths();
    expect(src).toContain('await Promise.all([countsP, Promise.all([viewQ, followOnP])])');
    expect(src).toMatch(/const countsP = withCounts\s*\?\s*Promise\.all\(\[totalForFiltersHead, unmappedHead\]\)/);
  });
  it('forecast-map reads pins + counts + unplaced rows concurrently, not four serial round-trips', () => {
    const src = api('forecast-map');
    expect(src).toMatch(/await Promise\.all\(\[\s*getForecastViewportPins\(/);
  });
});
