import { describe, it, expect } from 'vitest';
import { accessKind, expiryIsMeaningful, rowHealth, ENTITLING_TIERS } from './entitlement-semantics';

describe('access kinds — purchased vs granted', () => {
  it('separates the two concepts the column used to conflate', () => {
    expect(accessKind('1_year')).toBe('purchased');
    expect(accessKind('lifetime')).toBe('purchased');
    expect(accessKind('subscription')).toBe('purchased');
    // beta_preview is a GRANT, and it covers 106 of the 135 accounts currently
    // receiving — treating this table as purchase-only would cut them off.
    expect(accessKind('beta_preview')).toBe('granted');
    expect(accessKind('none')).toBe('none');
    expect(accessKind('excluded')).toBe('none');
    expect(accessKind(null)).toBe('none');
  });

  it('keeps grants entitling — the sender must still honour them', () => {
    expect(ENTITLING_TIERS.has('beta_preview')).toBe(true);
    expect(ENTITLING_TIERS.has('none')).toBe(false);
  });
});

describe('expiry is meaningful only on a time-boxed purchase', () => {
  it('applies to 1_year and nothing else', () => {
    expect(expiryIsMeaningful('1_year')).toBe(true);
    // A subscription ends by going inactive in Stripe, not by a stamped date.
    expect(expiryIsMeaningful('subscription')).toBe(false);
    expect(expiryIsMeaningful('lifetime')).toBe(false);
    // A grant is revoked by changing the tier, never by an expiry.
    expect(expiryIsMeaningful('beta_preview')).toBe(false);
  });
});

describe('rowHealth', () => {
  const NOW = Date.parse('2026-08-15T00:00:00Z');

  it('flags a FUTURE expiry on an active row — the silent-cutoff trap', () => {
    // The 3 real rows: they lapse mid-service with no warning, no renewal path.
    const h = rowHealth({ briefings_access: '1_year', briefings_expiry: '2027-01-16T00:00:00Z' }, NOW);
    expect(h.expired).toBe(false);
    expect(h.lapsesOn).toBe('2027-01-16');
  });

  it('flags an expiry stamped on a grant as spurious', () => {
    const h = rowHealth({ briefings_access: 'beta_preview', briefings_expiry: '2026-12-31T00:00:00Z' }, NOW);
    expect(h.spuriousExpiry).toBe(true);
  });

  it('does not flag a null expiry — that is the correct shape', () => {
    const h = rowHealth({ briefings_access: 'beta_preview', briefings_expiry: null }, NOW);
    expect(h.spuriousExpiry).toBe(false);
    expect(h.lapsesOn).toBeNull();
    expect(h.expired).toBe(false);
  });

  it('reports an already-expired row without calling it a pending lapse', () => {
    const h = rowHealth({ briefings_access: 'beta_preview', briefings_expiry: '2026-06-28T00:00:00Z' }, NOW);
    expect(h.expired).toBe(true);
    expect(h.lapsesOn).toBeNull();
  });

  it('ignores a lapse on a non-entitling row — nothing to lose', () => {
    const h = rowHealth({ briefings_access: 'none', briefings_expiry: '2027-01-01T00:00:00Z' }, NOW);
    expect(h.lapsesOn).toBeNull();
  });
});
