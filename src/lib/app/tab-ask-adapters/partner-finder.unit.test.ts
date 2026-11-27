/**
 * Ask Mindy → Partner Finder adapter. The tab's API (/api/app/capability-search, "Describe the work")
 * takes ONE description `q` and one `state`. Everything else must hand off to chat, never guess.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { partnerFinderAskAdapter as A, type PartnerFinderAskParams } from './partner-finder';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const query = (q: string) => A.toQuery(ask(q));

describe('partnerFinderAskAdapter', () => {
  it('every example maps onto the tab\'s filters', () => {
    expect(A.examples.length).toBeGreaterThanOrEqual(2);
    for (const e of A.examples) expect(A.toQuery(ask(e)), e).not.toBeNull();
  });

  const cases: Array<[string, PartnerFinderAskParams]> = [
    ['cybersecurity partners in Virginia', { q: 'cybersecurity', state: 'VA' }],
    ['wildland firefighting crews', { q: 'wildland firefighting crews', state: '' }],
    ['janitorial teaming partners in Florida', { q: 'janitorial', state: 'FL' }],
    ['drone and unmanned aircraft maintenance', { q: 'drone unmanned aircraft maintenance', state: '' }],
  ];
  for (const [q, want] of cases) {
    it(`"${q}" → the tab's own params`, () => expect(query(q)).toEqual(want));
  }

  it('what the tab cannot express hands off to chat with a plain reason', () => {
    const nulls: Array<[string, RegExp]> = [
      ['Navy cybersecurity partners', /agency/],
      ['8(a) partners for cyber', /set-aside/],
      ['partners in NAICS 541512', /not by NAICS or PSC code/],
      ['cloud, cyber', /one description/],
      ['partners in Virginia', /a state alone/],
      ['how do I find a teaming partner', /question for Mindy/],
      ['', /Describe the work/],
    ];
    for (const [q, why] of nulls) {
      expect(query(q), q).toBeNull();
      expect(A.whyNot(ask(q)), q).toMatch(why);
    }
  });

  it('summary names what was searched and never turns an unknown count into 0', () => {
    expect(A.summary(ask('cybersecurity partners in Virginia'), { shown: 12, more: false }))
      .toBe('Mindy searched: cybersecurity · VA — 12 partner matches');
    expect(A.summary(ask('wildland firefighting crews'), { shown: 0, more: false }))
      .toBe('Mindy searched: wildland firefighting crews — 0 partner matches');
    const unknown = A.summary(ask('wildland firefighting crews'), null);
    expect(unknown).toBe('Mindy searched: wildland firefighting crews — partner matches count unavailable');
    expect(unknown).not.toMatch(/\b0\b/);
  });

  it('a fiscal year is not a filter here: the search runs and the summary says so', () => {
    const a = ask('janitorial partners FY2025');
    expect(A.toQuery(a)).toEqual({ q: 'janitorial', state: '' });
    expect(A.summary(a, { shown: 1, more: false })).toContain('FY2025 isn’t a filter on this tab');
  });
});
