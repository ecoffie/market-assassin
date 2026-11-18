import { describe, it, expect } from 'vitest';
import { contractorIndexable, CONTRACTOR_INDEX_MIN_OBLIGATED, CONTRACTOR_TABS_INDEXABLE } from './contractor-index-tier';

describe('contractor index tier', () => {
  it('indexes only contractors at or above the spend floor', () => {
    expect(contractorIndexable(CONTRACTOR_INDEX_MIN_OBLIGATED, 10)).toBe(true);
    expect(contractorIndexable(CONTRACTOR_INDEX_MIN_OBLIGATED - 1, 10)).toBe(false);
  });
  it('keeps the old thin gate underneath (single award never indexed)', () => {
    expect(contractorIndexable(5e9, 1)).toBe(false);
  });
  it('unknown spend is not indexable', () => {
    expect(contractorIndexable(null, null)).toBe(false);
  });
  it('tabs are never offered to Google', () => {
    expect(CONTRACTOR_TABS_INDEXABLE).toBe(false);
  });
});
