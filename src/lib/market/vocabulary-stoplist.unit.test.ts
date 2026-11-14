import { describe, it, expect } from 'vitest';
import { isBoilerplateVocabTerm } from './vocabulary-stoplist';

describe('isBoilerplateVocabTerm', () => {
  it('flags award-funding boilerplate stored for 561320 / 493110', () => {
    for (const t of ['base obligated', 'obligated amount', 'amount', 'aggregate', 'period', 'option year', 'option period', 'funding']) {
      expect(isBoilerplateVocabTerm(t)).toBe(true);
    }
  });
  it('flags clause-crossing verb fragments', () => {
    expect(isBoilerplateVocabTerm('perform warehousing')).toBe(true);
    expect(isBoilerplateVocabTerm('services perform')).toBe(true);
  });
  it('keeps real work vocabulary', () => {
    for (const t of ['staffing services', 'warehousing', 'registered nurses', 'records storage', 'base operations', 'logistics support', 'perform']) {
      expect(isBoilerplateVocabTerm(t)).toBe(false);
    }
  });
});
