/**
 * Admin: Stripe Customer Lookup
 *
 * GET /api/admin/stripe-lookup?password=...&email=user@example.com
 *   → Customer info, all payments, active subscriptions, payment link metadata
 *
 * GET /api/admin/stripe-lookup?password=...&customer=cus_xxx
 *   → Lookup by Stripe customer ID
 *
 * Replaces manual Stripe dashboard lookups for support.
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-01-27.acacia' as Stripe.LatestApiVersion,
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();
  const customerId = searchParams.get('customer');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email && !customerId) {
    return NextResponse.json({
      usage: {
        byEmail: '?email=user@example.com',
        byCustomer: '?customer=cus_xxx',
      },
    });
  }

  try {
    // Find customer
    let customer: Stripe.Customer | null = null;

    if (customerId) {
      const c = await stripe.customers.retrieve(customerId);
      if (!c.deleted) customer = c as Stripe.Customer;
    } else if (email) {
      const customers = await stripe.customers.list({ email, limit: 1 });
      customer = customers.data[0] || null;
    }

    if (!customer) {
      return NextResponse.json({
        found: false,
        email: email || customerId,
        message: 'No Stripe customer found',
      });
    }

    // Get all checkout sessions (payments)
    const sessions = await stripe.checkout.sessions.list({
      customer: customer.id,
      limit: 20,
      expand: ['data.line_items'],
    });

    const payments = sessions.data.map(s => ({
      id: s.id,
      status: s.payment_status,
      amount: s.amount_total ? (s.amount_total / 100).toFixed(2) : null,
      currency: s.currency,
      created: new Date(s.created * 1000).toISOString(),
      metadata: s.metadata,
      mode: s.mode,
      lineItems: s.line_items?.data.map(li => ({
        description: li.description,
        amount: li.amount_total ? (li.amount_total / 100).toFixed(2) : null,
        productId: li.price?.product,
      })),
    }));

    // Get active subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      limit: 10,
    });

    const subs = subscriptions.data.map(s => ({
      id: s.id,
      status: s.status,
      currentPeriodEnd: new Date(s.current_period_end * 1000).toISOString(),
      cancelAtPeriodEnd: s.cancel_at_period_end,
      plan: s.items.data[0]?.price?.id,
      productId: s.items.data[0]?.price?.product,
      metadata: s.metadata,
    }));

    // Get charges (for refund status)
    const charges = await stripe.charges.list({
      customer: customer.id,
      limit: 20,
    });

    const chargeList = charges.data.map(c => ({
      id: c.id,
      amount: (c.amount / 100).toFixed(2),
      status: c.status,
      refunded: c.refunded,
      refundAmount: c.amount_refunded ? (c.amount_refunded / 100).toFixed(2) : '0',
      created: new Date(c.created * 1000).toISOString(),
      description: c.description,
    }));

    return NextResponse.json({
      found: true,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        created: new Date(customer.created * 1000).toISOString(),
        metadata: customer.metadata,
      },
      payments,
      subscriptions: subs,
      charges: chargeList,
      summary: {
        totalPayments: payments.length,
        totalPaid: payments
          .filter(p => p.status === 'paid')
          .reduce((sum, p) => sum + parseFloat(p.amount || '0'), 0)
          .toFixed(2),
        activeSubscriptions: subs.filter(s => s.status === 'active').length,
        hasRefunds: chargeList.some(c => c.refunded),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
