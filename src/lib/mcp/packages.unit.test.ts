import { describe, it, expect } from 'vitest';
import { CREDIT_PACKAGES, creditsForPackage } from './packages';

describe('mcp credit packages', () => {
  it('maps known package ids to their credit amounts', () => {
    expect(creditsForPackage('plus')).toBe(800);
    expect(creditsForPackage('scale')).toBe(2400);
  });

  it('retired $5 Starter pack is no longer granted (removed 2026-07-14)', () => {
    expect(creditsForPackage('starter')).toBeNull();
  });

  it('TAMPER GUARD: unknown/forged/empty package grants nothing (null, not a default)', () => {
    expect(creditsForPackage('forged')).toBeNull();
    expect(creditsForPackage('')).toBeNull();
    expect(creditsForPackage(null)).toBeNull();
    expect(creditsForPackage(undefined)).toBeNull();
  });

  it('every package has positive credits + price + a stable id + a Stripe checkout link', () => {
    for (const p of CREDIT_PACKAGES) {
      expect(p.credits).toBeGreaterThan(0);
      expect(p.usd).toBeGreaterThan(0);
      expect(p.id).toMatch(/^[a-z]+$/);
      expect(p.checkoutUrl).toMatch(/^https:\/\/buy\.stripe\.com\//);
    }
  });
});
