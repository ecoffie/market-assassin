/**
 * Shared forecast identity (generate_market_report + FIND coming_soon).
 * Real pairs from production report m0MvDRsue6YHm0q9Xkx4mA (NAICS 237310 / VA, 2026-11-23):
 * each was listed twice with forecasts_duplicates_removed: 0.
 */
import { describe, it, expect } from 'vitest';
import { dedupeForecasts, forecastIdentity, forecastListingKey } from './forecast-identity';

const GW = 'https://acquisitiongateway.gov/forecast';
const fhwaGateway = { agency: 'DOT', external_id: 'GW-L:FHWA-2026-167', title: 'VA ST FB KNGMN-WLKR GTS', source_url: GW, as_of: '2026-11-20T00:00:00Z', pop_state: 'VA' };
const fhwaLegacy = { agency: 'DOT', external_id: 'FHWA_2026_167', title: 'VA ST FB KNGMN-WLKR GTS', source_url: null, as_of: '2026-08-01T00:00:00Z', pop_state: 'VA United States' };
const gwjGateway = { agency: 'USDA', external_id: 'GW-L:FY26-010880', title: 'George Washington and Jefferson National Forests Road Maintenance IDIQ Forest-Wide', source_url: GW, as_of: '2026-11-20T00:00:00Z' };
const gwjLegacy = { agency: 'USDA', external_id: 'FY26_010880', title: 'George Washington and Jefferson National Forests Road Maintenance IDIQ Forest-Wide', source_url: null, as_of: '2026-08-01T00:00:00Z' };

describe('forecastIdentity — gateway listing vs legacy id', () => {
  it('GW-L:FHWA-2026-167 and FHWA_2026_167 (DOT) are one forecast', () => {
    expect(forecastIdentity(fhwaGateway)).toBe(forecastIdentity(fhwaLegacy));
  });
  it('GW-L:FY26-010880 and FY26_010880 (USDA) are one forecast', () => {
    expect(forecastIdentity(gwjGateway)).toBe(forecastIdentity(gwjLegacy));
  });
  it('raw rows (source_agency) and report rows (agency) share the key', () => {
    expect(forecastIdentity({ source_agency: 'DOT', external_id: 'FHWA_2026_167' })).toBe(forecastIdentity(fhwaGateway));
  });
  it('the prior bare-numeric twin rule still holds', () => {
    expect(forecastListingKey('GW-L:7799')).toBe(forecastListingKey('7799'));
  });
  it('never merges across agencies, or on a different listing number', () => {
    expect(forecastIdentity({ ...fhwaLegacy, agency: 'USDA' })).not.toBe(forecastIdentity(fhwaGateway));
    expect(forecastIdentity({ ...fhwaLegacy, external_id: 'FHWA_2026_168' })).not.toBe(forecastIdentity(fhwaGateway));
  });
  it('never merges on title: same title, different listing ids stay two', () => {
    const { rows, removed } = dedupeForecasts([fhwaGateway, { ...fhwaGateway, external_id: 'GW-L:FHWA-2026-999' }]);
    expect(rows).toHaveLength(2);
    expect(removed).toBe(0);
  });
});

describe('dedupeForecasts — which twin is shown, and the count', () => {
  const other = { agency: 'DOT', external_id: 'GW-L:FHWA-2026-200', title: 'Other road job', source_url: GW };
  it('the two real pairs collapse to two rows and count 2 removed', () => {
    const { rows, removed } = dedupeForecasts([fhwaLegacy, gwjGateway, other, fhwaGateway, gwjLegacy]);
    expect(removed).toBe(2);
    expect(rows.map((r) => r.external_id)).toEqual(['GW-L:FHWA-2026-167', 'GW-L:FY26-010880', 'GW-L:FHWA-2026-200']);
  });
  it('keeps the gateway listing row (canonical id + source_url) in the first occurrence slot, whichever order', () => {
    expect(dedupeForecasts([fhwaLegacy, fhwaGateway]).rows).toEqual([fhwaGateway]);
    expect(dedupeForecasts([fhwaGateway, fhwaLegacy]).rows).toEqual([fhwaGateway]);
  });
  it('between two non-gateway twins: source_url, then newest sync clock', () => {
    const a = { agency: 'X', external_id: 'A_1', source_url: null, last_synced_at: '2026-11-01' };
    const b = { agency: 'X', external_id: 'A-1', source_url: 'https://x', last_synced_at: '2026-01-01' };
    expect(dedupeForecasts([a, b]).rows).toEqual([b]);
    const c = { ...a, last_synced_at: '2026-11-05' };
    expect(dedupeForecasts([a, c]).rows).toEqual([c]);
  });
  it('listingOnly: rows without a listing id always pass through', () => {
    const noId = { agency: 'DHS', title: 'Same', external_id: null };
    expect(dedupeForecasts([noId, { ...noId }], { listingOnly: true }).removed).toBe(0);
    expect(dedupeForecasts([noId, { ...noId }]).removed).toBe(1);
    expect(dedupeForecasts([fhwaLegacy, fhwaGateway], { listingOnly: true }).removed).toBe(1);
  });
});
