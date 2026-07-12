import { describe, it, expect } from 'vitest';
import { CREDIT_PACKAGES, creditsForPackage } from './packages';

describe('mcp credit packages', () => {
  it('maps known package ids to their credit amounts', () => {
    expect(creditsForPackage('starter')).toBe(250);
    expect(creditsForPackage('plus')).toBe(800);
    expect(creditsForPackage('scale')).toBe(2400);
  });

  it('TAMPER GUARD: unknown/forged/empty package grants nothing (null, not a default)', () => {
    expect(creditsForPackage('forged')).toBeNull();
    expect(creditsForPackage('')).toBeNull();
    expect(creditsForPackage(null)).toBeNull();
    expect(creditsForPackage(undefined)).toBeNull();
  });

  it('every package has positive credits + price + a stable id', () => {
    for (const p of CREDIT_PACKAGES) {
      expect(p.credits).toBeGreaterThan(0);
      expect(p.usd).toBeGreaterThan(0);
      expect(p.id).toMatch(/^[a-z]+$/);
    }
  });
});
