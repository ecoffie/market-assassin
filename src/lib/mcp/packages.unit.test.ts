import { describe, it, expect } from 'vitest';
import { CREDIT_PACKAGES, creditsForPackage } from './packages';

describe('mcp credit packages', () => {
  it('maps the single top-up package id to its credit amount (GOS #015)', () => {
    expect(creditsForPackage('refill')).toBe(500);
  });

  it('retired packs are no longer granted (starter/plus/scale removed by 2026-07-19)', () => {
    expect(creditsForPackage('starter')).toBeNull();
    expect(creditsForPackage('plus')).toBeNull();
    expect(creditsForPackage('scale')).toBeNull();
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
