import { describe, it, expect } from 'vitest';
import {
  CHANGE_CLASS_KEYS, RENDERABLE_CLASSES, WITHHELD_CLASSES,
  countOf, summarise, marketLink, recordLink, scopeLabel, scopeQuery, hasScope,
  type ClassResult, type MarketScope,
} from './change-classes';

const scope: MarketScope = {
  basis: 'last_filter',
  filters: { naics: '541512', state: 'FL' },
  label: 'NAICS 541512 · FL',
  query: 'naics=541512&state=FL',
};

describe('the registry is complete and honest', () => {
  it('every class is either renderable or explicitly withheld — no class is unaccounted for', () => {
    const accounted = new Set<string>([...RENDERABLE_CLASSES, ...WITHHELD_CLASSES.map((w) => w.key)]);
    for (const k of CHANGE_CLASS_KEYS) expect(accounted.has(k)).toBe(true);
    expect(accounted.size).toBe(CHANGE_CLASS_KEYS.length);
  });

  it('a class is never BOTH renderable and withheld', () => {
    for (const w of WITHHELD_CLASSES) {
      expect(RENDERABLE_CLASSES as readonly string[]).not.toContain(w.key);
    }
  });

  it('every withheld class cites live evidence, not an opinion', () => {
    for (const w of WITHHELD_CLASSES) {
      expect(w.evidence.length).toBeGreaterThan(60);
      // A measurement contains a number. "we think it is unreliable" does not.
      expect(w.evidence).toMatch(/\d/);
    }
  });

  it('the four classes we refuse to count are exactly the four the audit disqualified', () => {
    expect(WITHHELD_CLASSES.map((w) => w.key).sort()).toEqual(
      ['amendment', 'deadline_moved', 'forecast_change', 'recompete_moved'],
    );
  });
});

describe('unknown is not zero', () => {
  it('countOf yields a number ONLY for a measured class', () => {
    expect(countOf({ state: 'measured', count: 7, detail: null })).toBe(7);
    expect(countOf({ state: 'measured', count: 0, detail: null })).toBe(0);
    expect(countOf({ state: 'no_basis', why: 'x' })).toBeNull();
    expect(countOf({ state: 'unknown', why: 'x' })).toBeNull();
  });

  it('a class we could not establish contributes NOTHING to the line — not "0"', () => {
    const line = summarise({
      newInMarket: { state: 'no_basis', why: 'no_market_scope' },
      listingClosed: { state: 'unknown', why: 'query_failed' },
    });
    expect(line).toBe('');
    expect(line).not.toMatch(/0/);
  });

  it('a class measured at ZERO is also dropped — true, but not news', () => {
    const line = summarise({
      newInMarket: { state: 'measured', count: 0, detail: { scope, link: '/opportunity-map' } },
      listingClosed: { state: 'measured', count: 2, detail: { listings: [], resolved: 4, unresolved: 1 } },
    });
    expect(line).toBe('2 you opened have closed');
  });

  it('nothing true to say -> empty string, so the caller renders NO strip', () => {
    expect(summarise({
      newInMarket: { state: 'measured', count: 0, detail: { scope, link: '/x' } },
      listingClosed: { state: 'measured', count: 0, detail: { listings: [], resolved: 3, unresolved: 0 } },
    })).toBe('');
  });

  it('renders the measured target line', () => {
    expect(summarise({
      newInMarket: { state: 'measured', count: 7, detail: { scope, link: '/x' } },
      listingClosed: { state: 'measured', count: 2, detail: { listings: [], resolved: 5, unresolved: 0 } },
    })).toBe('7 new opportunities · 2 you opened have closed');
  });

  it('singulars read correctly', () => {
    expect(summarise({
      newInMarket: { state: 'measured', count: 1, detail: { scope, link: '/x' } },
      listingClosed: { state: 'measured', count: 1, detail: { listings: [], resolved: 1, unresolved: 0 } },
    })).toBe('1 new opportunity · 1 you opened has closed');
  });
});

describe('record links vs market links (docs/engineering/record-links-vs-market-links.md)', () => {
  it('a RECORD link carries the notice id and NOTHING that can exclude it', () => {
    const l = recordLink('2632f79a0d98428195d0a25947092723');
    expect(l).toBe('/opportunity-map?opp=2632f79a0d98428195d0a25947092723');
    // The incident this rule came from: profile scope on a per-record CTA emptied the map.
    for (const forbidden of ['naics', 'state', 'agency', 'subAgency', 'ss=', 'setAside']) {
      expect(l).not.toContain(forbidden);
    }
  });

  it('a record link never carries a status/scope param that a CLOSED listing would fail', () => {
    // Every listing in this class is past its deadline, so any status scope deletes it.
    expect(recordLink('abc')).not.toMatch(/status|closingDays|active/);
  });

  it('a MARKET link carries the same scope the count was computed from', () => {
    expect(marketLink(scope)).toBe('/opportunity-map?naics=541512&state=FL');
  });

  it('a scopeless market link degrades to the bare map, not to a broken query', () => {
    expect(marketLink({ ...scope, query: '' })).toBe('/opportunity-map');
  });
});

describe('scopeQuery allowlist', () => {
  it('keeps only genuine market scope', () => {
    expect(scopeQuery({ naics: '541512', agency: 'Navy', state: 'fl' }))
      .toBe('naics=541512&agency=Navy&state=fl');
  });

  it('DROPS telemetry noise that would otherwise ride onto a shareable URL', () => {
    const q = scopeQuery({
      naics: '541512', bbox: { n: 1, s: 2 }, zoom: 7.5, entry: 'listing_link',
      device: 'mobile', vw: 360, anon: true, horizons: { open: true }, surface: 'opportunity_map',
    } as Record<string, unknown>);
    expect(q).toBe('naics=541512');
  });

  it('carries fullOpen through in any of the shapes the map stores it as', () => {
    expect(scopeQuery({ fullOpen: true })).toBe('fullOpen=1');
    expect(scopeQuery({ fullOpen: 'true' })).toBe('fullOpen=1');
    expect(scopeQuery({ fullOpen: false })).toBe('');
  });

  it('an empty or junk payload is NOT a market', () => {
    expect(hasScope({})).toBe(false);
    expect(hasScope(null)).toBe(false);
    expect(hasScope({ naics: '   ' })).toBe(false);
    expect(hasScope({ device: 'mobile' })).toBe(false);
    expect(hasScope({ naics: '541512' })).toBe(true);
  });
});

describe('scopeLabel is derived from the filters, never asserted', () => {
  it('names a single NAICS code exactly', () => {
    expect(scopeLabel({ naics: '541512' })).toBe('NAICS 541512');
  });
  it('does not pretend a 9-code sweep is one market', () => {
    expect(scopeLabel({ naics: '541611,541612,541618' })).toBe('3 NAICS codes');
  });
  it('combines the parts the visitor actually set', () => {
    expect(scopeLabel({ q: 'electrical', naics: '238210', state: 'dc' }))
      .toBe('"electrical" · NAICS 238210 · DC');
  });
  it('is empty when nothing was set', () => {
    expect(scopeLabel({})).toBe('');
  });
});

describe('type-level guard', () => {
  it('only the measured arm can carry a count', () => {
    const r: ClassResult = { state: 'no_basis', why: 'x' };
    // @ts-expect-error — `count` does not exist on the no_basis arm. This is the
    // enforcement: rendering a number for an unestablished class is a TYPE ERROR.
    expect(r.count).toBeUndefined();
  });
});
