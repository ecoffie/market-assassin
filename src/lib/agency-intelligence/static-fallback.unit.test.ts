import { describe, expect, it } from 'vitest';
import { findStaticAgency, staticFallbackClaims } from './index';

describe('static pain-point fallback does not expose another agency or undated historical GAO', () => {
  it('refuses a substring that sits inside Department', () => {
    expect(findStaticAgency('artment')).toBeNull();
    expect(staticFallbackClaims('artment')).toEqual([]);
  });

  it('labels bare (Source: GAO) strings with the historical date and keeps them', () => {
    const claims = staticFallbackClaims('Department of Defense');
    const historical = claims.filter((c) => c.includes('Anthrax Vaccine'));
    expect(historical.length).toBe(1);
    expect(historical[0]).toMatch(/historical GAO finding, published \d{4}-\d{2}-\d{2}/);
    expect(historical[0]).toMatch(/LEGACY_MANUAL/);
    expect(historical[0]).not.toMatch(/\(Source: GAO\)$/);
    expect(claims.length).toBeGreaterThan(0);
  });
});
