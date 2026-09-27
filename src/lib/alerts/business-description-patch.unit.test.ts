import { describe, expect, it } from 'vitest';
import {
  cleanBusinessDescription,
  mayDeriveBusinessDescription,
  resolveBusinessDescriptionWrite,
} from './business-description-patch';

const USER_TEXT = 'We install and service commercial HVAC systems.';

describe('resolveBusinessDescriptionWrite', () => {
  it('writes an explicit non-blank description (trimmed)', () => {
    expect(resolveBusinessDescriptionWrite({
      businessDescription: '  mine  ', keywords: undefined, storedDescription: USER_TEXT, previousKeywords: [],
    })).toBe('mine');
  });

  it('omitted description + omitted keywords → untouched', () => {
    expect(resolveBusinessDescriptionWrite({
      businessDescription: undefined, keywords: undefined, storedDescription: USER_TEXT, previousKeywords: [],
    })).toBeNull();
  });

  it('blank/null description is not a clear', () => {
    for (const blank of [null, '', '   ']) {
      expect(resolveBusinessDescriptionWrite({
        businessDescription: blank, keywords: undefined, storedDescription: USER_TEXT, previousKeywords: [],
      })).toBeNull();
    }
  });

  it('keywords: [] never clears', () => {
    expect(resolveBusinessDescriptionWrite({
      businessDescription: undefined, keywords: [], storedDescription: USER_TEXT, previousKeywords: ['hvac'],
    })).toBeNull();
  });

  it('derived never overwrites user-written text', () => {
    expect(resolveBusinessDescriptionWrite({
      businessDescription: undefined, keywords: ['hvac'], storedDescription: USER_TEXT, previousKeywords: ['hvac'],
    })).toBeNull();
  });

  it('derived fills an empty description', () => {
    expect(resolveBusinessDescriptionWrite({
      businessDescription: undefined, keywords: ['hvac'], storedDescription: null, previousKeywords: [],
    })).toBe('Federal contractor: hvac.');
  });

  it('derived refreshes a description that was itself derived from the previous keywords', () => {
    expect(resolveBusinessDescriptionWrite({
      businessDescription: undefined, keywords: ['hvac', 'chillers'],
      storedDescription: 'Federal contractor: hvac.', previousKeywords: ['hvac'],
    })).toBe('Federal contractor: hvac, chillers.');
  });

  it('no-op when the derived value already matches', () => {
    expect(resolveBusinessDescriptionWrite({
      businessDescription: undefined, keywords: ['hvac'],
      storedDescription: 'Federal contractor: hvac.', previousKeywords: ['hvac'],
    })).toBeNull();
  });
});

describe('helpers', () => {
  it('cleanBusinessDescription', () => {
    expect(cleanBusinessDescription(' a ')).toBe('a');
    expect(cleanBusinessDescription('  ')).toBeNull();
    expect(cleanBusinessDescription(42)).toBeNull();
  });
  it('mayDeriveBusinessDescription only when no text and non-empty keywords', () => {
    expect(mayDeriveBusinessDescription({ businessDescription: undefined, keywords: ['x'] })).toBe(true);
    expect(mayDeriveBusinessDescription({ businessDescription: 'text', keywords: ['x'] })).toBe(false);
    expect(mayDeriveBusinessDescription({ businessDescription: undefined, keywords: [] })).toBe(false);
  });
});
