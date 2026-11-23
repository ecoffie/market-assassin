/**
 * get_agency_forecasts states plainly when Mindy holds no forecast data for the requested agency
 * (Ask Mindy Backend Spec, Nov 21 2026: "add DLA and NGA or state plainly that coverage doesn't exist").
 *
 * Reproduced 2026-11-21: agency "DLA" or "FAA" resolves to a known identity with no feed, so the query
 * filtered `source_agency.is.null` (matches nothing) and the tool answered "No forecasts matched. Broaden
 * the NAICS prefix" — a zero for an agency we do not cover. Same rule as find_opportunities' Coming soon.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const q = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/forecasts/query', () => ({
  queryForecastsWithFallback: vi.fn(async (input: Record<string, unknown>) => {
    q.calls.push(input);
    return { forecasts: [], total: 0, degraded: false, sources: [], served_from: 'live', snapshot_at: null };
  }),
}));

const { agencyForecasts, forecastAgencyCoverage } = await import('./forecasts');
const { annotateResultContract } = await import('@/lib/mcp/result-contract');
const { toolParameters } = await import('@/lib/mcp/tool-registry');

beforeEach(() => { q.calls.length = 0; });

describe('an agency with no forecast feed is unavailable, never zero', () => {
  it.each(['DLA', 'Defense Logistics Agency', 'FAA'])('%s → unavailable, the query is not run', async (agency) => {
    const r = await agencyForecasts({ agency });
    expect(q.calls).toHaveLength(0);
    expect(r._meta).toMatchObject({ grounded: false, total: null, coverage: 'unestablished', result_state: 'unavailable' });
    expect(r._meta.coverage_gaps![0]).toMatchObject({ reason: 'publisher_without_forecasts' });
    annotateResultContract(r as never, { agency }, toolParameters('get_agency_forecasts'));
    expect((r._meta as { result_state: string }).result_state).toBe('unavailable');
  });

  it('DLA names the parent and the dataset that does cover it', async () => {
    const r = await agencyForecasts({ agency: 'DLA' });
    expect(r._meta.coverage_gaps).toEqual([expect.objectContaining({ label: 'Defense Logistics Agency', parentWithData: 'DOD', note: expect.stringMatching(/DIBBS/) })]);
  });

  it('an agency that resolves to no forecast publisher at all (NGA) is unavailable too', async () => {
    const r = await agencyForecasts({ agency: 'NGA' });
    expect(q.calls).toHaveLength(0);
    expect(r._meta.coverage_gaps).toEqual([{ requested: 'NGA', reason: 'unresolved_publisher' }]);
  });
});

describe('covered agencies still run', () => {
  it('Navy → coverage ok, the query runs, a real zero stays a zero', async () => {
    const r = await agencyForecasts({ agency: 'Navy' });
    expect(q.calls).toHaveLength(1);
    expect(r._meta).toMatchObject({ coverage: 'ok', total: 0 });
    expect(r._meta.coverage_gaps).toBeUndefined();
  });

  it('no agency asked → ok', async () => {
    await agencyForecasts({ naics: '561720' });
    expect(q.calls).toHaveLength(1);
    expect(forecastAgencyCoverage(undefined)).toEqual({ coverage: 'ok', gaps: [] });
  });

  it('a covered + uncovered list → partial: runs, and names the gap', async () => {
    const r = await agencyForecasts({ agency: 'NAVY,DLA' });
    expect(q.calls).toHaveLength(1);
    expect(r._meta.coverage).toBe('partial');
    expect(r._meta.coverage_gaps!.map((g) => g.label ?? g.requested)).toEqual(['Defense Logistics Agency']);
  });
});
