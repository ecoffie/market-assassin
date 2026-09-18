import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import {
  cancelSubscriptionForDispute,
  isInquiryDispute,
  subscriptionIdFromInvoice,
  type DisputeCancelStripe,
} from './cancel-on-dispute';

function dispute(over: Partial<Stripe.Dispute> = {}): Stripe.Dispute {
  return {
    id: 'du_1',
    object: 'dispute',
    charge: 'ch_1',
    status: 'needs_response',
    amount: 14900,
    currency: 'usd',
    reason: 'subscription_canceled',
    payment_method_details: {
      type: 'card',
      card: { brand: 'discover', case_type: 'chargeback', network_reason_code: '4541' },
    },
    ...over,
  } as Stripe.Dispute;
}

function invoice(over: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: 'in_1',
    object: 'invoice',
    subscription: 'sub_1',
    ...over,
  } as unknown as Stripe.Invoice;
}

function charge(over: Record<string, unknown> = {}): Stripe.Charge {
  return {
    id: 'ch_1',
    object: 'charge',
    invoice: 'in_1',
    ...over,
  } as unknown as Stripe.Charge;
}

describe('subscriptionIdFromInvoice', () => {
  it('reads the legacy invoice.subscription string', () => {
    expect(subscriptionIdFromInvoice(invoice())).toBe('sub_1');
  });

  it('reads Billing API parent.subscription_details.subscription', () => {
    expect(
      subscriptionIdFromInvoice(
        invoice({
          subscription: null,
          parent: { subscription_details: { subscription: 'sub_parent' } },
        }),
      ),
    ).toBe('sub_parent');
  });

  it('returns null on a one-time invoice', () => {
    expect(subscriptionIdFromInvoice(invoice({ subscription: null, parent: null, lines: { data: [] } }))).toBeNull();
  });
});

describe('isInquiryDispute', () => {
  it('treats warning_* as inquiry, not a chargeback', () => {
    expect(isInquiryDispute(dispute({ status: 'warning_needs_response' }))).toBe(true);
    expect(isInquiryDispute(dispute({ status: 'needs_response' }))).toBe(false);
  });
});

describe('cancelSubscriptionForDispute', () => {
  const retrieveCharge = vi.fn();
  const retrieveInvoice = vi.fn();
  const retrieveSub = vi.fn();
  const cancelSub = vi.fn();

  const stripe: DisputeCancelStripe = {
    charges: { retrieve: retrieveCharge },
    invoices: { retrieve: retrieveInvoice },
    subscriptions: { retrieve: retrieveSub, cancel: cancelSub },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    retrieveCharge.mockResolvedValue(charge());
    retrieveInvoice.mockResolvedValue(invoice());
    retrieveSub.mockResolvedValue({ id: 'sub_1', status: 'active' });
    cancelSub.mockResolvedValue({ id: 'sub_1', status: 'canceled' });
  });

  it('cancels the subscription on the disputed invoice', async () => {
    const r = await cancelSubscriptionForDispute(stripe, dispute());
    expect(r).toMatchObject({
      action: 'canceled',
      subscriptionId: 'sub_1',
      chargeId: 'ch_1',
      disputeId: 'du_1',
    });
    expect(cancelSub).toHaveBeenCalledWith('sub_1', {
      cancellation_details: { comment: 'charge.dispute du_1' },
    });
  });

  it('is a no-op when the charge has no subscription (one-time / MCP top-up)', async () => {
    retrieveCharge.mockResolvedValue(charge({ invoice: null }));
    const r = await cancelSubscriptionForDispute(stripe, dispute());
    expect(r.action).toBe('no_subscription');
    expect(cancelSub).not.toHaveBeenCalled();
  });

  it('does not cancel on a retrieval inquiry', async () => {
    const r = await cancelSubscriptionForDispute(
      stripe,
      dispute({ status: 'warning_needs_response' }),
    );
    expect(r.action).toBe('skipped_inquiry');
    expect(retrieveCharge).not.toHaveBeenCalled();
    expect(cancelSub).not.toHaveBeenCalled();
  });

  it('does not cancel twice when a second dispute lands on an already-canceled sub', async () => {
    retrieveSub.mockResolvedValue({ id: 'sub_1', status: 'canceled' });
    const r = await cancelSubscriptionForDispute(stripe, dispute({ id: 'du_2' }));
    expect(r.action).toBe('already_canceled');
    expect(cancelSub).not.toHaveBeenCalled();
  });

  it('uses an expanded charge on the dispute without a second retrieve', async () => {
    const r = await cancelSubscriptionForDispute(
      stripe,
      dispute({ charge: charge({ invoice: invoice() }) as unknown as Stripe.Charge }),
    );
    expect(r.action).toBe('canceled');
    expect(retrieveCharge).not.toHaveBeenCalled();
    expect(retrieveInvoice).not.toHaveBeenCalled();
  });
});
