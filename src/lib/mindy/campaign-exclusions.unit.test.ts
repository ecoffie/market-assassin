/**
 * The billing canary is a real Stripe subscription at 100% off. Its accounts must count
 * as non-customers everywhere metrics exclude special accounts (MRR, purchasers, DAU).
 */
import { describe, it, expect } from 'vitest';
import { isExcludedFromMetrics, isCampaignExcludedEmail, INTERNAL_CANARY_EMAILS } from './campaign-exclusions';

describe('internal billing canary accounts', () => {
  it('are excluded from metrics and campaigns (case-insensitive)', () => {
    for (const e of INTERNAL_CANARY_EMAILS) {
      expect(isExcludedFromMetrics(e)).toBe(true);
      expect(isExcludedFromMetrics(e.toUpperCase())).toBe(true);
      expect(isCampaignExcludedEmail(e)).toBe(true);
    }
  });

  it('does not exclude a real customer', () => {
    expect(isExcludedFromMetrics('mgbuilders311@gmail.com')).toBe(false);
    expect(isExcludedFromMetrics(null)).toBe(false);
  });
});
