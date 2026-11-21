/**
 * The collector's stored row is what get_agency_forecasts and the Ask Mindy
 * coming-soon clock return. as_of is last_synced_at. updated_at is labeled
 * row_updated_at and is never presented as the sync time.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMoneyRange, parseNaics, parseSetAside } from './usace-district-parse';
import { doeForecastToDbRow, parseDoeCsv } from './doe-forecast';
import { DHS_ERA_FORECASTS_URL, dhsEraToStoredRow } from './dhs-allrecords';

const stored: Record<string, unknown>[] = [];

function query() {
  const self: Record<string, unknown> = {};
  const api = new Proxy(self, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown) =>
          resolve({ data: stored, count: stored.length, error: null });
      }
      return () => api;
    },
  });
  return api;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => query() }),
}));

vi.mock('@/lib/mcp/external-cache', () => ({
  liveWithLastGood: async (
    _api: unknown,
    _params: unknown,
    fetcher: () => Promise<{ value: unknown; failed: boolean }>,
  ) => {
    const res = await fetcher();
    return { value: res.value, source: 'live' as const };
  },
}));

import { agencyForecasts } from '@/mcp/tools/forecasts';
import { forecastSyncClock } from './query';

const SYNCED = '2026-11-20T12:00:00.000Z';
const DOE_URL = 'https://www.energy.gov/documents/osbp-acquisition-forecast-public-2026-11-16csv';

describe('forecast customer retrieval', () => {
  beforeEach(() => {
    stored.length = 0;
  });

  it('get_agency_forecasts returns the DOE row the collector would upsert', async () => {
    const text = readFileSync(join(__dirname, '__fixtures__/doe-2026-11-16-slice.csv'), 'utf8');
    const parsed = parseDoeCsv(text, { parseMoneyRange, parseSetAside, parseNaics });
    const row = doeForecastToDbRow(parsed.rows[0], { sourceUrl: DOE_URL, syncedAt: SYNCED });
    stored.push({ id: 'doe-1', ...row, updated_at: '2020-01-01T00:00:00.000Z' });

    const result = await agencyForecasts({ keyword: 'Forrestal', limit: 5 });
    expect(result.forecasts).toHaveLength(1);
    expect(result.forecasts[0]).toMatchObject({
      external_id: 'DOE-C:89303025DMA000037',
      agency: 'DOE',
      source_url: DOE_URL,
      as_of: SYNCED,
      as_of_basis: 'last_synced_at',
      incumbent_name: 'JB CONTRACTING, INC.',
      naics_code: '238320',
    });
    expect(result.forecasts[0].title).toMatch(/Forrestal/);
    expect(result.forecasts[0].as_of).not.toBe('2020-01-01T00:00:00.000Z');
    expect(result._meta.served_from).toBe('live');
    expect(result._meta.degraded).toBe(false);
  });

  it('get_agency_forecasts returns the DHS era row with the era source url', async () => {
    const live = JSON.parse(readFileSync(join(__dirname, '__fixtures__/dhs-era-singapore-pier.json'), 'utf8'));
    const row = dhsEraToStoredRow(live, SYNCED);
    expect(row).not.toBeNull();
    stored.push({ id: 'dhs-1', ...row });

    const result = await agencyForecasts({ limit: 5 });
    expect(result.forecasts[0]).toMatchObject({
      external_id: 'F2027076057',
      agency: 'DHS',
      source_url: DHS_ERA_FORECASTS_URL,
      as_of: SYNCED,
      as_of_basis: 'last_synced_at',
      naics_code: '488310',
    });
    expect(result.forecasts[0].title).toBe('Singapore Pier and Shoreside Support');
  });

  it('a missing sync clock stays unavailable for Ask Mindy and the tool', () => {
    const clock = forecastSyncClock({ last_synced_at: null, updated_at: '2026-11-01T00:00:00.000Z' });
    expect(clock).toEqual({
      as_of: null,
      as_of_basis: 'unavailable',
      row_updated_at: '2026-11-01T00:00:00.000Z',
    });
  });
});
