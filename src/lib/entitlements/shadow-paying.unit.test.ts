import { describe, it, expect, afterEach, vi } from 'vitest';
import { shadowAccountIsPaying } from './shadow-paying';

afterEach(() => vi.unstubAllEnvs());

describe('shadowAccountIsPaying', () => {
  it('keeps the previous rule for ordinary accounts', () => {
    expect(shadowAccountIsPaying('customer@example.test', ['manual_grant'])).toBe(true);
    expect(shadowAccountIsPaying('customer@example.test', ['stripe_subscription'])).toBe(true);
    expect(shadowAccountIsPaying('customer@example.test', ['trial', 'mcp_credit_balance'])).toBe(false);
    expect(shadowAccountIsPaying('customer@example.test', [])).toBe(false);
  });

  it('a staff manual grant is not paying', () => {
    expect(shadowAccountIsPaying('staffer@example.test', ['staff', 'manual_grant'])).toBe(false);
  });

  it('an internal test account manual grant is not paying', () => {
    vi.stubEnv('INTERNAL_TEST_EMAILS', 'qa-tester@example.test');
    expect(shadowAccountIsPaying('QA-Tester@example.test', ['manual_grant'])).toBe(false);
  });

  it('staff or test accounts with a real paid source still count as paying', () => {
    vi.stubEnv('INTERNAL_TEST_EMAILS', 'qa-tester@example.test');
    expect(shadowAccountIsPaying('staffer@example.test', ['staff', 'manual_grant', 'stripe_subscription'])).toBe(true);
    expect(shadowAccountIsPaying('qa-tester@example.test', ['manual_grant', 'stripe_subscription'])).toBe(true);
  });
});
