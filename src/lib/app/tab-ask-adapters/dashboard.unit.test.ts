/**
 * Ask Mindy → Dashboard (Today's Intel) adapter: plain English → the tab's own Search box text and
 * filter chip, or null (→ chat) when those two filters cannot express the question.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { dashboardAskAdapter as A, type DashboardAskParams } from './dashboard';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const q = (s: string): DashboardAskParams | null => A.toQuery(ask(s));

describe('dashboard adapter — toQuery', () => {
  it('every example is expressible in the tab’s filters', () => {
    expect(A.examples.length).toBeGreaterThanOrEqual(2);
    expect(A.examples.length).toBeLessThanOrEqual(3);
    for (const ex of A.examples) expect(q(ex), ex).not.toBeNull();
  });

  it('a keyword fills the Search box; the chip stays on All', () => {
    expect(q('cybersecurity')).toEqual({ search: 'cybersecurity', filter: 'all' });
    expect(q('help desk support')).toEqual({ search: 'help desk', filter: 'all' });
  });

  it('the chip words pick the tab’s own chip and never become a keyword', () => {
    expect(q('urgent')).toEqual({ search: '', filter: 'urgent' });
    expect(q('teaming')).toEqual({ search: '', filter: 'teaming' });
    expect(q('urgent cybersecurity opportunities')).toEqual({ search: 'cybersecurity', filter: 'urgent' });
    expect(q('teaming for cloud')).toEqual({ search: 'cloud', filter: 'teaming' });
  });

  it('the tab’s own nouns never become a keyword', () => {
    expect(q('cybersecurity briefing items')).toEqual({ search: 'cybersecurity', filter: 'all' });
    expect(q("today's urgent opportunities")).toEqual({ search: '', filter: 'urgent' });
  });

  it('what the tab cannot express returns null with a plain reason — never a guess', () => {
    const cases: Array<[string, RegExp]> = [
      ['Navy cybersecurity', /buyer/],
      ['janitorial in Florida', /state/],
      ['8(a) cybersecurity', /set-aside/],
      ['541512', /code/],
      ['cybersecurity -training', /exclude/],
      ['cloud, cyber', /one phrase/],
      ['FY2027 cybersecurity', /fiscal year/],
      ['upcoming cybersecurity', /upcoming/],
      ['recompetes for IT', /expiring/],
      ['urgent teaming', /one filter/],
      ['how should I price a bid', /question for Mindy/],
      ['', /./],
    ];
    for (const [question, why] of cases) {
      const a = ask(question);
      expect(A.toQuery(a), question).toBeNull();
      expect(A.whyNot(a), question).toMatch(why);
    }
  });
});

describe('dashboard adapter — summary', () => {
  it('names the chip and keyword and the count', () => {
    expect(A.summary(ask('urgent cybersecurity'), { shown: 3, more: false }))
      .toBe('Mindy searched today’s briefing: urgent · cybersecurity — 3 briefing items');
    expect(A.summary(ask('teaming'), { shown: 1, more: false }))
      .toBe('Mindy searched today’s briefing: teaming — 1 briefing item');
  });

  it('a real zero is 0; an unknown count is never shown as 0', () => {
    expect(A.summary(ask('cybersecurity'), { shown: 0, more: false })).toContain('— 0 briefing items');
    const unknown = A.summary(ask('cybersecurity'), null);
    expect(unknown).toContain('count unavailable');
    expect(unknown).not.toMatch(/\b0\b/);
  });
});
