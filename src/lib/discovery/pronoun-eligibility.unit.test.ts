import { describe, it, expect } from 'vitest';
import { buildTextMatcher, matchesText, textPredicate, PRONOUNS } from './matcher';

/**
 * Live defect (reported by Agent 4, 2026-11-14, after #2047): in a typed sentence the pronoun "we" (in 2.9% of
 * notices) became a capability-list PARTNER word. "We provide security guards." then required "we" next to "guards",
 * returned Navy parts notices and 0 of 13 open guard notices (561612); "We clean commercial office buildings." returned
 * 0 of 42 open janitorial notices. Pronouns now count toward the query's shape but never admit and never pair.
 * Sentences are Agent 4's benchmark phrasings (docs/benchmarks/data-core-hidden-opportunity-v1/queries.json).
 */
const SENTENCES = [
  'We clean commercial office buildings.',
  'We are a commercial cleaning company. We provide janitorial and custodial services for office buildings: daily cleaning, restroom sanitation, trash removal, floor care, carpet cleaning and window washing.',
  'We provide nurses and medical staffing.',
  'We maintain HVAC systems.',
  'We provide security guards.',
  'We are a security services company. We provide armed and unarmed security guards and officers for facility access control, patrols, posts and visitor screening.',
  'We erect steel buildings and install metal roofing.',
  'We supply industrial and defense replacement parts.',
  'I fix air conditioners for government buildings',
];

describe('a pronoun is never an eligibility term', () => {
  it.each(SENTENCES)('no pronoun admits or pairs in: %s', (q) => {
    for (const a of buildTextMatcher(q).alternatives) {
      for (const c of a.eligible) expect(PRONOUNS.has(c.label)).toBe(false);
      for (const l of a.partnerRequired || []) expect(PRONOUNS.has(l)).toBe(false);
    }
  });

  it('"We provide security guards." admits real guard notices and not "we" + "guard" parts notices on "we"', () => {
    const m = buildTextMatcher('We provide security guards.');
    expect(m.alternatives[0].eligible.map((c) => c.label)).toEqual(['guards']);
    expect(matchesText(m, ['Unarmed Security Guard Services, Federal Building'])).toBe(true);
    // Previously required "we" + "guard": a notice with "we" and no guard word must not match on the pronoun.
    expect(matchesText(m, ['53--HELICAL SPRING', 'We will award to the lowest price technically acceptable offer'])).toBe(false);
  });

  it('"We clean commercial office buildings." admits on "clean", never needs "we"', () => {
    const m = buildTextMatcher('We clean commercial office buildings.');
    expect(m.alternatives[0].eligible.map((c) => c.label)).toEqual(['clean']);
    expect(matchesText(m, ['Custodial and cleaning services, Building 12'])).toBe(true);
  });

  it('when only a pronoun would admit, the other words decide (fail narrow), never the pronoun', () => {
    const a = buildTextMatcher('We supply industrial and defense replacement parts.').alternatives[0];
    expect(a.eligible.map((c) => c.label)).not.toContain('we');
    expect(a.eligibility).toBe('all');
  });

  it('the SQL predicate carries no pronoun clause', () => {
    for (const q of SENTENCES) {
      const p = textPredicate(buildTextMatcher(q), ['title']) || '';
      expect(p).not.toMatch(/\\\\m(we|i|our|us|you)(s|\(s\))?[?]?\\\\M/);
    }
  });
});

describe('unchanged', () => {
  it.each(['janitorial services', 'security guard services', 'hvac maintenance', 'medical staffing', 'janitorial custodial grounds turf waste removal'])(
    'a query with no pronoun keeps its shape: %s', (q) => {
      const a = buildTextMatcher(q).alternatives[0];
      expect(a.eligible.length).toBeGreaterThan(0);
      for (const c of a.eligible) expect(PRONOUNS.has(c.label)).toBe(false);
    });
  it('a query made only of pronouns keeps its own words (never empty)', () => {
    expect(buildTextMatcher('we').alternatives[0].eligible.map((c) => c.label)).toEqual(['we']);
  });
});
