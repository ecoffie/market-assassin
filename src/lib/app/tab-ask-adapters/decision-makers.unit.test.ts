/**
 * Ask Mindy → Decision Makers. A plain question becomes the tab's OWN two filters (agency + the
 * name/title search box) — never a guess; anything the directory can't filter by returns null so the
 * box hands off to chat; an unknown count is never shown as 0.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { decisionMakersAgencyName, decisionMakersAskAdapter as A, type DecisionMakersAskParams } from './decision-makers';
import { subAgencyToParent, agencyToExpectedSubAgency } from '@/app/api/app/federal-contacts/route';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const query = (q: string) => A.toQuery(ask(q));
const blank: DecisionMakersAskParams = { search: '', agency: '' };

describe('decisionMakersAskAdapter.toQuery — the tab\'s own params', () => {
  it.each<[string, Partial<DecisionMakersAskParams>]>([
    ['contracting officers at the Navy', { agency: 'Department of the Navy', search: 'contracting officers' }],
    ['who are the decision makers at DLA', { agency: 'Defense Logistics Agency' }],
    ['Smith at NASA', { agency: 'National Aeronautics and Space Administration', search: 'smith' }],
    ['cybersecurity decision makers at DHS', { agency: 'Department of Homeland Security', search: 'cybersecurity' }],
    ['who buys cybersecurity at the Navy', { agency: 'Department of the Navy', search: 'cybersecurity' }],
    ['Department of Veterans Affairs', { agency: 'Department of Veterans Affairs' }],
    ['Forest Service contacts', { search: 'forest' }],
    ['Army FY2027', { agency: 'Department of the Army' }],
  ])('%s', (q, want) => {
    expect(query(q)).toEqual({ ...blank, ...want });
  });

  it('every example is a question the tab can always express', () => {
    expect(A.examples.length).toBeGreaterThanOrEqual(2);
    for (const ex of A.examples) expect(query(ex), ex).not.toBeNull();
  });

  it.each([
    ['contracting officers in Virginia', /location/],
    ['small business specialists at VA', /set-aside/],
    ['541512 contracting officers', /NAICS or PSC/],
    ['Navy and Army', /one agency at a time/],
    ['program manager, contracting officer', /one name or title at a time/],
    ['how do I reach a contracting officer', /question for Mindy/],
    ['FY2027', /fiscal year alone/],
    ['', /Type a buyer/],
  ])('hands off to chat instead of guessing: %s', (q, why) => {
    expect(query(q)).toBeNull();
    expect(A.whyNot(ask(q))).toMatch(why);
  });
});

describe('agency value: a full name the route resolves, never a bare acronym', () => {
  it('sends names, strips parenthetical acronyms', () => {
    expect(decisionMakersAgencyName('DHS')).toBe('Department of Homeland Security');
    expect(decisionMakersAgencyName('EPA')).toBe('Environmental Protection Agency');
    expect(decisionMakersAgencyName('USPS')).toBe('U.S. Postal Service');
    expect(decisionMakersAgencyName('Defense Logistics Agency')).toBe('Defense Logistics Agency');
  });

  it('the route resolves each discovery buyer code to the right parent (and branch)', () => {
    // These are the route's own resolvers — the same pipeline the Agency dropdown and Target List use.
    const cases: Array<[string, string, string | null]> = [
      ['NAVY', 'DEFENSE', 'Navy'], ['ARMY', 'DEFENSE', 'Army'], ['AIR FORCE', 'DEFENSE', 'Air Force'],
      ['USMC', 'DEFENSE', 'Marine Corps'], ['DOD', 'DEFENSE', null], ['USACE', 'DEFENSE', 'Army Corps of Engineers'],
      ['DHS', 'HOMELAND SECURITY', null], ['COAST GUARD', 'HOMELAND SECURITY', 'Coast Guard'],
      ['HHS', 'HEALTH AND HUMAN', null], ['USDA', 'AGRICULTURE', null], ['VA', 'VETERANS AFFAIRS', null],
      ['DOI', 'INTERIOR', null], ['DOT', 'TRANSPORTATION', null], ['TREASURY', 'TREASURY', null],
      ['NASA', 'AERONAUTICS', null], ['GSA', 'GENERAL SERVICES', null], ['DLA', 'DEFENSE', 'Defense Logistics Agency'],
    ];
    for (const [code, parent, branch] of cases) {
      const name = decisionMakersAgencyName(code);
      expect(subAgencyToParent(name), code).toBe(parent);
      expect(agencyToExpectedSubAgency(name), code).toBe(branch);
    }
  });
});

describe('decisionMakersAskAdapter.summary', () => {
  it('names what Mindy searched, the count, and that the search box matches text', () => {
    expect(A.summary(ask('contracting officers at the Navy'), { shown: 37, more: false }))
      .toBe('Mindy searched: Navy · contracting officers — 37 decision makers (name, title or agency contains “contracting officers”)');
    expect(A.summary(ask('DLA decision makers'), { shown: 1, more: false })).toBe('Mindy searched: DLA — 1 decision maker');
    expect(A.summary(ask('DLA decision makers'), { shown: 100, more: true }))
      .toBe('Mindy searched: DLA — 100+ decision makers (showing the first 100)');
  });

  it('an unknown count is unavailable, never 0', () => {
    const s = A.summary(ask('DLA decision makers'), null);
    expect(s).toContain('count unavailable');
    expect(s).not.toMatch(/\b0 decision makers/);
  });

  it('says a fiscal year was not applied', () => {
    expect(A.summary(ask('Army FY2027'), { shown: 5, more: false })).toContain('FY2027 isn’t a filter on this tab');
  });
});
