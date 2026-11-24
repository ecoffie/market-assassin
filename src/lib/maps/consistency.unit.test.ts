import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAP_CONSISTENCY_COMBOS, checkHeaderFollowsHorizons, checkMapConsistency, comboUrl, expectedHeaderCount,
  factsFromSnapshot, parseHeaderCount, parsePill, type MapPageSnapshot, type MapRoundFacts,
} from './consistency';

/** A consistent settled round: Open + Coming soon, everything agrees. */
function facts(over: Partial<MapRoundFacts> = {}): MapRoundFacts {
  return {
    settled: true,
    countsSkipped: false,
    enabledHorizons: ['open', 'forecast'],
    horizonCounts: { open: { total: 7793, state: 'ok' }, forecast: { total: 5138, state: 'ok' } },
    unplacedListTotal: 0,
    headerCount: 12931,
    headerText: '12,931 results',
    pillShown: 1961,
    pillTotal: 12931,
    inView: 1961,
    listLength: 1961,
    listLocated: 1961,
    plotted: 1961,
    distinctLocations: 1280,
    pinsHidden: false,
    ...over,
  };
}
const codes = (f: MapRoundFacts) => checkMapConsistency(f).map((x) => `${x.severity}:${x.code}`);

describe('checkMapConsistency', () => {
  it('passes a round where header, horizons, pins and list agree', () => {
    expect(checkMapConsistency(facts())).toEqual([]);
  });

  it('flags a header that is not the sum of the enabled horizons (the 1,386 that ignored the horizon filter)', () => {
    expect(codes(facts({ headerCount: 1386, headerText: '1,386 results' }))).toContain('error:HEADER_NOT_SUM_OF_HORIZONS');
  });

  it('counts location-less list rows into the expected headline', () => {
    const f = facts({ unplacedListTotal: 85, headerCount: 13016, pillTotal: 13016, listLength: 2046, pillShown: 1961 });
    expect(expectedHeaderCount(f)).toBe(13016);
    expect(codes(f)).not.toContain('error:HEADER_NOT_SUM_OF_HORIZONS');
  });

  it('never compares against an unknown horizon as if it were 0', () => {
    const f = facts({ horizonCounts: { open: { total: 7793, state: 'ok' }, forecast: { total: null, state: 'failed' } }, headerCount: 7793, pillTotal: 7793 });
    expect(codes(f)).toEqual(['unchecked:HEADER_NOT_SUM_OF_HORIZONS']);
  });

  it('skips the header comparison when the server skipped counts (countsSkipped)', () => {
    expect(codes(facts({ countsSkipped: true, headerCount: 1 }))).toContain('unchecked:HEADER_NOT_SUM_OF_HORIZONS');
    expect(codes(facts({ countsSkipped: true, headerCount: 1 }))).not.toContain('error:HEADER_NOT_SUM_OF_HORIZONS');
  });

  it('flags plotted + list-only rows that exceed what matched', () => {
    expect(codes(facts({ headerCount: 10, horizonCounts: { open: { total: 5, state: 'ok' }, forecast: { total: 5, state: 'ok' } }, pillTotal: 10, pillShown: 8, plotted: 8, listLocated: 8, listLength: 12 })))
      .toContain('error:PLOTTED_PLUS_UNPLACED_EXCEEDS_MATCHED');
  });

  it('flags an empty list while the header counts matches in view', () => {
    expect(codes(facts({ listLength: 0, listLocated: 0, plotted: 0, pillShown: null }))).toContain('error:LIST_EMPTY_WHILE_COUNT');
    // Matches exist but none in this viewport: the documented "No matches in this map view" state.
    expect(codes(facts({ listLength: 0, listLocated: 0, plotted: 0, pillShown: null, inView: 0 }))).not.toContain('error:LIST_EMPTY_WHILE_COUNT');
    // In-view unknown: a warning, never a silent pass.
    expect(codes(facts({ listLength: 0, listLocated: 0, plotted: 0, pillShown: null, inView: null }))).toContain('warn:LIST_EMPTY_WHILE_COUNT');
  });

  it('flags "28 results" with fewer located rows on the map than in the list', () => {
    expect(codes(facts({ headerCount: 28, horizonCounts: { open: { total: 28, state: 'ok' } }, enabledHorizons: ['open'], pillTotal: 28, pillShown: 28, inView: 28, listLength: 28, listLocated: 28, plotted: 1 })))
      .toContain('error:LOCATED_ROWS_NOT_PLOTTED');
  });

  it('warns when every located result sits on one coordinate (reads as one pin)', () => {
    expect(codes(facts({ distinctLocations: 1 }))).toContain('warn:ALL_RESULTS_ONE_LOCATION');
  });

  it('does not judge pins at a zoom where pins are intentionally hidden', () => {
    expect(codes(facts({ pinsHidden: true, plotted: null, pillShown: null, pillTotal: null }))).toEqual([]);
  });

  it('flags a map pill that disagrees with the header or with what is plotted', () => {
    expect(codes(facts({ pillTotal: 9999 }))).toContain('error:PILL_TOTAL_NOT_HEADER');
    // Production 2026-11-23, NAICS 541512: pill 1,187 = list length incl. 85 location-less rows; 1,102 plotted.
    expect(codes(facts({ unplacedListTotal: 85, headerCount: 13016, pillTotal: 13016, listLength: 1187, listLocated: 1102, plotted: 1102, pillShown: 1187 })))
      .toContain('error:PILL_SHOWN_NOT_PLOTTED');
  });

  it('flags a count published for a horizon that is off, and horizons other than the ones asked for', () => {
    expect(codes(facts({ enabledHorizons: ['open'], horizonCounts: { open: { total: 12931, state: 'ok' }, forecast: { total: 5138, state: 'ok' } } })))
      .toContain('error:HORIZON_COUNT_FOR_DISABLED_HORIZON');
    expect(codes(facts({ requestedHorizons: ['forecast'] }))).toContain('error:HORIZONS_NOT_AS_REQUESTED');
    expect(codes(facts({ requestedHorizons: ['forecast', 'open'] }))).not.toContain('error:HORIZONS_NOT_AS_REQUESTED');
  });

  it('reports an unsettled round and judges nothing else', () => {
    expect(codes(facts({ settled: false, headerCount: 1 }))).toEqual(['error:NOT_SETTLED']);
  });
});

