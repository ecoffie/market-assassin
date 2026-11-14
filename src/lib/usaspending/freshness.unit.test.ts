/**
 * R10: the DoD publication-lag disclosure is computed from the injected current date.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { assessPublicationLag, fetchUsaSpendingLastUpdated, isDodAgency, DOD_PUBLICATION_LAG_DAYS } from './freshness';

const NOW = new Date('2026-11-13T15:00:00Z');
afterEach(() => vi.unstubAllGlobals());

describe('assessPublicationLag', () => {
  it('a window inside the last ~90 days applies, with a cutoff derived from today', () => {
    const a = assessPublicationLag({ dateFrom: '2026-10-01', dateTo: '2026-10-31', agency: 'Navy', now: NOW, asOf: '2026-11-13' });
    expect(a.applies).toBe(true);
    expect(a.lag_days).toBe(DOD_PUBLICATION_LAG_DAYS);
    expect(a.dod_complete_through).toBe('2026-08-15');
    expect(a.note).toContain('2026-08-15');
    expect(a.note).toContain('not yet published');
    expect(a.note).toContain('last loaded 2026-11-13');
  });

  it('moves with the clock (no hardcoded date)', () => {
    const later = assessPublicationLag({ dateFrom: '2026-10-01', dateTo: '2026-10-31', now: new Date('2027-06-01T15:00:00Z') });
    expect(later.applies).toBe(false);
    expect(later.dod_complete_through).toBe('2027-03-03');
  });

  it('old window, civilian agency, or no window: no note', () => {
    expect(assessPublicationLag({ dateFrom: '2019-01-01', dateTo: '2024-12-31', now: NOW }).applies).toBe(false);
    expect(assessPublicationLag({ dateFrom: '2026-10-01', agency: 'Department of Veterans Affairs', now: NOW }).applies).toBe(false);
    expect(assessPublicationLag({ now: NOW }).applies).toBe(false);
  });

  it('unspecified agency still applies (results include DoD); open-ended date_from reaches today', () => {
    const a = assessPublicationLag({ dateFrom: '2019-01-01', now: NOW });
    expect(a.applies).toBe(true);
    expect(a.note).toContain('DoD');
  });

  it('isDodAgency', () => {
    expect(isDodAgency('Department of the Navy')).toBe(true);
    expect(isDodAgency('USACE')).toBe(true);
    expect(isDodAgency('Department of Defense')).toBe(true);
    expect(isDodAgency('General Services Administration')).toBe(false);
  });
});

describe('fetchUsaSpendingLastUpdated', () => {
  it('parses MM/DD/YYYY into YYYY-MM-DD', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ last_updated: '11/13/2026' }) })));
    expect(await fetchUsaSpendingLastUpdated()).toBe('2026-11-13');
  });
  it('null on error (never a fabricated date)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await fetchUsaSpendingLastUpdated()).toBeNull();
  });
});
