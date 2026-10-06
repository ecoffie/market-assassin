import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isPlaceholderNaicsSet, naicsSourceForUserWrite } from './naics-provenance';

const PLACEHOLDER = ['541512', '541611', '541330', '541990', '561210'];

describe('isPlaceholderNaicsSet', () => {
  it('matches the exact 5-code placeholder in any order, with duplicates', () => {
    expect(isPlaceholderNaicsSet(PLACEHOLDER)).toBe(true);
    expect(isPlaceholderNaicsSet([...PLACEHOLDER].reverse().concat('541512'))).toBe(true);
  });
  it('a subset or a superset is NOT the placeholder (it may be a real choice)', () => {
    expect(isPlaceholderNaicsSet(['541611'])).toBe(false);
    expect(isPlaceholderNaicsSet([...PLACEHOLDER, '238220'])).toBe(false);
    expect(isPlaceholderNaicsSet([])).toBe(false);
    expect(isPlaceholderNaicsSet(null)).toBe(false);
  });
});

describe('naicsSourceForUserWrite', () => {
  it('unchanged set -> leave provenance alone', () => {
    expect(naicsSourceForUserWrite(['238220'], ['238220'])).toBeUndefined();
    expect(naicsSourceForUserWrite(PLACEHOLDER, [...PLACEHOLDER].reverse())).toBeUndefined();
  });
  it('changed to the user’s own codes -> user_confirmed', () => {
    expect(naicsSourceForUserWrite(['484121'], PLACEHOLDER)).toBe('user_confirmed');
    expect(naicsSourceForUserWrite(['484121'], null)).toBe('user_confirmed');
  });
  it('changed to the exact placeholder -> system_default, never user_confirmed', () => {
    expect(naicsSourceForUserWrite(PLACEHOLDER, ['238220'])).toBe('system_default');
    expect(naicsSourceForUserWrite(PLACEHOLDER, null)).toBe('system_default');
  });
  it('cleared -> null (no claim)', () => {
    expect(naicsSourceForUserWrite([], ['238220'])).toBeNull();
  });
});

describe('legacy onboarding early exit', () => {
  it('does not treat placeholder-only codes as a finished profile', () => {
    const src = readFileSync('src/app/app/onboarding/page.tsx', 'utf8');
    expect(src).toMatch(/codes\.length > 0 && !isPlaceholderNaicsSet\(codes\)/);
  });
});
