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

  it('rejects unknown strategy strands instead of stripping them', () => {
    const res = validateSavedSearchFilters({ naics: '541512', strategy: ['repeat_buyer', 'not_a_real_strand'] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Unsupported strategy values: not_a_real_strand/);
      expect(res.error).toMatch(/Do not drop unsupported strategy/);
    }
  });

  it('rejects unknown top-level filter keys (no silent broaden)', () => {
    const res = validateSavedSearchFilters({ naics: '541512', keyword: 'cyber', radiusMiles: 50 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Unsupported filter keys: keyword, radiusMiles/);
      expect(res.error).toMatch(/Do not drop unsupported filters/);
      expect(res.error).toMatch(/use q for keyword/);
    }
  });

  it('preserves accepted filters when validation succeeds', () => {
    const res = validateSavedSearchFilters({
      naics: '541512',
      agency: 'DEFENSE',
      state: 'FL',
      strategy: ['repeat_buyer'],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.filters).toEqual({
        naics: '541512',
        agency: 'DEFENSE',
        state: 'FL',
        strategy: ['repeat_buyer'],
      });
    }
  });

  it('canonicalize drops empty and all-sentinel values', () => {
    expect(canonicalizeSavedSearchFilters({ naics: '541512', agency: '', status: 'all' })).toEqual({ naics: '541512' });
  });
});

/**
 * REGRESSION 2026-10-01 → 10-04: schedule_market_search saved
 * `{ naics: '541510', sapBuyer: true }`. The key was allowed, so it passed; the cron's
 * parseMapFilters then threw `(get(...) || "").toLowerCase is not a function` and the
 * search failed every day as unexpected_schedule_error while the agent was told "success".
 * The contract: anything the validator ACCEPTS must evaluate in the alert cron.
 */
describe('saved-search filter value shapes (write-time ⇔ cron read-time contract)', () => {
  it('rejects the exact production row: sapBuyer boolean', () => {
    const res = validateSavedSearchFilters({ naics: '541510', sapBuyer: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Invalid sapBuyer value .*Allowed: "most", "somewhat", "vehicle"/);
  });

  it('accepts real sapBuyer tiers and an empty value', () => {
    for (const v of ['most', 'somewhat', 'vehicle', '']) {
      expect(validateSavedSearchFilters({ naics: '541510', sapBuyer: v }).ok).toBe(true);
    }
  });

  it.each([
    ['q', ['cyber']], ['country', true], ['scope', 1], ['status', 'archived'], ['status', false],
    ['naics', 541512], ['naics', [541512]], ['state', { FL: true }], ['fullOpen', 1], ['postedDays', [30]],
  ])('rejects %s = %j', (key, value) => {
    expect(validateSavedSearchFilters({ naics: '541512', [key]: value }).ok).toBe(false);
  });

  // Shapes measured in production saved_searches on 2026-10-05 (240 rows) — must keep saving.
  const ACCEPTED_SHAPES: Record<string, unknown>[] = [
    { naics: '541512', agency: 'DEFENSE', q: 'cloud' },
    { q: 'hvac', naics: ['541512', '541519'], state: ['FL', 'GA'], setAside: ['SBA'] },
    { naics: '236220', fullOpen: true, strategy: ['repeat_buyer', 'sb_friendly'] },
    { state: ['RI', 'MA'], strategy: [] , horizons: { open: true, forecast: true } },
    { scope: 'profile', hasDocs: 'true', closingDays: 14, postedDays: '30' },
    { naics: '541510', sapBuyer: 'most', status: 'active', country: 'usa' },
  ];

  it.each(ACCEPTED_SHAPES)('every accepted shape evaluates in the alert cron parser: %j', async (raw) => {
    const res = validateSavedSearchFilters(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { parseMapFilters, applyMapFilters } = await import('@/lib/opportunities/map-filters');
    // Chainable stub query: applyMapFilters only builds the request, so any call returns itself.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stub: any = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : () => stub) });
    const saved = res.filters as Record<string, string>;
    // Same getter the cron uses (saved-search-alerts/route.ts evaluateSavedSearch).
    const f = parseMapFilters((k) => saved[k] ?? null, { profileNaics: ['541512'], profileStates: [] });
    expect(() => applyMapFilters(stub, f)).not.toThrow();
  });
});
