/**
 * Ask Mindy → OSBP "Find Capable Small Businesses" adapter. The tab's API (/api/app/osbp/smb-search)
 * takes ONE PSC and ONE NAICS code. Everything else must hand off to chat, never guess.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { osbpSmbAskAdapter as A, type OsbpSmbAskParams } from './osbp-smb';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const query = (q: string) => A.toQuery(ask(q));

describe('osbpSmbAskAdapter', () => {
  it('every example maps onto the tab\'s filters', () => {
    expect(A.examples.length).toBeGreaterThanOrEqual(2);
    for (const e of A.examples) expect(A.toQuery(ask(e)), e).not.toBeNull();
  });

  const cases: Array<[string, OsbpSmbAskParams]> = [
    ['PSC J998', { psc: 'J998', naics: '' }],
    ['J998', { psc: 'J998', naics: '' }],
    ['NAICS 336611', { psc: '', naics: '336611' }],
    ['336611', { psc: '', naics: '336611' }],
    ['PSC R425 NAICS 541330', { psc: 'R425', naics: '541330' }],
    ['small businesses for PSC J998', { psc: 'J998', naics: '' }],
    ['PSC R425 small business', { psc: 'R425', naics: '' }],
  ];
  for (const [q, want] of cases) {
    it(`"${q}" → the tab's own params`, () => expect(query(q)).toEqual(want));
  }

  it('what the tab cannot express hands off to chat with a plain reason', () => {
    const nulls: Array<[string, RegExp]> = [
      ['ship repair', /not by words/],
      ['ship repair PSC J998', /not by words/],
      ['PSC J998, R425', /one PSC code at a time/],
      ['PSC J998 8(a)', /specific set-aside program/],
      ['Navy PSC J998', /buyer/],
      ['PSC J998 in Florida', /state/],
      ['how do I find vendors for J998', /question for Mindy/],
      ['', /PSC code of what you/],
      ['small businesses', /PSC code of what you/],
    ];
    for (const [q, why] of nulls) {
      expect(query(q), q).toBeNull();
      expect(A.whyNot(ask(q)), q).toMatch(why);
    }
  });

  it('summary names the codes searched and never turns an unknown count into 0', () => {
    expect(A.summary(ask('PSC J998'), { shown: 50, more: true }))
      .toBe('Mindy searched: PSC J998 — 50+ capable businesses (showing the first 50)');
    expect(A.summary(ask('PSC R425 NAICS 541330'), { shown: 1, more: false }))
      .toBe('Mindy searched: PSC R425 · NAICS 541330 — 1 capable business');
    const unknown = A.summary(ask('NAICS 336611'), null);
    expect(unknown).toContain('count unavailable');
    expect(unknown).not.toMatch(/\b0\b/);
  });
});
