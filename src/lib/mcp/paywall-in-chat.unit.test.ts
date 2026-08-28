/**
 * The offer must survive INSIDE the conversation.
 *
 * Measured over the first six days of launch: 40 paywall refusals across 15 distinct users
 * produced ONE visit to the resume page and zero purchases. The drop-off is the click out
 * of the assistant — not the page it lands on. So the wall now carries the price and two
 * pressable Stripe links in the message itself.
 *
 * These tests pin the three things that make buying-from-chat safe:
 *   1. identity rides along, so a purchase credits the RIGHT account
 *   2. prices come from packages.ts, never hardcoded in copy
 *   3. an unknown balance is never rendered as "you have 0"
 */
import { describe, it, expect } from 'vitest';
import { paywallMessage, __testing } from './paywall';
import { SUBSCRIPTION_PLANS, CREDIT_PACKAGES } from './packages';

const ENTRY = SUBSCRIPTION_PLANS.find((p) => p.id === 'entry') ?? SUBSCRIPTION_PLANS[0];
const TOPUP = CREDIT_PACKAGES[0];

function wall(over: Partial<Parameters<typeof paywallMessage>[0]> = {}) {
  return paywallMessage({
    toolName: 'generate_market_report',
    reason: 'insufficient_credits',
    creditsRequired: 100,
    balance: 0,
    attemptId: 'attempt-1',
    userEmail: 'buyer@example.com',
    ...over,
  });
}

describe('the offer is in the message', () => {
  it('carries both a subscription and a no-subscription option', () => {
    const msg = wall();
    expect(msg).toContain(ENTRY.monthly.checkoutUrl.split('?')[0]);
    expect(msg).toContain(TOPUP.checkoutUrl.split('?')[0]);
  });

  it('states the price and the real balance', () => {
    expect(wall()).toContain('costs 100 credits — you have 0');
  });

  it('shows what the plan actually buys, from packages.ts', () => {
    const msg = wall();
    expect(msg).toContain(`$${ENTRY.monthly.usd}/mo`);
    expect(msg).toContain(ENTRY.creditsPerMonth.toLocaleString());
    expect(msg).toContain(`$${TOPUP.usd}`);
  });

  it('still links the saved request as the secondary path', () => {
    expect(wall()).toContain('attempt=attempt-1');
  });

  it('offers the same purchase paths on the Pro gate', () => {
    const msg = wall({ reason: 'requires_pro', toolName: 'build_pursuit_dossier' });
    expect(msg).toContain(ENTRY.monthly.checkoutUrl.split('?')[0]);
    expect(msg).toContain(TOPUP.checkoutUrl.split('?')[0]);
  });

  it('stays short enough to read in a chat turn', () => {
    // A wall of links mid-conversation reads as a sales pitch. Two options, not six.
    const msg = wall();
    expect(msg.split('\n').filter((l) => l.trim().startsWith('→'))).toHaveLength(2);
    expect(msg.length).toBeLessThan(1200);
  });
});

describe('identity rides along — credits must land on the right account', () => {
  it('threads the buyer email into every checkout link', () => {
    const msg = wall({ userEmail: 'tabitha@example.com' });
    // This is the guard against the real incident where a user paid on one identity and
    // spent credits on another.
    const links = msg.match(/https:\/\/buy\.stripe\.com\/\S+/g) ?? [];
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const l of links) {
      expect(l).toContain('client_reference_id=tabitha%40example.com');
    }
  });

  it('ties the purchase back to the refused request', () => {
    const links = (wall({ attemptId: 'abc-123' }).match(/https:\/\/buy\.stripe\.com\/\S+/g) ?? []);
    for (const l of links) expect(l).toContain('attempt=abc-123');
  });

  it('still produces working links when identity is unknown', () => {
    const msg = wall({ userEmail: null, attemptId: null });
    expect(msg).toContain(ENTRY.monthly.checkoutUrl.split('?')[0]);
    expect(msg).not.toContain('client_reference_id=null');
    expect(msg).not.toContain('undefined');
  });

  it('never breaks the message over a malformed checkout URL', () => {
    expect(__testing.checkoutLink('not a url', 'x@y.com', 'a1')).toBe('not a url');
  });
});

describe('unknown is not zero', () => {
  it('omits the balance rather than claiming zero when it is unknown', () => {
    const msg = wall({ balance: undefined });
    expect(msg).toContain('costs 100 credits');
    expect(msg).not.toMatch(/you have (0|undefined|null)/i);
  });

  it('says nothing about price when the cost itself is unknown', () => {
    expect(__testing.priceLine(undefined, 0)).toBeNull();
  });

  it('reports a real zero balance when it genuinely is zero', () => {
    expect(__testing.priceLine(100, 0)).toContain('you have 0');
  });
});
