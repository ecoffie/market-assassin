/**
 * Ask Mindy → DIBBS adapter: plain English → the params the tab already sends to /api/app/dibbs
 * (q · nsn · fsc), or null (→ chat) when the tab's filters cannot express the question.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { dibbsAskAdapter as A, type DibbsAskParams } from './dibbs';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const q = (s: string): DibbsAskParams | null => A.toQuery(ask(s));

describe('dibbs adapter — toQuery', () => {
  it('every example is expressible in the tab’s filters', () => {
    for (const ex of A.examples) expect(q(ex), ex).not.toBeNull();
  });

  it('an item → the tab’s keyword (q); NSN / FSC boxes cleared', () => {
    expect(q('hydraulic hose assembly')).toEqual({ q: 'hydraulic hose assembly', nsn: '', fsc: '' });
    expect(q('gaskets RFQs')).toEqual({ q: 'gaskets', nsn: '', fsc: '' });
    expect(q('combat helmets on DIBBS')).toEqual({ q: 'combat helmets', nsn: '', fsc: '' });
  });

  it('DLA is the tab itself — accepted, and not shown as a narrower facet', () => {
    expect(q('DLA bearings')).toEqual({ q: 'bearings', nsn: '', fsc: '' });
    expect(A.summary(ask('DLA bearings'), { shown: 4, more: false })).toBe('Mindy searched: bearings — 4 RFQs');
  });

  it('codes are never guessed (FSC vs NSN vs NAICS) — the tab’s own boxes take them', () => {
    for (const text of ['8415', 'FSC 8415', '5305', 'NSN 5305-01-234-5678']) {
      expect(q(text), text).toBeNull();
      expect(A.whyNot(ask(text)), text).toMatch(/NSN \/ FSC boxes/);
    }
  });

  it('what the tab cannot express returns null with a plain reason — never a guess', () => {
    const cases: Array<[string, RegExp]> = [
      ['Navy bearings', /DLA buys only/],
      ['bearings in Texas', /state/],
      ['small business bearings', /set-aside/],
      ['bearings -ball', /exclude/],
      ['bearings or valves', /one phrase at a time/],
      ['expiring bearing contracts', /not upcoming or expiring/],
      ['how do I bid on DIBBS', /question for Mindy/],
      ['DIBBS RFQs', /part or item/],
      ['', /to search DIBBS RFQs/],
    ];
    for (const [text, why] of cases) {
      expect(q(text), text).toBeNull();
      expect(A.whyNot(ask(text)), text).toMatch(why);
    }
  });
});

describe('dibbs adapter — summary', () => {
  it('says what Mindy searched and how many rows came back', () => {
    expect(A.summary(ask('hydraulic hose assembly'), { shown: 12, more: false }))
      .toBe('Mindy searched: hydraulic hose assembly — 12 RFQs');
    expect(A.summary(ask('gaskets'), { shown: 1, more: false })).toBe('Mindy searched: gaskets — 1 RFQ');
  });

  it('unknown count is "count unavailable", never 0', () => {
    const line = A.summary(ask('gaskets'), null);
    expect(line).toContain('count unavailable');
    expect(line).not.toMatch(/\b0\b/);
  });

  it('more rows than shown says so', () => {
    expect(A.summary(ask('gaskets'), { shown: 50, more: true })).toContain('50+ RFQs (showing the first 50)');
  });

  it('a fiscal year is never silently dropped', () => {
    expect(q('FY2027 gaskets')).toEqual({ q: 'gaskets', nsn: '', fsc: '' });
    expect(A.summary(ask('FY2027 gaskets'), { shown: 3, more: false })).toContain('FY2027 isn’t a filter on this tab');
  });
});
