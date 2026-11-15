/**
 * The billing canary is a real Stripe subscription at 100% off. Its accounts must count
 * as non-customers everywhere metrics exclude special accounts (MRR, purchasers, DAU).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isExcludedFromMetrics,
  isCampaignExcludedEmail,
  isInternalTestAccount,
  INTERNAL_CANARY_EMAILS,
  internalTestEmails,
} from './campaign-exclusions';

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

describe('internal test accounts (INTERNAL_TEST_EMAILS env)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('none when the variable is unset', () => {
    vi.stubEnv('INTERNAL_TEST_EMAILS', '');
    expect(internalTestEmails().size).toBe(0);
    expect(isInternalTestAccount('qa-tester@example.test')).toBe(false);
  });

  it('parses a comma list, trimming and lowercasing, and excludes everywhere', () => {
    vi.stubEnv('INTERNAL_TEST_EMAILS', ' QA-Tester@Example.test , ,second-qa@example.test ');
    expect([...internalTestEmails()].sort()).toEqual(['qa-tester@example.test', 'second-qa@example.test']);
    for (const v of ['qa-tester@example.test', 'QA-TESTER@EXAMPLE.TEST', '  second-qa@example.test ']) {
      expect(isInternalTestAccount(v)).toBe(true);
      expect(isExcludedFromMetrics(v)).toBe(true);
      expect(isCampaignExcludedEmail(v)).toBe(true);
    }
  });

  it('is an explicit list, not a domain rule', () => {
    vi.stubEnv('INTERNAL_TEST_EMAILS', 'qa-tester@example.test');
    expect(isInternalTestAccount('someone-else@example.test')).toBe(false);
    expect(isInternalTestAccount('customer@example.test')).toBe(false);
    expect(isInternalTestAccount(null)).toBe(false);
    expect(isInternalTestAccount('')).toBe(false);
  });
});
