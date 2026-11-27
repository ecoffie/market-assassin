/**
 * Ask Mindy → Grants adapter: plain English → the params the tab already sends to /api/grants
 * (keyword · agency · category · status), or null (→ chat) when the tab's filters cannot express it.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { grantsAskAdapter as A, type GrantsAskParams } from './grants';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const q = (s: string): GrantsAskParams | null => A.toQuery(ask(s));

describe('grants adapter — toQuery', () => {
  it('every example is expressible in the tab’s filters', () => {
    for (const ex of A.examples) expect(q(ex), ex).not.toBeNull();
  });

  it('a topic → the tab’s keyword, Open Now by default, category never guessed', () => {
    expect(q('cybersecurity research')).toEqual({ keyword: 'cybersecurity research', agency: '', category: '', status: 'posted' });
    expect(q('rural broadband grants')).toEqual({ keyword: 'rural broadband', agency: '', category: '', status: 'posted' });
  });

  it('a department → the tab’s own Agency dropdown code', () => {
    expect(q('HHS health grants')).toEqual({ keyword: 'health', agency: 'HHS', category: '', status: 'posted' });
    expect(q('grants from the Department of Energy')?.agency).toBe('DOE');
    expect(q('Department of Education literacy grants')).toEqual({ keyword: 'literacy', agency: 'ED', category: '', status: 'posted' });
    expect(q('department of commerce grants')?.agency).toBe('DOC');
    expect(q('NASA STEM education')).toEqual({ keyword: 'stem education', agency: 'NASA', category: '', status: 'posted' });
  });

  it('status words are the tab’s own dropdown, never a keyword', () => {
    expect(q('upcoming DOE energy grants')).toEqual({ keyword: 'energy', agency: 'DOE', category: '', status: 'forecasted' });
    expect(q('forecasted NSF grants')).toEqual({ keyword: '', agency: 'NSF', category: '', status: 'forecasted' });
    expect(q('closed DOD grants')).toEqual({ keyword: '', agency: 'DOD', category: '', status: 'closed' });
    expect(q('open now cybersecurity grants')).toEqual({ keyword: 'cybersecurity', agency: '', category: '', status: 'posted' });
    expect(q('open grants for cancer research')).toEqual({ keyword: 'cancer research', agency: '', category: '', status: 'posted' });
  });

  it('what the tab cannot express returns null with a plain reason — never a guess', () => {
    const cases: Array<[string, RegExp]> = [
      ['NIH grants', /isn’t one of this tab’s agency filters/],    // sub-agency: never widened to HHS
      ['army research', /isn’t one of this tab’s agency filters/], // never widened to DOD
      ['HHS or DOD health grants', /one agency at a time|one phrase/],
      ['education grants in Texas', /state/],
      ['grants for small business', /set-aside/],
      ['541715 research grants', /NAICS or PSC/],
      ['cyber -training', /exclude/],
      ['cloud, cyber', /one phrase at a time/],
      ['janitorial recompetes', /expiring contracts/],
      ['forecasted or closed energy grants', /one status at a time/],
      ['how do I win a grant', /question for Mindy/],
      ['FY2027', /fiscal year alone/],
      ['', /topic or a funding agency/],
    ];
    for (const [text, why] of cases) {
      expect(q(text), text).toBeNull();
      expect(A.whyNot(ask(text)), text).toMatch(why);
    }
  });
});

describe('grants adapter — summary', () => {
  it('says what Mindy searched (status included) and how many rows came back', () => {
    expect(A.summary(ask('HHS health grants'), { shown: 14, more: false }))
      .toBe('Mindy searched: HHS · health · open now — 14 grants');
    expect(A.summary(ask('upcoming DOE energy grants'), { shown: 1, more: false }))
      .toBe('Mindy searched: DOE · energy · forecasted — 1 grant');
  });

  it('unknown count is "count unavailable", never 0', () => {
    const line = A.summary(ask('cybersecurity research'), null);
    expect(line).toContain('count unavailable');
    expect(line).not.toMatch(/\b0\b/);
  });

  it('more rows than shown says so', () => {
    expect(A.summary(ask('cybersecurity research'), { shown: 25, more: true })).toContain('25+ grants (showing the first 25)');
  });

  it('a fiscal year is never silently dropped', () => {
    expect(q('FY2027 HHS grants')).toEqual({ keyword: '', agency: 'HHS', category: '', status: 'posted' });
    expect(A.summary(ask('FY2027 HHS grants'), { shown: 3, more: false })).toContain('FY2027 isn’t a filter on this tab');
  });
});
