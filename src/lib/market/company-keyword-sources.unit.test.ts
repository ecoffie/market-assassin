import { describe, it, expect } from 'vitest';
import {
  detectLocations,
  cleanInputText,
  distinctiveBrandTokens,
  containsBlockedToken,
  normalizeCalcTitle,
  mergeCalcTitles,
  extractOccupations,
  dedupeTitles,
  roundRobinBySegment,
  interleave,
} from './company-keyword-sources';

describe('detectLocations', () => {
  it('finds a city after a location cue', () => {
    expect(detectLocations('a staffing firm in Memphis').map((l) => l.place)).toEqual(['memphis']);
  });
  it('finds a lowercase city when a cue marks it as a place', () => {
    expect(detectLocations('janitorial company based in dallas').map((l) => l.place)).toEqual(['dallas']);
  });
  it('takes the state code after "City, ST"', () => {
    expect(detectLocations('Offices in Memphis, TN and beyond').map((l) => l.place)).toEqual(['memphis', 'tn']);
  });
  it('finds capitalized multi-word places and state names', () => {
    expect(detectLocations('We serve San Antonio and North Carolina').map((l) => l.place)).toEqual(['san antonio', 'north carolina']);
  });
  it('does not treat a capability word that is also a town as a place without a cue', () => {
    // "Commerce" and "Industry" are US towns; at sentence start with no cue they are words.
    expect(detectLocations('Commerce logistics and industrial cleaning').map((l) => l.place)).toEqual([]);
    expect(detectLocations('Industry leaders in light industrial staffing').map((l) => l.place)).toEqual([]);
  });
});

describe('cleanInputText', () => {
  it('removes the place with its cue and the brand phrase', () => {
    const text = 'Superb Staffing is a light industrial, clerical and warehouse staffing firm in Memphis';
    const out = cleanInputText(text, ['Superb Staffing'], detectLocations(text));
    expect(out.toLowerCase()).not.toContain('memphis');
    expect(out.toLowerCase()).not.toContain('superb');
    expect(out).toContain('warehouse staffing firm');
    expect(out).not.toMatch(/\bin\s*\.?$/);
  });
});

describe('distinctiveBrandTokens', () => {
  it('strips only brand-distinctive words, keeping capability words used elsewhere', () => {
    const cleaned = 'is a light industrial, clerical and warehouse staffing firm';
    expect([...distinctiveBrandTokens(['Superb Staffing'], cleaned, new Set())]).toEqual(['superb']);
  });
  it('keeps a brand word the market sources use even if the input only has it in the brand', () => {
    expect([...distinctiveBrandTokens(['Superb Staffing'], 'provides warehouse workers', new Set(['staffing']))]).toEqual(['superb']);
  });
  it('containsBlockedToken matches whole words only', () => {
    expect(containsBlockedToken('superb staffing', new Set(['superb']))).toBe(true);
    expect(containsBlockedToken('superbly staffed', new Set(['superb']))).toBe(false);
  });
});

describe('CALC titles', () => {
  it('normalizes level markers, asterisks, seniority and code suffixes', () => {
    expect(normalizeCalcTitle('General Clerk II**')).toBe('general clerk');
    expect(normalizeCalcTitle('Senior Warehouse Specialist 3')).toBe('warehouse specialist');
    expect(normalizeCalcTitle('Clerical/Word Processing - CW10')).toBe('clerical/word processing');
    expect(normalizeCalcTitle('**Clerical/Admin Support 1 (C1)')).toBe('clerical/admin support');
  });
  it('merges buckets into occupation counts', () => {
    const out = mergeCalcTitles([
      { key: 'General Clerk I', doc_count: 10 },
      { key: 'General Clerk II**', doc_count: 5 },
      { key: 'Warehouse Worker', doc_count: 3 },
    ]);
    expect(out).toEqual([{ title: 'general clerk', n: 15 }, { title: 'warehouse worker', n: 3 }]);
  });
});

describe('extractOccupations', () => {
  it('counts occupation phrases by distinct notice and requires recurrence', () => {
    const out = extractOccupations([
      { id: 'a', text: 'The contractor shall furnish licensed forklift operators and material handlers.' },
      { id: 'b', text: 'The material handler and forklift operator report to the warehouse. Contact the contract specialist.' },
      { id: 'c', text: 'One order picker on day shift.' },
    ]);
    const phrases = out.map((o) => o.phrase);
    expect(phrases).toContain('material handler');
    expect(phrases).toContain('forklift operator');
    expect(phrases).not.toContain('contract specialist'); // the buyer's role, never the work
    expect(phrases).not.toContain('order picker'); // one notice only
    expect(out.find((o) => o.phrase === 'material handler')?.notices).toBe(2);
  });
});

describe('merging helpers', () => {
  it('dedupeTitles collapses spelling variants of one title', () => {
    expect(dedupeTitles(['administrative/clerical', 'administrative clerical', 'admin/clerical', 'general clerk'])).toEqual([
      'administrative/clerical',
      'general clerk',
    ]);
  });
  it('roundRobinBySegment alternates segments', () => {
    const seg = new Map([['a1', 0], ['a2', 0], ['a3', 0], ['b1', 1], ['b2', 1]]);
    expect(roundRobinBySegment(['a1', 'a2', 'a3', 'b1', 'b2'], seg)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3']);
  });
  it('interleave alternates and dedupes', () => {
    expect(interleave(['x', 'y', 'z'], ['p', 'x'], 4)).toEqual(['x', 'p', 'y', 'z']);
  });
});
