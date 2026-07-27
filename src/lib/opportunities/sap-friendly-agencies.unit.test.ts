import { describe, it, expect } from 'vitest';
import {
  sapBuyerTier,
  SAP_BUYER_TIERS,
  SAM_DEPARTMENT_TIERS,
  AGENCY_PO_SHARE,
} from './sap-friendly-agencies';

describe('sapBuyerTier — PO-share bands (measured 2026-07-27)', () => {
  it('classifies the three bands by PO-share', () => {
    expect(sapBuyerTier('Social Security Administration')).toBe('most');     // 62%
    expect(sapBuyerTier('Department of Veterans Affairs')).toBe('most');     // 33% (≥33)
    expect(sapBuyerTier('Department of Defense')).toBe('somewhat');          // 24%
    expect(sapBuyerTier('General Services Administration')).toBe('vehicle'); // 17%
  });

  it('bridges BOTH taxonomies to the same tier (SAM uppercase/inverted vs title-case)', () => {
    // The whole design hinges on normalizeAgencyKey aligning "DEPT OF DEFENSE" with
    // "Department of Defense" — if this breaks, the Open filter matches nothing.
    expect(sapBuyerTier('DEPT OF DEFENSE')).toBe(sapBuyerTier('Department of Defense'));
    expect(sapBuyerTier('VETERANS AFFAIRS, DEPARTMENT OF')).toBe(sapBuyerTier('Department of Veterans Affairs'));
    expect(sapBuyerTier('INTERIOR, DEPARTMENT OF THE')).toBe('most');
  });

  it('returns null for an unclassified / empty agency (never force-buckets)', () => {
    expect(sapBuyerTier('Postal Service')).toBeNull();  // not in the ≥200-row award set
    expect(sapBuyerTier('')).toBeNull();
    expect(sapBuyerTier(null)).toBeNull();
    expect(sapBuyerTier(undefined)).toBeNull();
  });
});

describe('SAP tier sets are honest + discriminating', () => {
  it('every AGENCY_PO_SHARE agency lands in exactly one tier set', () => {
    const all = [...SAP_BUYER_TIERS.most, ...SAP_BUYER_TIERS.somewhat, ...SAP_BUYER_TIERS.vehicle];
    expect(all.length).toBe(Object.keys(AGENCY_PO_SHARE).length);
    expect(new Set(all).size).toBe(all.length); // no key in two tiers
  });

  it('the "most" tier is a MINORITY (a >=20% cutoff kept 18/21 — useless; 3 bands must split)', () => {
    // Guards the design decision: if someone loosens the band and "most" swallows everyone,
    // the filter stops discriminating. Measured: most=7 of 21.
    const total = Object.keys(AGENCY_PO_SHARE).length;
    expect(SAP_BUYER_TIERS.most.length).toBeLessThan(total / 2);
    expect(SAP_BUYER_TIERS.vehicle.length).toBeGreaterThan(0); // there IS a vehicle-heavy tail
  });

  it('SAM_DEPARTMENT_TIERS holds real SAM taxonomy strings (query targets), non-empty per tier', () => {
    expect(SAM_DEPARTMENT_TIERS.most).toContain('VETERANS AFFAIRS, DEPARTMENT OF');
    expect(SAM_DEPARTMENT_TIERS.somewhat).toContain('DEPT OF DEFENSE');
    expect(SAM_DEPARTMENT_TIERS.vehicle).toContain('GENERAL SERVICES ADMINISTRATION');
    for (const t of ['most', 'somewhat', 'vehicle'] as const) {
      expect(SAM_DEPARTMENT_TIERS[t].length, t).toBeGreaterThan(0);
    }
  });

  it('every SAM_DEPARTMENT_TIERS entry actually resolves to its own tier (self-consistent)', () => {
    for (const t of ['most', 'somewhat', 'vehicle'] as const) {
      for (const dept of SAM_DEPARTMENT_TIERS[t]) {
        expect(sapBuyerTier(dept), dept).toBe(t);
      }
    }
  });
});
