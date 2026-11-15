import { describe, it, expect } from 'vitest';
import { impliedStates, guardUnstatedStates, guardUnstatedCities, cityNamed } from './stated-filters';

describe('implied states', () => {
  it('state names, capitalized codes and cities imply states', () => {
    expect([...impliedStates('contracts in Tennessee, Mississippi or Arkansas')]).toEqual(expect.arrayContaining(['TN', 'MS', 'AR']));
    expect(impliedStates('work in VA and MD').has('MD')).toBe(true);
    expect(impliedStates('staffing in the Memphis metro').has('TN')).toBe(true);
    expect(impliedStates('the order in Millington').has('TN')).toBe(true);
  });
  it('lower-case words are not read as state codes ("in", "or", "me")', () => {
    expect(impliedStates('who won it in or near me').size).toBe(0);
  });
  it('a question with no place implies no state', () => {
    expect(impliedStates('Who won the Navy business management support services contract in October 2026?').size).toBe(0);
  });
});

describe('guardUnstatedStates', () => {
  it('removes a state the customer never implied, with its scope qualifier', () => {
    const g = guardUnstatedStates(JSON.stringify({ state: 'VA', state_scope: 'pop', naics: '541611' }), 'Who won the Navy business management support contract in October 2026?');
    expect(JSON.parse(g.args)).toEqual({ naics: '541611' });
    expect(g.removed).toEqual(['state=VA']);
  });
  it('keeps a state implied by a city ("Memphis" -> TN)', () => {
    const raw = JSON.stringify({ state: 'TN', naics: '561320' });
    expect(guardUnstatedStates(raw, 'USACE Memphis District awards')).toEqual({ args: raw, removed: [] });
  });
  it('trims only the unstated members of a list', () => {
    const g = guardUnstatedStates(JSON.stringify({ state: 'TN,MS,VA' }), 'expiring work in Tennessee or Mississippi');
    expect(JSON.parse(g.args)).toEqual({ state: 'TN,MS' });
    expect(g.removed).toEqual(['state=VA']);
  });
  it('handles an array `states` argument', () => {
    const g = guardUnstatedStates(JSON.stringify({ states: ['TN', 'GA'] }), 'janitorial in Tennessee');
    expect(JSON.parse(g.args)).toEqual({ states: ['TN'] });
  });
  it('leaves an unrecognizable value for the tool to refuse, and leaves unparseable args alone', () => {
    const raw = JSON.stringify({ state: 'Narnia' });
    expect(guardUnstatedStates(raw, 'anything')).toEqual({ args: raw, removed: [] });
    expect(guardUnstatedStates('{"state":', 'x')).toEqual({ args: '{"state":', removed: [] });
  });
  it('uses the whole conversation (a follow-up can rely on an earlier place)', () => {
    const raw = JSON.stringify({ state: 'TN' });
    expect(guardUnstatedStates(raw, 'staffing in Memphis\nnow show only clerical')).toEqual({ args: raw, removed: [] });
  });
});

describe('guardUnstatedCities (2026-11-15 map-view Birmingham defect)', () => {
  const VIEW = '[Current map view \u2014 853+ Open Now opps in view. Location: the map area is in VA, MD, PA (plotted pins in view, most first: VA 312, MD 140, PA 90). Answer for THIS view ...]\n\nWhich agencies buy the most in this view?';

  it('the incident: a city (and state) the customer never said are both removed', () => {
    const st = guardUnstatedStates(JSON.stringify({ state: 'AL', city: 'Birmingham', naics: ['2362'] }), VIEW);
    expect(st.removed).toEqual(['state=AL']);
    const c = guardUnstatedCities(st.args, VIEW);
    expect(c.removed).toEqual(['city=Birmingham']);
    expect(JSON.parse(c.args)).toEqual({ naics: ['2362'] });
  });
  it('a state from the view preamble survives the state guard', () => {
    const st = guardUnstatedStates(JSON.stringify({ state: 'VA', naics: ['2362'] }), VIEW);
    expect(st.removed).toEqual([]);
  });
  it('a named city is kept, whatever its case or punctuation', () => {
    for (const text of ['Who buys janitorial in Memphis, TN?', 'who buys in memphis', 'MEMPHIS offices']) {
      expect(guardUnstatedCities(JSON.stringify({ city: 'Memphis', state: 'TN' }), text).removed).toEqual([]);
    }
  });
  it('Ft./Fort and multi-word names', () => {
    expect(cityNamed('Fort Worth', 'janitorial near Ft. Worth')).toBe(true);
    expect(cityNamed('San Antonio', 'work in San Antonio TX')).toBe(true);
    expect(cityNamed('San Antonio', 'work in Antonio')).toBe(false);
    expect(cityNamed('York', 'New York state')).toBe(true); // whole words only, never substrings
    expect(cityNamed('Leeds', 'needs leads')).toBe(false);
  });
  it('model-recalled suburbs around the named city collapse to the core city (metro expansion still applies)', () => {
    const r = guardUnstatedCities(JSON.stringify({ state: 'TN', cities: ['Memphis', 'Millington', 'Germantown, TN'], metro_radius_miles: 30 }), 'Navy buyers in Memphis');
    expect(r.removed).toEqual(['cities=Millington', 'cities=Germantown, TN']);
    expect(JSON.parse(r.args)).toEqual({ state: 'TN', city: 'Memphis', metro_radius_miles: 30 });
  });
  it('several named cities are all kept', () => {
    const r = guardUnstatedCities(JSON.stringify({ cities: ['Memphis', 'Nashville'] }), 'Memphis and Nashville');
    expect(r.removed).toEqual([]);
  });
  it('a comma-separated city string keeps named ones and drops the rest; a bare state token is left alone', () => {
    const r = guardUnstatedCities(JSON.stringify({ city: 'Memphis, TN, Millington' }), 'Memphis');
    expect(r.removed).toEqual(['city=Millington']);
    expect(JSON.parse(r.args).city).toBe('Memphis, TN');
  });
  it('removing every city also drops the metro radius', () => {
    const r = guardUnstatedCities(JSON.stringify({ city: 'Birmingham', metro_radius_miles: 30, naics: ['2362'] }), VIEW);
    expect(JSON.parse(r.args)).toEqual({ naics: ['2362'] });
  });
  it('no city args: untouched (same string back)', () => {
    const raw = JSON.stringify({ state: 'VA' });
    expect(guardUnstatedCities(raw, VIEW)).toEqual({ args: raw, removed: [] });
    expect(guardUnstatedCities('not json', VIEW)).toEqual({ args: 'not json', removed: [] });
  });
});
