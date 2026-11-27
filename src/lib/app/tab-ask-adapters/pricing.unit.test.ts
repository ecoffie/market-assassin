/**
 * Ask Mindy → Pricing Intel adapter. The tab's API (/api/app/pricing-intel) takes ONE `naics` code or
 * a comma-separated labor-category `keyword`. Everything else must hand off to chat, never guess.
 */
import { describe, expect, it } from 'vitest';
import { parseTabAsk } from '../tab-ask';
import { pricingAskAdapter as A, type PricingAskParams } from './pricing';

const ask = (q: string) => parseTabAsk(q, A.tabWords);
const query = (q: string) => A.toQuery(ask(q));

describe('pricingAskAdapter', () => {
  it('every example maps onto the tab\'s filters', () => {
    expect(A.examples.length).toBeGreaterThanOrEqual(2);
    for (const e of A.examples) expect(A.toQuery(ask(e)), e).not.toBeNull();
  });

  const cases: Array<[string, PricingAskParams]> = [
    ['labor rates for software engineer', { mode: 'role', value: 'software engineer' }],
    ['software engineer rates', { mode: 'role', value: 'software engineer' }],
    ['Software Engineer, Project Manager', { mode: 'role', value: 'software engineer, project manager' }],
    ['rates for NAICS 541512', { mode: 'naics', value: '541512' }],
    ['541512', { mode: 'naics', value: '541512' }],
  ];
  for (const [q, want] of cases) {
    it(`"${q}" → the tab's own params`, () => expect(query(q)).toEqual(want));
  }

  it('what the tab cannot express hands off to chat with a plain reason', () => {
    const nulls: Array<[string, RegExp]> = [
      ['what should I charge for a help desk technician', /question for Mindy/],
      ['network engineer rates in Virginia', /by state/],
      ['Navy software engineer rates', /by agency/],
      ['8(a) project manager rates', /set-aside/],
      ['rates for 541512 and 541611', /one NAICS code at a time/],
      ['541512 software engineer', /not both at once/],
      ['FY2026', /a fiscal year alone/],
      ['', /NAICS code or the roles/],
    ];
    for (const [q, why] of nulls) {
      expect(query(q), q).toBeNull();
      expect(A.whyNot(ask(q)), q).toMatch(why);
    }
  });

  it('summary names what was searched and never turns an unknown count into 0', () => {
    expect(A.summary(ask('labor rates for software engineer'), { shown: 25, more: false }))
      .toBe('Mindy searched: roles “software engineer” — 25 labor categories');
    expect(A.summary(ask('rates for NAICS 541512'), { shown: 1, more: false }))
      .toBe('Mindy searched: NAICS 541512 — 1 labor category');
    const unknown = A.summary(ask('541512'), null);
    expect(unknown).toBe('Mindy searched: NAICS 541512 — labor categories count unavailable');
    expect(unknown).not.toMatch(/\b0\b/);
  });

  it('a fiscal year is not a filter here: the search runs and the summary says so', () => {
    const a = ask('project manager rates FY2027');
    expect(A.toQuery(a)).toEqual({ mode: 'role', value: 'project manager' });
    expect(A.summary(a, { shown: 3, more: false })).toContain('FY2027 isn’t a filter on this tab');
  });
});
