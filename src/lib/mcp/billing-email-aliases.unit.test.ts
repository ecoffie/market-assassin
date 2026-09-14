import { describe, expect, it } from 'vitest';
import { resolveMcpCreditEmail, MCP_BILLING_EMAIL_ALIASES } from './billing-email-aliases';

describe('resolveMcpCreditEmail', () => {
  it('remaps Ereck Stripe billing email to the working MCP account', () => {
    expect(resolveMcpCreditEmail('ereck@harrisonplus.com')).toBe('ereck@serviceopsgroup.com');
    expect(resolveMcpCreditEmail('Ereck@HarrisonPlus.com')).toBe('ereck@serviceopsgroup.com');
  });

  it('passes through unknown emails unchanged (lowercased)', () => {
    expect(resolveMcpCreditEmail('buyer@example.com')).toBe('buyer@example.com');
    expect(resolveMcpCreditEmail('Buyer@Example.COM')).toBe('buyer@example.com');
  });

  it('keeps the alias map tiny and explicit (no silent bulk remaps)', () => {
    expect(Object.keys(MCP_BILLING_EMAIL_ALIASES).length).toBeLessThanOrEqual(20);
  });
});