describe('checkHeaderFollowsHorizons', () => {
  it('flags a header that stays put when the horizons (and their sum) changed', () => {
    const a = facts({ enabledHorizons: ['open'], horizonCounts: { open: { total: 7793, state: 'ok' } }, headerCount: 1386 });
    const b = facts({ headerCount: 1386 });
    expect(checkHeaderFollowsHorizons(a, b).map((x) => x.code)).toEqual(['HEADER_STALE_ACROSS_HORIZONS']);
  });
  it('is quiet when the header moved, or when the horizons did not change', () => {
    const a = facts({ enabledHorizons: ['open'], horizonCounts: { open: { total: 7793, state: 'ok' } }, headerCount: 7793 });
    expect(checkHeaderFollowsHorizons(a, facts())).toEqual([]);
    expect(checkHeaderFollowsHorizons(facts(), facts())).toEqual([]);
  });
});

describe('snapshot parsing (the acceptance script call site)', () => {
  it('parses the header and the pill as the Map prints them', () => {
    expect(parseHeaderCount('7,793 results')).toBe(7793);
    expect(parseHeaderCount('1 result')).toBe(1);
    expect(parseHeaderCount('12,931 results · Coming soon partial')).toBe(12931);
    for (const t of ['? results · 3 shown · count unavailable', 'Searching… ', 'Unavailable no publisher', 'Nothing searched yet · add what you sell', '', null]) {
      expect(parseHeaderCount(t)).toBeNull();
    }
    expect(parsePill('961 of 7,793 opportunities · 508 not shown on map')).toEqual({ shown: 961, total: 7793 });
    expect(parsePill('12 opportunities')).toEqual({ shown: 12, total: 12 });
    expect(parsePill('')).toEqual({ shown: null, total: null });
  });

  // A real snapshot read from https://getmindy.ai/opportunity-map?horizon=open on 2026-11-23.
  const prodOpen: MapPageSnapshot = {
    headerText: '7,793 results',
    pillText: '961 of 7,793 opportunities · 508 not shown on map',
    pillHidden: false,
    matchTotals: { inView: 961, settled: true },
    horizonCounts: { open: { total: 7793, state: 'ok' } },
    roundEnabled: ['open'],
    horizonsLoading: [],
    unplacedForecastTotal: 0,
    listLength: 961, listLocated: 961, plotted: 961, distinctLocations: 306, pinsHidden: false,
  };

  it('turns a production snapshot into consistent facts', () => {
    const f = factsFromSnapshot(prodOpen);
    expect(f).toMatchObject({ settled: true, enabledHorizons: ['open'], headerCount: 7793, pillShown: 961, pillTotal: 7793, inView: 961, unplacedListTotal: 0 });
    expect(checkMapConsistency(f)).toEqual([]);
  });

  it('keeps unknowns unknown: missing globals become null / unsettled, never 0', () => {
    const f = factsFromSnapshot({ ...prodOpen, matchTotals: null, unplacedForecastTotal: undefined, horizonCounts: { open: { state: 'failed' } } });
    expect(f.settled).toBe(false);
    expect(f.unplacedListTotal).toBeNull();
    expect(f.horizonCounts.open).toEqual({ total: null, state: 'failed' });
    expect(factsFromSnapshot({ ...prodOpen, horizonsLoading: ['forecast'] }).settled).toBe(false);
    expect(factsFromSnapshot({ ...prodOpen, pillHidden: true })).toMatchObject({ pillShown: null, pillTotal: null });
  });
});

