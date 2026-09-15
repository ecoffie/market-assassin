/**
 * The offer must survive INSIDE the conversation.
 *
 * Measured over the first six days of launch: 40 paywall refusals across 15 distinct users
 * produced ONE visit to the resume page and zero purchases. The drop-off is the click out
 * of the assistant — not the page it lands on. So the wall now carries the price and two
 * pressable Stripe links in the message itself.
 *
 * ⚠️ REVISED 2026-09-15 (Eric). The message no longer carries Stripe links directly. An
 * MCP error payload is TEXT — it cannot POST — so a direct link there must be a static
 * payment LINK, and payment links do not forward `?attempt=`. The purchase could be tied
 * to the ACCOUNT but never to the blocked REQUEST, so the saved request could not resume.
 * The offer now links to /mcp/continue, which POSTs /api/mcp/checkout and sets
 * client_reference_id AND metadata.attempt server-side.
 *
 * KNOWN TENSION, recorded rather than buried: the measurement above says the drop-off IS
 * the click out of the assistant, and this change adds a click. It is accepted because an
 * unattributed purchase cannot resume the request the user was blocked on — the thing the
 * flow exists to deliver. Watch offer_page_opened_at → checkout_clicked_at to see the real
 * cost; if it proves material, the fix is a better landing page, not a link that drops
 * attribution.
 *
 * These tests pin what makes buying-from-chat safe NOW:
 *   1. the offer routes through the resume page carrying the attempt id
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
  it('names both a subscription and a no-subscription option, and routes to the resume page', () => {
    const msg = wall();
    // Both options are still NAMED with their real price/credits from packages.ts …
    expect(msg).toContain(`$${ENTRY.monthly.usd}/mo`);
    expect(msg).toContain(`$${TOPUP.usd}`);
    expect(msg).toContain(TOPUP.credits.toLocaleString());
    // … but the only link is the resume page, carrying the attempt so checkout can be
    // created server-side WITH attribution.
    expect(msg).toContain('/mcp/continue?attempt=');
    expect(msg).not.toContain('buy.stripe.com');
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

  it('offers the same purchase path on the Pro gate', () => {
    const msg = wall({ reason: 'requires_pro', toolName: 'build_pursuit_dossier' });
    expect(msg).toContain(`$${ENTRY.monthly.usd}/mo`);
    expect(msg).toContain(`$${TOPUP.usd}`);
    expect(msg).toContain('/mcp/continue?attempt=');
  });

  it('stays short enough to read in a chat turn', () => {
    // A wall of links mid-conversation reads as a sales pitch. Two options, not six.
    const msg = wall();
    expect(msg.split('\n').filter((l) => l.trim().startsWith('→'))).toHaveLength(2);
    expect(msg.length).toBeLessThan(1200);
  });
});

describe('identity rides along — credits must land on the right account', () => {
  it('the message never carries a raw Stripe link that could take a payment unattributed', () => {
    // THE GUARANTEE IS UNCHANGED — the guard against the real incident where a user paid
    // on one identity and spent credits on another. What changed is WHERE it is enforced.
    //
    // Before: the message embedded Stripe links with ?client_reference_id=<email>, i.e.
    // identity asserted by a URL the client could edit or strip.
    // Now: the message links only to /mcp/continue, and identity is resolved SERVER-SIDE
    // from the verified session in /api/mcp/checkout — which also rejects an attempt
    // belonging to another account with 403. That is strictly stronger than a query param.
    const msg = wall({ userEmail: 'tabitha@example.com', attemptId: 'abc-123' });
    expect(msg).not.toMatch(/https:\/\/buy\.stripe\.com/);
    expect(msg).toContain('/mcp/continue?attempt=abc-123');
    // And the email is NOT put in the URL any more — nothing for a client to tamper with.
    expect(msg).not.toContain('client_reference_id');
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
