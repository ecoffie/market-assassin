import { describe, it, expect } from 'vitest';
import { impliedStates, guardUnstatedStates } from './stated-filters';

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