describe('combos', () => {
  it('cover each horizon alone, Open + Coming soon, a set-aside, a NAICS and a keyword', () => {
    const p = MAP_CONSISTENCY_COMBOS.map((c) => c.params);
    for (const h of ['open', 'recompete', 'forecast']) expect(p.some((x) => x.horizon === h && Object.keys(x).length === 1)).toBe(true);
    expect(p.some((x) => x.horizon === 'open,forecast')).toBe(true);
    expect(p.some((x) => x.setAside)).toBe(true);
    expect(p.some((x) => x.naics)).toBe(true);
    expect(p.some((x) => x.q)).toBe(true);
    expect(MAP_CONSISTENCY_COMBOS.length).toBeGreaterThanOrEqual(8);
  });
  it('build deep links the Map restores', () => {
    expect(comboUrl('https://getmindy.ai', MAP_CONSISTENCY_COMBOS[3])).toBe('https://getmindy.ai/opportunity-map?horizon=open%2Cforecast');
    expect(comboUrl('https://x.vercel.app/', { name: 'k', params: { horizon: 'open', q: 'cyber security' } }))
      .toBe('https://x.vercel.app/opportunity-map?horizon=open&q=cyber+security');
  });
});

describe('wiring — the acceptance script and the Map page agree on names', () => {
  const root = process.cwd();
  const script = readFileSync(join(root, 'scripts/acceptance/map-consistency.mts'), 'utf8');
  const route = readFileSync(join(root, 'src/app/opportunity-map/route.ts'), 'utf8');
  const tmpl = readFileSync(join(root, 'src/app/opportunity-map/template.html'), 'utf8');

  it('the script runs the shared checks over every combo and the session toggles', () => {
    expect(script).toContain("from '../../src/lib/maps/consistency'");
    expect(script).toContain('for (const combo of MAP_CONSISTENCY_COMBOS)');
    expect(script).toContain('checkMapConsistency(facts)');
    expect(script).toContain('checkHeaderFollowsHorizons(prev, next)');
    expect(script).toContain('factsFromSnapshot(await page.evaluate(collectInPage))');
    expect(script).toContain('process.exit(errors.length ? 1 : 0)');
  });

  it('every page global and element the collector reads still exists on the Map', () => {
    for (const g of ['__horizonCounts', '__mapMatchTotals', '__roundEnabled', '__horizonsLoading', '__unplacedForecastTotal', '__mapPerf', 'toggleHorizon']) {
      expect(script).toContain(g);
      expect(route).toContain(`window.${g}=`);
    }
    expect(route).toContain('function clusterRows(rows,map,cellPx)');
    expect(route).toContain('function pinTooFar(map)');
    expect(tmpl).toContain('let rows=[]');
    expect(tmpl).toContain('const layer=L.layerGroup()');
    expect(tmpl).toContain('clusterRows(rows,map,64)');
    expect(tmpl).toContain("id=\"rescount\"");
    expect(route).toContain("getElementById('mapCount')");
  });
});
