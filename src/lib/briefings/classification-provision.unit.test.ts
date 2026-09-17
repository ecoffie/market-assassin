import { describe, it, expect } from 'vitest';
import {
  decideClassificationWrite,
  classifyEntitlementDrift,
  accessTierForGrant,
} from './classification-provision';

describe('decideClassificationWrite', () => {
  it('inserts when there is no row', () => {
    expect(decideClassificationWrite(null, 'beta_preview')).toEqual({
      action: 'insert',
      access: 'beta_preview',
    });
  });

  it('never overwrites excluded — that is a deliberate cutoff', () => {
    const d = decideClassificationWrite(
      { briefings_access: 'excluded', briefings_expiry: null },
      'lifetime',
    );
    expect(d).toEqual({ action: 'skip', reason: 'excluded' });
  });

  it('upgrades none → beta_preview (the stranded-grant case)', () => {
    const d = decideClassificationWrite(
      { briefings_access: 'none', briefings_expiry: null },
      'beta_preview',
    );
    expect(d).toEqual({ action: 'update', access: 'beta_preview' });
  });

  it('upgrades beta_preview → subscription for a later paid grant', () => {
    const d = decideClassificationWrite(
      { briefings_access: 'beta_preview', briefings_expiry: null },
      'subscription',
    );
    expect(d).toEqual({ action: 'update', access: 'subscription' });
  });

  it('does not downgrade lifetime to beta_preview', () => {
    const d = decideClassificationWrite(
      { briefings_access: 'lifetime', briefings_expiry: null },
      'beta_preview',
    );
    expect(d).toEqual({ action: 'skip', reason: 'would_downgrade' });
  });

  it('no-ops when the requested tier is already in place', () => {
    const d = decideClassificationWrite(
      { briefings_access: 'subscription', briefings_expiry: null },
      'subscription',
    );
    expect(d).toEqual({ action: 'skip', reason: 'already_entitled' });
  });

  it('treats an EXPIRED entitling row as upgradeable, not already-entitled', () => {
    const d = decideClassificationWrite(
      { briefings_access: 'beta_preview', briefings_expiry: '2026-06-28T00:00:00Z' },
      'beta_preview',
      Date.parse('2026-09-17T00:00:00Z'),
    );
    expect(d).toEqual({ action: 'update', access: 'beta_preview' });
  });
});

describe('classifyEntitlementDrift — the four watchdog buckets', () => {
  const targeted = { targeted: true, briefingsEnabled: false, isActive: true as boolean | null };

  it('classification_mismatch when the sender cannot see them', () => {
    expect(classifyEntitlementDrift({
      ...targeted, entitlementOk: false, briefingsAccess: 'none',
    })).toBe('classification_mismatch');
    expect(classifyEntitlementDrift({
      ...targeted, entitlementOk: false, briefingsAccess: null,
    })).toBe('classification_mismatch');
  });

  it('delivery_disabled when classification already entitles', () => {
    expect(classifyEntitlementDrift({
      ...targeted, entitlementOk: true, briefingsAccess: 'subscription', briefingsEnabled: false,
    })).toBe('delivery_disabled');
  });

  it('intentionally_paused outranks everything — do not re-enable', () => {
    expect(classifyEntitlementDrift({
      isActive: false,
      briefingsEnabled: false,
      entitlementOk: false,
      briefingsAccess: 'none',
      targeted: true,
    })).toBe('intentionally_paused');
  });

  it('intentionally_excluded for the comp/testimonial cutoff', () => {
    expect(classifyEntitlementDrift({
      ...targeted, entitlementOk: false, briefingsAccess: 'excluded',
    })).toBe('intentionally_excluded');
  });

  it('healthy when all three gates agree', () => {
    expect(classifyEntitlementDrift({
      isActive: true,
      briefingsEnabled: true,
      entitlementOk: true,
      briefingsAccess: 'subscription',
      targeted: true,
    })).toBeNull();
  });

  it('untargeted active accounts are not mismatch (a briefing would be generic)', () => {
    expect(classifyEntitlementDrift({
      isActive: true,
      briefingsEnabled: false,
      entitlementOk: false,
      briefingsAccess: null,
      targeted: false,
    })).toBeNull();
  });
});

describe('accessTierForGrant', () => {
  it('maps Mindy Team / briefings monthly to subscription', () => {
    expect(accessTierForGrant('team', undefined)).toBe('subscription');
    expect(accessTierForGrant('briefings_monthly', undefined)).toBe('subscription');
  });
  it('maps Ultimate to lifetime and Pro Giant to 1_year', () => {
    expect(accessTierForGrant(undefined, 'ultimate')).toBe('lifetime');
    expect(accessTierForGrant(undefined, 'pro-giant-bundle')).toBe('1_year');
  });
  it('defaults unknown grants to beta_preview, never none', () => {
    expect(accessTierForGrant('hunter_pro', undefined)).toBe('beta_preview');
  });
});
