import { describe, it, expect } from 'vitest';
import { buildTextMatcher, matchesText, framedVerbs, listItems } from './matcher';

/**
 * Three retrieval causes found by Agent 4's v4 SAM.gov benchmark (14 businesses, blind labels) and measured with
 * tasks/search-stabilization-2026-11-14/harness/eval.mts on the open corpus (Agent 3, 2026-11-14). One describe per
 * cause; each states the production defect it closes and the boundary it must not cross. Record texts are real
 * open-notice titles.
 */
const m = (q: string) => buildTextMatcher(q);
const shape = (q: string) =>
  m(q).alternatives.map((a) => `${a.eligibility}(${a.eligible.map((c) => c.label).join('·')})`).join(' | ');

describe('cause 1: a commerce verb in subject position is framing, not the product', () => {
  it('"We supply industrial valves." no longer requires a valve notice to say "supply"', () => {
    expect(shape('We supply industrial valves.')).toBe('all(valves)');
    expect(matchesText(m('We supply industrial valves.'), ['48--VALVE,GATE'])).toBe(true);
    expect(matchesText(m('We supply industrial valves.'), ['VALVE, SOLENOID'])).toBe(true);
  });
  it('is framing ONLY after a subject: "office supply" and "power supply" keep the word', () => {
    expect([...framedVerbs('We supply industrial valves.')]).toEqual(['supply']);
    expect([...framedVerbs('we source and deliver spare parts')].sort()).toEqual(['deliver', 'source']);
    expect(framedVerbs('office supply').size).toBe(0);
    expect(framedVerbs('power supply units').size).toBe(0);
    expect(shape('power supply')).toBe('all(power·supply)');
    expect(matchesText(m('power supply'), ['61--POWER SUPPLY'])).toBe(true);
    expect(matchesText(m('power supply'), ['48--VALVE,GATE'])).toBe(false);
  });
  it('a sentence that is only a frame keeps its own words (never empties)', () => {
    expect(m('we supply').alternatives.length).toBe(1);
    expect(m('we supply').alternatives[0].eligible.length).toBeGreaterThan(0);
  });
});

describe('cause 2: market-segment adjectives and the company role describe the seller, not the item', () => {
  it('applies only to a short single sentence: in a paragraph they still pair (Agent 4 v5: ≈70 relevant lost otherwise)', () => {
    const p = 'We are a distributor of electrical and electronic components. We sell connectors and relays by NSN.';
    expect(m(p).alternatives.some((a) => a.eligible.some((c) => c.label === 'distributor'))).toBe(true);
  });
  it('"industrial" / "defense" are not required; the product words still are', () => {
    expect(shape('We supply industrial and defense replacement parts.')).toBe('all(replacement·parts)');
    expect(shape('We are a valve supplier.')).toBe('all(valve)');
  });
  it('they still count toward shape: "We clean commercial office buildings." stays a list admitting on clean', () => {
    // Reclassifying the words shrank this to ALL(clean · buildings) and lost 9 of 15 relevant janitorial notices.
    expect(shape('We clean commercial office buildings.')).toBe('any(clean)');
  });
  it('a query that is only a segment word still means it', () => {
    expect(shape('military')).toBe('all(military)');
  });
});

describe('cause 3: lists are items, and example words are not search words', () => {
  it('"fasteners like bolts, screws and nuts": "like" is dropped and each item admits alone', () => {
    expect(listItems('We supply fasteners like bolts, screws and nuts.')).toEqual(['We supply fasteners', 'bolts', 'screws', 'nuts.']);
    expect(shape('We supply fasteners like bolts, screws and nuts.')).toBe('all(fasteners) | all(bolts) | all(screws) | all(nuts)');
    const q = m('We supply fasteners like bolts, screws and nuts.');
    expect(matchesText(q, ['53--SCREW,CAP,SOCKET HE'])).toBe(true);
    expect(matchesText(q, ['53--NUT,SELF-LOCKING,HEXAG'])).toBe(true);
  });
  it('a shared head noun is distributed; a bare modifier never becomes a concept', () => {
    // Agent 4 v5 blind sample: bare "medical" added 528 rows, 0 of 30 relevant.
    // ...and each shared item is an adjacent PHRASE (v6: two words anywhere scored 3/30 relevant).
    expect(shape('We supply medical, dental and laboratory supplies.')).toBe('all(medical supplies) | all(dental supplies) | all(laboratory supplies)');
    const q = m('We supply medical, dental and laboratory supplies.');
    expect(matchesText(q, ['Medical supplies for the VA clinic'])).toBe(true);
    expect(matchesText(q, ['Sleep lab computer. The vendor shall deliver all supplies. Medical center, building 4'])).toBe(false);
    expect(matchesText(m('We supply medical, dental and laboratory supplies.'), ['Z1DZ--Replace Dental Vacuum Piping'])).toBe(false);
  });
  it('is untouched without a list: "repair and maintenance", "salt and pepper"', () => {
    expect(listItems('repair and maintenance')).toEqual(['repair and maintenance']);
    expect(listItems('salt and pepper')).toEqual(['salt and pepper']);
  });
  it('multi-sentence paragraphs keep the comma split (trailing clauses must not become one-word items)', () => {
    const p = 'We are a valve supplier. We provide gate, globe and check valves for industrial, marine and military systems.';
    expect(listItems(p)).toEqual(['We are a valve supplier. We provide gate', 'globe and check valves for industrial', 'marine and military systems.']);
  });
});
