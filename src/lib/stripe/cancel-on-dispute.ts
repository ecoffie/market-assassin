import type Stripe from 'stripe';

/**
 * First chargeback on a subscription invoice cancels that subscription.
 *
 * Jesse Forte (Sep 2026) disputed three $149 renewals while sub_… stayed
 * active — Stripe would have charged a fourth on Oct 2. One customer is not
 * a product emergency; leaving the meter running after Discover pulls the
 * money is how one dispute becomes three.
 *
 * Scope is the subscription on THIS charge's invoice, not every sub on the
 * customer (a Mindy Pro dispute must not cancel an MCP scale sub).
 * Inquiries (`warning_*`) are not chargebacks — leave those alone.
 *
 * Access revoke is left to `customer.subscription.deleted` (already wired).
 */

export type DisputeCancelStripe = {
  charges: { retrieve: (id: string) => Promise<Stripe.Charge> };
  invoices: { retrieve: (id: string) => Promise<Stripe.Invoice> };
  subscriptions: {
    retrieve: (id: string) => Promise<Stripe.Subscription>;
    cancel: (
      id: string,
      params?: Stripe.SubscriptionCancelParams,
    ) => Promise<Stripe.Subscription>;
  };
};

export type CancelOnDisputeResult = {
  handled: true;
  action:
    | 'canceled'
    | 'already_canceled'
    | 'no_subscription'
    | 'skipped_inquiry';
  disputeId: string;
  chargeId: string | null;
  subscriptionId: string | null;
};

const INQUIRY_STATUSES = new Set([
  'warning_needs_response',
  'warning_closed',
  'warning_under_review',
]);

export function isInquiryDispute(dispute: Stripe.Dispute): boolean {
  if (INQUIRY_STATUSES.has(dispute.status)) return true;
  const caseType = dispute.payment_method_details?.card?.case_type;
  return caseType === 'inquiry';
}

export function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as { subscription?: unknown }).subscription;
  const fromLegacy = asSubId(legacy);
  if (fromLegacy) return fromLegacy;

  const parent = (invoice as {
    parent?: { subscription_details?: { subscription?: unknown } } | null;
  }).parent;
  const fromParent = asSubId(parent?.subscription_details?.subscription);
  if (fromParent) return fromParent;

  for (const line of invoice.lines?.data || []) {
    const lineSub = asSubId((line as { subscription?: unknown }).subscription);
    if (lineSub) return lineSub;
    const lineParent = asSubId(
      (line as { parent?: { subscription_item_details?: { subscription?: unknown } } })
        .parent?.subscription_item_details?.subscription,
    );
    if (lineParent) return lineParent;
  }
  return null;
}

function asSubId(value: unknown): string | null {
  if (typeof value === 'string' && value.startsWith('sub_')) return value;
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id;
    if (typeof id === 'string' && id.startsWith('sub_')) return id;
  }
  return null;
}

function chargeIdOf(dispute: Stripe.Dispute): string | null {
  const charge = dispute.charge;
  if (typeof charge === 'string' && charge.startsWith('ch_')) return charge;
  if (charge && typeof charge === 'object' && 'id' in charge) {
    const id = (charge as { id: string }).id;
    if (typeof id === 'string' && id.startsWith('ch_')) return id;
  }
  return null;
}

function invoiceIdOf(charge: Stripe.Charge): string | null {
  const invoice = charge.invoice;
  if (typeof invoice === 'string' && invoice.startsWith('in_')) return invoice;
  if (invoice && typeof invoice === 'object' && 'id' in invoice) {
    const id = (invoice as { id: string }).id;
    if (typeof id === 'string' && id.startsWith('in_')) return id;
  }
  return null;
}

async function resolveCharge(
  stripe: DisputeCancelStripe,
  dispute: Stripe.Dispute,
): Promise<Stripe.Charge | null> {
  if (dispute.charge && typeof dispute.charge === 'object' && 'id' in dispute.charge) {
    return dispute.charge as Stripe.Charge;
  }
  const id = chargeIdOf(dispute);
  if (!id) return null;
  return stripe.charges.retrieve(id);
}

export async function cancelSubscriptionForDispute(
  stripe: DisputeCancelStripe,
  dispute: Stripe.Dispute,
): Promise<CancelOnDisputeResult> {
  const disputeId = dispute.id;
  const chargeId = chargeIdOf(dispute);

  if (isInquiryDispute(dispute)) {
    return {
      handled: true,
      action: 'skipped_inquiry',
      disputeId,
      chargeId,
      subscriptionId: null,
    };
  }

  const charge = await resolveCharge(stripe, dispute);
  if (!charge) {
    return {
      handled: true,
      action: 'no_subscription',
      disputeId,
      chargeId,
      subscriptionId: null,
    };
  }

  let subscriptionId: string | null = null;
  if (charge.invoice && typeof charge.invoice === 'object') {
    subscriptionId = subscriptionIdFromInvoice(charge.invoice as Stripe.Invoice);
  }
  if (!subscriptionId) {
    const invoiceId = invoiceIdOf(charge);
    if (invoiceId) {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      subscriptionId = subscriptionIdFromInvoice(invoice);
    }
  }

  if (!subscriptionId) {
    return {
      handled: true,
      action: 'no_subscription',
      disputeId,
      chargeId: charge.id,
      subscriptionId: null,
    };
  }

  const existing = await stripe.subscriptions.retrieve(subscriptionId);
  if (existing.status === 'canceled' || existing.status === 'incomplete_expired') {
    return {
      handled: true,
      action: 'already_canceled',
      disputeId,
      chargeId: charge.id,
      subscriptionId,
    };
  }

  await stripe.subscriptions.cancel(subscriptionId, {
    cancellation_details: {
      comment: `charge.dispute ${disputeId}`,
    },
  });

  console.log(
    `[stripe] canceled ${subscriptionId} after dispute ${disputeId} on ${charge.id}`,
  );

  return {
    handled: true,
    action: 'canceled',
    disputeId,
    chargeId: charge.id,
    subscriptionId,
  };
}
