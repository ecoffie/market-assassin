import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { matchPursuits, pipelineAskAdapter as adapter, type PursuitLite } from './pipeline';

const ask = (q: string) => parseTabAsk(q, adapter.tabWords);
const query = (q: string) => adapter.toQuery(ask(q));

// Stored fields as /api/pipeline returns them (agency + set_aside are SAM's free text).
const PURSUITS: PursuitLite[] = [
  { id: 'p1', title: 'Navy zero trust cybersecurity services', agency: 'DEPT OF THE NAVY', naics_code: '541512', set_aside: 'Total Small Business Set-Aside (FAR 19.5)' },
  { id: 'p2', title: 'VA cloud migration', agency: 'VETERANS AFFAIRS, DEPARTMENT OF', naics_code: '541519', set_aside: 'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside' },
  { id: 'p3', title: 'Janitorial services, Fort Bragg', agency: 'ARMY', naics_code: '561720', set_aside: '8(a) Set-Aside (FAR 19.8)' },
  { id: 'p4', title: 'Cybersecurity assessment (no buyer recorded)' },
  { id: 'p5', title: 'Base construction', agency: 'Department of the Army', naics_code: '236220', set_aside: null },
];
const ids = (q: string) => matchPursuits(PURSUITS, query(q)!).map((p) => p.id);

describe('Pipeline adapter — question → stored-field match over the loaded pursuits', () => {
  it('every example is expressible on this tab', () => {
    for (const ex of adapter.examples) expect(query(ex), ex).not.toBeNull();
  });

  it('a buyer matches pursuits whose stored agency discovery resolves to it — never one with no agency', () => {
    expect(ids('Navy')).toEqual(['p1']);
    expect(ids('which of my pursuits are for the Navy?')).toEqual(['p1']);
    expect(ids('Army')).toEqual(['p3', 'p5']);
  });

  it('keywords match the title (word-prefix); alternatives OR together', () => {
    expect(ids('cybersecurity')).toEqual(['p1', 'p4']);
    expect(ids('cyber pursuits')).toEqual(['p1', 'p4']);
    expect(ids('janitorial, construction')).toEqual(['p3', 'p5']);
  });

  it('facets AND together; set-aside read from the stored text by discovery; NAICS prefix', () => {
    expect(ids('Navy cybersecurity')).toEqual(['p1']);
    expect(ids('SDVOSB pursuits for the VA')).toEqual(['p2']);
    expect(ids('small business')).toEqual(['p1']);
    expect(ids('8(a) Army')).toEqual(['p3']);
    expect(ids('NAICS 541512')).toEqual(['p1']);
    expect(ids('Navy cloud')).toEqual([]);
  });

  it('cannot be expressed → null with a plain reason (chat handoff), never a guess', () => {
    for (const q of ['how should I price a Navy bid', 'recompetes for the Army', 'janitorial in Florida', 'IT -staffing', 'PSC D310', 'FY2027', '']) {
      expect(query(q), q).toBeNull();
      expect(adapter.whyNot(ask(q)), q).not.toBe('');
    }
  });

  it('summary names what Mindy searched; an unknown count is never 0; a fiscal year is called out', () => {
    expect(adapter.summary(ask('Navy cybersecurity'), { shown: 1, more: false }))
      .toBe('Mindy searched your pursuits for: Navy · cybersecurity — 1 pursuit');
    const unknown = adapter.summary(ask('Navy'), null);
    expect(unknown).toContain('count unavailable');
    expect(unknown).not.toMatch(/\b0\b/);
    expect(adapter.summary(ask('Navy FY2027'), { shown: 1, more: false })).toContain('FY2027 isn’t stored on a pursuit');
  });
});
