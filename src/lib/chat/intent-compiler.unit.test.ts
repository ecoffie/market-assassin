/**
 * Phase A intent compiler: constraints come from the customer's words and are enforced on the model's
 * tool arguments. One test per demonstrated failure (independent reviews 2026-11-14).
 */
import { describe, it, expect } from 'vitest';
import { compileIntent, enforceIntent } from './intent-compiler';

const NOW = new Date('2026-11-14T03:30:00Z'); // 10:30 PM Eastern on 2026-11-13
const enforce = (tool: string, args: Record<string, unknown>, text: string) => {
  const r = enforceIntent(tool, JSON.stringify(args), compileIntent(text, NOW));
  return { ...r, a: JSON.parse(r.args) };
};

describe('compileIntent', () => {
  it('reads named offices, since-dates, windows, explicit states, codes and completeness', () => {
    const c = compileIntent('All USACE Memphis District temporary personnel awards since 2019', NOW);
    expect(c).toMatchObject({ officePhrases: ['USACE Memphis District'], sinceDate: '2019-01-01', completeness: true, explicitStates: [], federalDate: '2026-11-13' });
    const r1 = compileIntent('Federal contracts expiring in the next 18 months in Tennessee, Mississippi or Arkansas for temporary staffing, clerical, admin and warehouse work', NOW);
    expect(r1).toMatchObject({ windowMonths: 18, explicitStates: ['AR', 'MS', 'TN'], capabilityCodes: ['561320', '561110', '493110'] });
  });
  it('never reads an acronym as a state ("Navy ID card", "VA BPAs")', () => {
    expect(compileIntent('Is the Navy ID card administration order in Millington still active?', NOW).explicitStates).toEqual([]);
    expect(compileIntent('How much 561320 spending runs through GSA Schedules vs VA BPAs?', NOW).explicitStates).toEqual([]);
  });
});

describe('enforceIntent: the model cannot drop or override a stated constraint', () => {
  it('R3 (runs F/H): a named office replaces a broader agency, the office is the scope (no city-implied state), since-date enforced', () => {
    const r = enforce('search_past_contracts', { agency: 'USACE', state: 'TN', state_scope: 'pop', naics: '561320' }, 'All USACE Memphis District temporary personnel awards since 2019');
    expect(r.a).toEqual({ agency: 'USACE Memphis District', naics: '561320', date_from: '2019-01-01' });
    expect(r.applied.join(' | ')).toMatch(/office "USACE Memphis District".*no state filter.*since 2019-01-01/);
  });
  it('keeps the model agency when it already names the office', () => {
    const r = enforce('search_past_contracts', { agency: 'USACE Memphis District', date_from: '2019-01-01' }, 'All USACE Memphis District awards since 2019');
    expect(r.applied).toEqual([]);
  });
  it('R1/R2: dropped codes, states and the window are restored', () => {
    const r = enforce('get_expiring_contracts', { naics: '5613', state: 'TN', months_window: 12 }, 'Federal contracts expiring in the next 18 months in Tennessee, Mississippi or Arkansas for temporary staffing, clerical, admin and warehouse work');
    expect(r.a.months_window).toBe(18);
    expect(r.a.state.split(',').sort()).toEqual(['AR', 'MS', 'TN']);
    expect(r.a.naics.split(',')).toEqual(['5613', '561110', '493110']); // 561320 covered by the 5613 prefix
  });
  it('does not add anything the customer did not say', () => {
    const r = enforce('get_expiring_contracts', { naics: '561612', state: 'TX' }, 'Which agencies buy security guard services in the San Antonio area, and which of the current guard contracts in Texas expire in the next 12 months?');
    expect(r.a).toEqual({ naics: '561612', state: 'TX', months_window: 12 });
  });
  it('a window beyond the tool limit is reported as unapplied, never silently shortened', () => {
    const r = enforce('get_expiring_contracts', { naics: '561320' }, 'contracts expiring in the next 72 months for staffing');
    expect(r.unapplied).toEqual(['a 72-month window (the tool\'s maximum is 60)']);
  });
  it('a named office that a tool cannot filter on is reported as unapplied', () => {
    const r = enforce('get_agency_intel', { agency: 'Army' }, 'What does the USACE Memphis District buy?');
    expect(r.unapplied[0]).toMatch(/office "USACE Memphis District"/);
  });
});

import { dedupeToolCalls } from './intent-compiler';
describe('dedupeToolCalls (attempt 4: the planner split one question into identical calls)', () => {
  it('keeps one of several identical calls', () => {
    const a = JSON.stringify({ naics: '561320,561110,493110', state: 'TN', months_window: 18 });
    const b = JSON.stringify({ naics: '561110,561320,493110', state: 'TN', months_window: 18 });
    const r = dedupeToolCalls([{ id: 'c1', name: 'get_expiring_contracts', args: a }, { id: 'c2', name: 'get_expiring_contracts', args: b }]);
    expect(r.keep.map((c) => c.id)).toEqual(['c1']);
    expect(r.duplicates).toEqual([{ id: 'c2', of: 'c1' }]);
  });
  it('drops a call whose codes are a subset of another with the same place (city vs cities)', () => {
    const r = dedupeToolCalls([
      { id: 'o1', name: 'get_buying_offices', args: JSON.stringify({ state: 'TN', city: 'Memphis', naics: '561320,561110' }) },
      { id: 'o2', name: 'get_buying_offices', args: JSON.stringify({ state: 'TN', cities: ['Memphis'], naics: '561320' }) },
      { id: 'o3', name: 'get_buying_offices', args: JSON.stringify({ state: 'TN', cities: ['Memphis'], naics: '561110' }) },
    ]);
    expect(r.keep.map((c) => c.id)).toEqual(['o1']);
  });
  it('keeps genuinely different searches', () => {
    const r = dedupeToolCalls([
      { id: 'a', name: 'get_buying_offices', args: JSON.stringify({ state: 'TX', city: 'San Antonio', naics: '561612' }) },
      { id: 'b', name: 'get_expiring_contracts', args: JSON.stringify({ state: 'TX', naics: '561612', months_window: 12 }) },
      { id: 'c', name: 'get_expiring_contracts', args: JSON.stringify({ state: 'TN', naics: '561612', months_window: 12 }) },
    ]);
    expect(r.keep.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});
