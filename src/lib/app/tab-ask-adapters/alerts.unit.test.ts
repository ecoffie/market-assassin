/**
 * Ask Mindy → Alerts adapter: plain English → the tab's own search box + state dropdown, or null
 * (→ chat) when the tab's controls cannot express the question.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { alertsAskAdapter as A, type AlertsAskParams } from './alerts';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const q = (s: string): AlertsAskParams | null => A.toQuery(ask(s));

describe('alerts adapter — toQuery', () => {
  it('every example is expressible in the tab’s controls', () => {
    for (const ex of A.examples) expect(q(ex), ex).not.toBeNull();
  });

  it('words → the search box; a state → the state dropdown', () => {
    expect(q('cybersecurity')).toEqual({ search: 'cybersecurity', state: '' });
    expect(q('janitorial services in Florida')).toEqual({ search: 'janitorial', state: 'FL' });
    expect(q('IT help desk in Virginia')).toEqual({ search: 'it help desk', state: 'VA' });
  });

  it('the tab’s own nouns never become a keyword', () => {
    expect(q('cybersecurity opportunities')).toEqual({ search: 'cybersecurity', state: '' });
    expect(q('cybersecurity solicitations')).toEqual({ search: 'cybersecurity', state: '' });
    expect(q('open opportunities in Texas')).toEqual({ search: '', state: 'TX' });
  });

  it('what the tab cannot express returns null with a plain reason — never a guess', () => {
    const cases: Array<[string, RegExp]> = [
      ['Navy cybersecurity', /buyer/],
      ['541512 in Virginia', /NAICS or PSC/],
      ['8(a) janitorial', /set-aside/],
      ['cloud, cyber', /one phrase/],
      ['janitorial in Texas and Florida', /one state/],
      ['cybersecurity -training', /exclude/],
      ['cybersecurity forecasts', /planned buys/],
      ['how do I win a Navy contract', /question for Mindy/],
      ['', /Type what you sell/],
    ];
    for (const [s, why] of cases) {
      expect(q(s), s).toBeNull();
      expect(A.whyNot(ask(s)), s).toMatch(why);
    }
  });
});

describe('alerts adapter — summary', () => {
  it('names what was searched and the count; unknown is never 0', () => {
    expect(A.summary(ask('janitorial services in Florida'), { shown: 14, more: false }))
      .toBe('Mindy searched: janitorial · FL — 14 open opportunities');
    expect(A.summary(ask('cybersecurity'), { shown: 1, more: false })).toBe('Mindy searched: cybersecurity — 1 open opportunity');
    expect(A.summary(ask('cybersecurity'), null)).toBe('Mindy searched: cybersecurity — open opportunities count unavailable');
    expect(A.summary(ask('cybersecurity'), null)).not.toMatch(/\b0\b/);
  });

  it('a state alone says it is the profile feed; a fiscal year says it was not applied', () => {
    expect(A.summary(ask('open opportunities in Texas'), { shown: 3, more: false })).toMatch(/in your profile feed$/);
    expect(A.summary(ask('cybersecurity FY2027'), { shown: 3, more: false })).toMatch(/FY2027 isn’t a filter on this tab/);
  });
});
