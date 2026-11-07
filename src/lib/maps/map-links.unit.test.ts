import { describe, expect, it } from 'vitest';
import {
  mapLinkForBuyer, mapLinkForCompany, mapLinkForForecast, mapLinkForOpportunity,
  mapLinkForRecompete, mapLinkForSavedSearch,
} from './map-links';

describe('map record links', () => {
  it('builds one id per link and nothing else', () => {
    expect(mapLinkForOpportunity('006d77f604a74dd0a16c99d041e6c032')).toBe('/opportunity-map?opp=006d77f604a74dd0a16c99d041e6c032');
    expect(mapLinkForRecompete('CONT_AWD_W912_9700')).toBe('/opportunity-map?recompete=CONT_AWD_W912_9700');
    expect(mapLinkForCompany('abc123def456')).toBe('/opportunity-map?company=ABC123DEF456');
    expect(mapLinkForBuyer(42)).toBe('/opportunity-map?buyer=42');
    expect(mapLinkForForecast('fc-9')).toBe('/opportunity-map?forecast=fc-9');
    expect(mapLinkForSavedSearch('ss-1')).toBe('/opportunity-map?ss=ss-1');
  });
  it('routes fc- ids to ?forecast=', () => {
    expect(mapLinkForOpportunity('fc-123')).toBe('/opportunity-map?forecast=fc-123');
  });
  it('returns null without an id (no link to a blank map)', () => {
    for (const f of [mapLinkForOpportunity, mapLinkForRecompete, mapLinkForCompany, mapLinkForBuyer, mapLinkForForecast, mapLinkForSavedSearch]) {
      expect(f('')).toBeNull();
      expect(f(null)).toBeNull();
      expect(f(undefined)).toBeNull();
    }
  });
  it('encodes ids', () => {
    expect(mapLinkForRecompete('A&B')).toBe('/opportunity-map?recompete=A%26B');
  });
});
