import { describe, it, expect } from 'vitest';
import {
  savedSearchHasNarrowingFilter,
  validateSavedSearchFilters,
  canonicalizeSavedSearchFilters,
} from './validate-filters';

describe('saved-search filter validation', () => {
  it('rejects empty filters (would match entire corpus)', () => {
    const res = validateSavedSearchFilters({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/narrowing filter/i);
  });

  it('accepts NAICS + agency (typical Map save)', () => {
    const res = validateSavedSearchFilters({ naics: '541512', agency: 'DEFENSE', q: 'cloud' });
    expect(res.ok).toBe(true);
  });

  it('accepts forecast-only horizon', () => {
    expect(savedSearchHasNarrowingFilter({ horizons: { forecast: true } })).toBe(true);
  });

  it('accepts scope=profile', () => {
    expect(savedSearchHasNarrowingFilter({ scope: 'profile' })).toBe(true);
  });

  it('strips junk strategy keys', () => {
    const res = validateSavedSearchFilters({ naics: '541512', strategy: ['repeat_buyer', 'not_a_real_strand'] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.filters.strategy).toEqual(['repeat_buyer']);
    }
  });

  it('canonicalize drops empty and all-sentinel values', () => {
    expect(canonicalizeSavedSearchFilters({ naics: '541512', agency: '', status: 'all' })).toEqual({ naics: '541512' });
  });
});
