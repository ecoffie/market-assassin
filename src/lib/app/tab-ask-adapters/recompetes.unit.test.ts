/**
 * Ask Mindy → Recompetes adapter: plain English → the params the tab already sends to /api/recompete
 * (naics · state · eligibleFor), or null (→ chat) when the tab's filters cannot express the question.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { recompetesAskAdapter as A, type RecompetesAskParams } from './recompetes';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const q = (s: string): RecompetesAskParams | null => A.toQuery(ask(s));

describe('recompetes adapter — toQuery', () => {
  it('every example is expressible in the tab’s filters', () => {
    for (const ex of A.examples) expect(q(ex), ex).not.toBeNull();
  });

  it('NAICS + state → the route’s naics and state params', () => {
    expect(q('541512 in Virginia')).toEqual({ naics: '541512', state: 'VA', eligibleFor: [] });
    expect(q('541512, 541519 in Virginia')).toEqual({ naics: '541512, 541519', state: 'VA', eligibleFor: [] });
  });

  it('the word "NAICS" and the tab’s own nouns never become a keyword', () => {
    expect(q('NAICS 561720 in Florida')).toEqual({ naics: '561720', state: 'FL', eligibleFor: [] });
    expect(q('expiring contracts in Texas')).toEqual({ naics: '', state: 'TX', eligibleFor: [] });
    expect(q('small business 561720 recompetes in Virginia')).toEqual({ naics: '561720', state: 'VA', eligibleFor: ['SB-Total'] });
  });

  it('set-asides map to the tab’s own lane vocabulary (recompete_opportunities.set_aside_type)', () => {
    expect(q('8(a) 236220 contracts expiring')?.eligibleFor).toEqual(['8(a)']);
    expect(q('HUBZone 236220 in Texas')?.eligibleFor).toEqual(['HUBZone']);
    expect(q('WOSB 541611 in Maryland')?.eligibleFor).toEqual(['WOSB']);
    expect(q('service-disabled veteran-owned 541512')?.eligibleFor).toEqual(['SDVOSB']);
  });

  it('what the tab cannot express returns null with a plain reason — never a guess', () => {
    const cases: Array<[string, RegExp]> = [
      ['Navy cybersecurity recompetes', /buyer/],        // buyer: route agency filter is unsafe
      ['VA 541512', /buyer/],                             // bare "va" is the agency, not a state
      ['janitorial in Florida', /not by words/],          // no keyword search on /api/recompete
      ['236220 expiring contracts in Texas and Oklahoma', /./], // two states (route state is one value)
      ['541512 -oracle', /exclude/],
      ['upcoming forecasts 541512', /planned buys/],
      ['how should I bid a recompete', /question for Mindy/],
      ['FY2027', /fiscal year alone/],
      ['', /NAICS code/],
    ];
    for (const [text, why] of cases) {
      expect(q(text), text).toBeNull();
      expect(A.whyNot(ask(text)), text).toMatch(why);
    }
  });

  it('one state only: two states hand off', () => {
    const a = ask('541512 in Virginia and Maryland');
    expect(a.intent.states.length).toBe(2);
    expect(A.toQuery(a)).toBeNull();
    expect(A.whyNot(a)).toMatch(/one state at a time/);
  });

  it('set-asides the tab does not offer hand off', () => {
    const a = ask('SDB 541512');
    if (a.intent.setAsides.includes('sdb')) {
      expect(A.toQuery(a)).toBeNull();
      expect(A.whyNot(a)).toMatch(/isn’t one of this tab’s filters/);
    }
  });
});

describe('recompetes adapter — summary', () => {
  it('says what Mindy searched and how many rows came back', () => {
    expect(A.summary(ask('541512 in Virginia'), { shown: 14, more: false }))
      .toBe('Mindy searched: NAICS 541512 · VA — 14 expiring contracts');
    expect(A.summary(ask('541512 in Virginia'), { shown: 1, more: false })).toContain('1 expiring contract');
  });

  it('unknown count is "count unavailable", never 0', () => {
    const line = A.summary(ask('541512 in Virginia'), null);
    expect(line).toContain('count unavailable');
    expect(line).not.toMatch(/\b0\b/);
  });

  it('more rows than shown says so', () => {
    expect(A.summary(ask('541512'), { shown: 200, more: true })).toContain('200+ expiring contracts (showing the first 200)');
  });

  it('a set-aside answer says unknown set-asides are included (the tab’s eligibility meaning)', () => {
    expect(A.summary(ask('HUBZone 236220 in Texas'), { shown: 5, more: false }))
      .toBe('Mindy searched: NAICS 236220 · HUBZone · TX — 5 expiring contracts (HUBZone plus contracts with no set-aside recorded)');
  });

  it('a fiscal year is never silently dropped', () => {
    expect(q('FY2027 541512')).toEqual({ naics: '541512', state: '', eligibleFor: [] });
    expect(A.summary(ask('FY2027 541512'), { shown: 3, more: false })).toContain('FY2027 isn’t a filter on this tab');
  });
});
