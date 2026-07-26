import { describe, it, expect } from 'vitest';
import { geocodeCity, stableSeed } from './city-geocode';

describe('geocodeCity', () => {
  it('resolves a real city to its exact GeoNames coordinate (city precision)', () => {
    const r = geocodeCity('Louisville', 'KY');
    expect(r).not.toBeNull();
    expect(r!.precision).toBe('city');
    // Real Louisville KY, NOT Kentucky's state centroid (37.5, -85.3).
    expect(r!.lat).toBeCloseTo(38.189, 1);
    expect(r!.lng).toBeCloseTo(-85.6768, 1);
  });

  it('is case-insensitive on the city name', () => {
    const r = geocodeCity('LOUISVILLE', 'ky');
    expect(r).not.toBeNull();
    expect(r!.precision).toBe('city');
  });

  it('falls back to the state centroid when the city is unknown/empty (never fabricates)', () => {
    const r = geocodeCity('', 'KY');
    expect(r).not.toBeNull();
    expect(r!.precision).toBe('state');
    // KY centroid per STATE_CENTROIDS.
    expect(r!.lat).toBeCloseTo(37.5, 0);
    expect(r!.lng).toBeCloseTo(-85.3, 0);
  });

  it('falls back to the state centroid for a real but not-in-table city name', () => {
    const r = geocodeCity('Not A Real City Name Xyz', 'KY');
    expect(r).not.toBeNull();
    expect(r!.precision).toBe('state');
  });

  it('returns null when the state itself is not recognized (never fabricates any coordinate)', () => {
    expect(geocodeCity('Anywhere', 'ZZ')).toBeNull();
    expect(geocodeCity('Anywhere', '')).toBeNull();
    expect(geocodeCity('Anywhere', null)).toBeNull();
  });

  it('jitters distinct seeds at the same city apart so multiple pins do not stack', () => {
    const a = geocodeCity('Louisville', 'KY', 1);
    const b = geocodeCity('Louisville', 'KY', 5);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.precision).toBe('city');
    expect(b!.precision).toBe('city');
    expect(a!.lat !== b!.lat || a!.lng !== b!.lng).toBe(true);
    // Jitter stays small (bounded to the city, not a state-wide ring).
    expect(Math.abs(a!.lat - 38.189)).toBeLessThan(0.2);
  });

  it('accepts a full state name as well as a 2-letter code', () => {
    const byCode = geocodeCity('Louisville', 'KY');
    const byName = geocodeCity('Louisville', 'Kentucky');
    expect(byName).not.toBeNull();
    expect(byName!.lat).toBeCloseTo(byCode!.lat, 5);
  });
});

describe('stableSeed', () => {
  it('is deterministic for the same input', () => {
    expect(stableSeed('abc-123')).toBe(stableSeed('abc-123'));
  });

  it('differs across distinct inputs (not a constant)', () => {
    expect(stableSeed('abc-123')).not.toBe(stableSeed('xyz-999'));
  });
});
