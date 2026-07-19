import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./credits', () => ({ applyCreditOnce: vi.fn() }));
vi.mock('./credit-emails', () => ({ sendCreditReceiptEmail: vi.fn() }));
// Stub the Stripe client so the customer-email fallback is testable offline.
const retrieve = vi.fn();
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({ customers: { retrieve } }) }));

import { handleMcpSubscriptionInvoice } from './stripe-subscription';
import * as credits from './credits';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;

// Real price ids from SUBSCRIPTION_PLANS (packages.ts). GOS #015 ladder: Entry $99/500,
// Mid $249/1,500, Agency $999/8,000 — MONTHLY ONLY (annual deferred). The old $59 Starter
// + $19 Plus subs were archived 2026-07-19.
const ENTRY_MONTHLY = 'price_1TuxApK5zyiZ50PB8iMg8WqG';
const MID_MONTHLY = 'price_1TuxApK5zyiZ50PBPV40eCvG';
const ENTRY_CR = 500;
const MID_CR = 1500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoice = (over: any) => ({
  id: 'in_1',
  billing_reason: 'subscription_create',
  customer_email: 'buyer@x.com',
  lines: { data: [{ price: { id: ENTRY_MONTHLY } }] },
  ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: ENTRY_CR });
});

describe('handleMcpSubscriptionInvoice', () => {
  it('grants a month of Entry credits on the monthly invoice, keyed by invoice id', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({}));
    expect(r).toMatchObject({ handled: true, applied: true, credits: ENTRY_CR, email: 'buyer@x.com', plan: 'entry', interval: 'month' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_1', 'buyer@x.com', ENTRY_CR, 'mcp_sub_monthly');
  });

  it('grants the correct allowance for a different tier (Mid = 1,500)', async () => {
    m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: MID_CR });
    const r = await handleMcpSubscriptionInvoice(invoice({ lines: { data: [{ price: { id: MID_MONTHLY } }] } }));
    expect(r).toMatchObject({ handled: true, credits: MID_CR, plan: 'mid', interval: 'month' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_1', 'buyer@x.com', MID_CR, 'mcp_sub_monthly');
  });

  it('grants again on renewal (subscription_cycle) — fresh invoice id, fresh credits', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ id: 'in_2', billing_reason: 'subscription_cycle' }));
    expect(r).toMatchObject({ handled: true, plan: 'entry', interval: 'month' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_2', 'buyer@x.com', ENTRY_CR, 'mcp_sub_monthly');
  });

  it('falls back to price metadata plan+interval when the price id is unrecognized', async () => {
    m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: ENTRY_CR });
    const r = await handleMcpSubscriptionInvoice(invoice({
      lines: { data: [{ price: { id: 'price_unknown', metadata: { plan: 'entry', interval: 'month' } } }] },
    }));
    expect(r).toMatchObject({ handled: true, plan: 'entry', interval: 'month', credits: ENTRY_CR });
  });

  it('ignores non-subscription invoices (billing_reason=manual) — nothing granted', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ billing_reason: 'manual' }));
    expect(r.handled).toBe(false);
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('ignores a subscription invoice whose lines map to no MCP plan (incl. the retired Starter/Plus prices)', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ lines: { data: [{ price: { id: 'price_other_product' } }] } }));
    expect(r.handled).toBe(false);
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('retrieves the customer email when the invoice omits it', async () => {
    retrieve.mockResolvedValue({ email: 'FromCustomer@X.com' });
    await handleMcpSubscriptionInvoice(invoice({ customer_email: null, customer: 'cus_1' }));
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_1', 'fromcustomer@x.com', ENTRY_CR, 'mcp_sub_monthly');
  });

  it('errors cleanly (grants nothing) when no email can be resolved', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ customer_email: null, customer: null }));
    expect(r).toMatchObject({ handled: true, plan: 'entry', error: 'no_email' });
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });
});
