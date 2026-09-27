import { describe, it, expect } from 'vitest';
import { buildBusinessProfileUpdate, buildBusinessProfileInsert } from './business-profile-patch';

/**
 * INVARIANT: updating one profile field must not erase unrelated stored
 * profile information. Every caller below is a real POST /api/app/profile
 * payload shape (Market Research "save to profile", the Opportunity Map
 * settings drawer, CapabilityNudge, onboarding).
 */
const NOW = '2026-09-26T00:00:00.000Z';

describe('buildBusinessProfileUpdate — omitted fields are left untouched', () => {
  it('Market Research save (codes + keyword, no description, no setAsides) does not wipe description or set-asides', () => {
    const patch = buildBusinessProfileUpdate({
      businessDescription: undefined,
      expandedNaicsCodes: ['238220'],
      setAsides: undefined,
      safeSetAsides: [],
      nowIso: NOW,
    });
    expect(patch).not.toBeNull();
    expect(patch).not.toHaveProperty('business_description');
    expect(patch).not.toHaveProperty('extracted_set_asides');
    expect(patch!.extracted_naics_codes).toEqual(['238220']);
  });

  it('CapabilityNudge save without company NAICS does not wipe stored extracted_naics_codes', () => {
    const patch = buildBusinessProfileUpdate({
      businessDescription: 'commercial HVAC in Georgia',
      expandedNaicsCodes: [],
      setAsides: undefined,
      safeSetAsides: [],
      nowIso: NOW,
    });
    expect(patch).not.toHaveProperty('extracted_naics_codes');
    expect(patch).not.toHaveProperty('extracted_set_asides');
    expect(patch!.business_description).toBe('commercial HVAC in Georgia');
    expect(patch!.business_description_updated_at).toBe(NOW);
  });

  it('a blank/null description (onboarding UEI path sends `autoText.trim() || null`) does not wipe the stored one', () => {
    for (const blank of [null, '', '   ']) {
      const patch = buildBusinessProfileUpdate({
        businessDescription: blank,
        expandedNaicsCodes: ['541512'],
        setAsides: ['8(a)'],
        safeSetAsides: ['8(a)'],
        nowIso: NOW,
      });
      expect(patch).not.toHaveProperty('business_description');
    }
  });

  it('an explicit setAsides array (onboarding) is still written, including an explicit []', () => {
    const patch = buildBusinessProfileUpdate({
      businessDescription: undefined,
      expandedNaicsCodes: [],
      setAsides: [],
      safeSetAsides: [],
      nowIso: NOW,
    });
    expect(patch!.extracted_set_asides).toEqual([]);
  });

  it('a save that touches none of these columns writes nothing', () => {
    const patch = buildBusinessProfileUpdate({
      businessDescription: undefined,
      expandedNaicsCodes: [],
      setAsides: undefined,
      safeSetAsides: [],
      nowIso: NOW,
    });
    expect(patch).toBeNull();
  });

  it('description is trimmed', () => {
    const patch = buildBusinessProfileUpdate({
      businessDescription: '  We do roofing  ',
      expandedNaicsCodes: [],
      setAsides: undefined,
      safeSetAsides: [],
      nowIso: NOW,
    });
    expect(patch!.business_description).toBe('We do roofing');
  });
});

describe('buildBusinessProfileInsert — a new row still gets the full shape', () => {
  it('fills defaults for omitted fields (nothing stored to protect)', () => {
    const row = buildBusinessProfileInsert({
      businessDescription: undefined,
      expandedNaicsCodes: [],
      setAsides: undefined,
      safeSetAsides: [],
      nowIso: NOW,
    });
    expect(row).toMatchObject({
      business_description: null,
      extracted_naics_codes: [],
      extracted_set_asides: [],
      created_at: NOW,
      updated_at: NOW,
    });
  });
});

describe('POST /api/app/profile is wired through the partial-update builder', () => {
  it('the route writes user_business_profiles via buildBusinessProfileUpdate, never `businessDescription || null`', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../app/api/app/profile/route.ts'), 'utf8');
    expect(src).toContain('buildBusinessProfileUpdate(bpInput)');
    expect(src).not.toMatch(/business_description:\s*businessDescription\s*\|\|\s*null/);
  });
});
