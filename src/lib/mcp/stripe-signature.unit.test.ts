import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';
import crypto from 'node:crypto';

/**
 * SIGNATURE VALIDATION — local, with an isolated test secret and signed fixtures.
 *
 * ⚠️ SCOPE, stated precisely: this proves our signature VERIFICATION logic accepts a
 * correctly-signed payload and rejects tampering. It does NOT prove Stripe delivery —
 * no event from Stripe is involved, and the Stripe CLI is not authenticated here, so
 * `stripe listen` could not be used. Stripe-delivered testing remains OUTSTANDING.
 */
const SECRET = 'whsec_isolated_test_secret_not_used_anywhere_else';

function signedHeader(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

const stripe = new Stripe('sk_test_placeholder_key_for_construct_event_only');

const payload = JSON.stringify({
  id: 'evt_test_sig', object: 'event', type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_sig', object: 'checkout.session', mode: 'payment', payment_status: 'paid' } },
});

describe('stripe webhook signature verification', () => {
  it('ACCEPTS a correctly signed payload', () => {
    const evt = stripe.webhooks.constructEvent(payload, signedHeader(payload, SECRET), SECRET);
    expect(evt.type).toBe('checkout.session.completed');
  });

  it('REJECTS a forged signature', () => {
    expect(() => stripe.webhooks.constructEvent(payload, 't=1,v1=deadbeef', SECRET)).toThrow();
  });

  it('REJECTS a valid signature made with the WRONG secret', () => {
    const wrong = signedHeader(payload, 'whsec_a_different_secret_entirely');
    expect(() => stripe.webhooks.constructEvent(payload, wrong, SECRET)).toThrow();
  });

  it('REJECTS a tampered payload under a signature for the original', () => {
    const header = signedHeader(payload, SECRET);
    const tampered = payload.replace('"payment_status":"paid"', '"payment_status":"unpaid"');
    expect(() => stripe.webhooks.constructEvent(tampered, header, SECRET)).toThrow();
  });

  it('REJECTS a replayed old timestamp outside the tolerance window', () => {
    const old = Math.floor(Date.now() / 1000) - 3600; // an hour stale
    expect(() => stripe.webhooks.constructEvent(payload, signedHeader(payload, SECRET, old), SECRET, 300)).toThrow();
  });
});
