/**
 * Ask Mindy → Knowledge Base adapter. The tab's API (/api/app/knowledge-base) takes ONE search phrase
 * (`q`, matched on titles + summaries). Everything else must hand off to chat, never guess.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { knowledgeBaseAskAdapter as A, type KnowledgeBaseAskParams } from './knowledge-base';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const query = (q: string) => A.toQuery(ask(q));

describe('knowledgeBaseAskAdapter', () => {
  it('every example maps onto the tab\'s search', () => {
    expect(A.examples.length).toBeGreaterThanOrEqual(2);
    for (const e of A.examples) expect(A.toQuery(ask(e)), e).not.toBeNull();
  });

  const cases: Array<[string, KnowledgeBaseAskParams]> = [
    ['capability statement', { q: 'capability statement' }],
    ['past performance documents', { q: 'past performance' }],
    ['cybersecurity proposals', { q: 'cybersecurity proposals' }],
    ['teaming agreement docs in the knowledge base', { q: 'teaming agreement' }],
  ];
  for (const [q, want] of cases) {
    it(`"${q}" → the tab's own params`, () => expect(query(q)).toEqual(want));
  }

  it('what the tab cannot express hands off to chat with a plain reason', () => {
    const nulls: Array<[string, RegExp]> = [
      ['Navy cybersecurity proposals', /buyer/],
      ['proposals in Virginia', /state/],
      ['8(a) proposals', /set-aside/],
      ['NAICS 541512 proposals', /NAICS or PSC/],
      ['FY2027 proposals', /fiscal year/],
      ['cloud, cyber', /one phrase at a time/],
      ['how do I write a capability statement', /question for Mindy/],
      ['', /Type a topic/],
      ['documents', /Type a topic/],
    ];
    for (const [q, why] of nulls) {
      expect(query(q), q).toBeNull();
      expect(A.whyNot(ask(q)), q).toMatch(why);
    }
  });

  it('summary names what was searched and never turns an unknown count into 0', () => {
    expect(A.summary(ask('capability statement'), { shown: 3, more: false }))
      .toBe('Mindy searched: “capability statement” in titles and summaries — 3 documents');
    expect(A.summary(ask('past performance'), { shown: 30, more: true }))
      .toBe('Mindy searched: “past performance” in titles and summaries — 30+ documents (showing the first 30)');
    const unknown = A.summary(ask('capability statement'), null);
    expect(unknown).toContain('count unavailable');
    expect(unknown).not.toMatch(/\b0\b/);
  });
});
