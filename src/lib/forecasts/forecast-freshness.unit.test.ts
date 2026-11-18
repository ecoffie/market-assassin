/** Forecast answers carry per-row dates and per-source staleness (Data Core 2026-11-17). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forecastSourceFreshness, FORECAST_STALE_DAYS } from './query';

const NOW = Date.parse('2026-11-17T12:00:00Z');

describe('forecastSourceFreshness', () => {
  it('flags an agency whose newest row is older than the stale window; stalest first', () => {
    const s = forecastSourceFreshness([
      { agency: 'DOE', as_of: '2026-11-17T08:00:00Z' },
      { agency: 'NAVY', as_of: '2026-08-01T00:00:00Z' },
      { agency: 'NAVY', as_of: '2026-07-01T00:00:00Z' },
    ], NOW);
    expect(s[0]).toMatchObject({ agency: 'NAVY', as_of: '2026-08-01T00:00:00Z', stale: true });
    expect(s[0].age_days).toBeGreaterThan(FORECAST_STALE_DAYS);
    expect(s[1]).toMatchObject({ agency: 'DOE', stale: false, age_days: 0 });
  });

  it('unknown age is reported as stale, never as current', () => {
    expect(forecastSourceFreshness([{ agency: 'X', as_of: null }], NOW)[0]).toMatchObject({ stale: true, age_days: null });
  });
});

const fallback = vi.fn();
vi.mock('./query', async (orig) => ({ ...(await orig<typeof import('./query')>()), queryForecastsWithFallback: (...a: unknown[]) => fallback(...a) }));

describe('get_agency_forecasts _meta', () => {
  beforeEach(() => fallback.mockReset());
  it('reports stale sources and a last-good serve', async () => {
    const { agencyForecasts } = await import('@/mcp/tools/forecasts');
    fallback.mockResolvedValue({
      forecasts: [{ id: '1', title: 'T', agency: 'NAVY', as_of: '2026-08-01T00:00:00Z', source_url: 'https://x.gov' }],
      total: 1, degraded: true, served_from: 'last_good', snapshot_at: '2026-11-16T00:00:00Z',
      sources: [{ agency: 'NAVY', as_of: '2026-08-01T00:00:00Z', age_days: 108, stale: true }],
    });
    const r = await agencyForecasts({ agency: 'Navy' });
    expect(r._meta).toMatchObject({ served_from: 'last_good', snapshot_at: '2026-11-16T00:00:00Z', stale_sources: ['NAVY'], degraded: true });
    expect(r._meta.billing_outcome).toBe('nonbillable_system_failure');
    expect(r.forecasts[0]).toMatchObject({ as_of: '2026-08-01T00:00:00Z', source_url: 'https://x.gov' });
  });
});
