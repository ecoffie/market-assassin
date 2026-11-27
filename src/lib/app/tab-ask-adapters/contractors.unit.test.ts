/**
 * Ask Mindy → Contractors adapter. The tab's API (/api/contractors/search-bq) takes a COMPANY-NAME
 * search, NAICS, and one state (name path only). Everything else must hand off to chat, never guess.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { contractorsAskAdapter as A, type ContractorsAskParams } from './contractors';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const query = (q: string) => A.toQuery(ask(q));

describe('contractorsAskAdapter', () => {
  it('every example maps onto the tab\'s filters', () => {
    expect(A.examples.length).toBeGreaterThanOrEqual(2);
    for (const e of A.examples) expect(A.toQuery(ask(e)), e).not.toBeNull();
  });

  const cases: Array<[string, ContractorsAskParams]> = [
    ['top contractors in NAICS 541512', { search: '', naics: '541512', state: '' }],
    ['NAICS 541512 contractors', { search: '', naics: '541512', state: '' }],
    ['who are the top firms for 236220', { search: '', naics: '236220', state: '' }],
    ['contractors in Virginia', { search: '', naics: '', state: 'VA' }],
    ['companies named Leidos', { search: 'leidos', naics: '', state: '' }],
    ['Booz Allen', { search: 'booz allen', naics: '', state: '' }],
    ['Leidos in Virginia', { search: 'leidos', naics: '', state: 'VA' }],
    ['company name Booz Allen in VA', { search: 'booz allen', naics: '', state: 'VA' }],
  ];
  for (const [q, want] of cases) {
    it(`"${q}" → the tab's own params`, () => expect(query(q)).toEqual(want));
  }

  it('a capability in words is NOT turned into a company-name search (hands off instead)', () => {
    for (const q of ['top cybersecurity contractors in Virginia', 'janitorial contractors', 'cybersecurity firms']) {
      expect(query(q), q).toBeNull();
      expect(A.whyNot(ask(q))).toMatch(/company name or NAICS code/);
    }
  });

  it('what the tab cannot express hands off to chat with a plain reason', () => {
    const nulls: Array<[string, RegExp]> = [
      ['biggest VA contractors in Florida', /agency/],
      ['8(a) contractors in VA', /set-aside/],
      ['541512 in Florida', /state filter works with a company-name search/],
      ['how do I compete with Leidos', /question for Mindy/],
      ['cloud, cyber', /one company name at a time/],
      ['top contractors', /company name, a NAICS code, or a state/],
      ['', /company name, a NAICS code, or a state/],
    ];
    for (const [q, why] of nulls) {
      expect(query(q), q).toBeNull();
      expect(A.whyNot(ask(q)), q).toMatch(why);
    }
  });

  it('summary names what was searched and never turns an unknown count into 0', () => {
    expect(A.summary(ask('companies named Leidos'), { shown: 3, more: false }))
      .toBe('Mindy searched: name contains “leidos” — 3 contractors');
    expect(A.summary(ask('top contractors in NAICS 541512'), { shown: 25, more: true }))
      .toBe('Mindy searched: NAICS 541512 — 25+ contractors (showing the first 25)');
    const unknown = A.summary(ask('contractors in Virginia'), null);
    expect(unknown).toBe('Mindy searched: VA — contractors count unavailable');
    expect(unknown).not.toMatch(/\b0\b/);
  });

  it('a fiscal year is not a filter here: the search runs and the summary says so', () => {
    const a = ask('236220 contractors FY2025');
    expect(A.toQuery(a)).toEqual({ search: '', naics: '236220', state: '' });
    expect(A.summary(a, { shown: 1, more: false })).toContain('FY2025 isn’t a filter on this tab, so all years are shown');
    expect(query('FY2025')).toBeNull();
  });
});
