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

// Real price ids from SUBSCRIPTION_PLANS (packages.ts). The only MCP-native sub is
// STARTER (id 'scale', $59/mo · $590/yr); the $19 'Plus' sub was retired 2026-07-16.
const STARTER_MONTHLY = 'price_1TtpH5K5zyiZ50PBN6wo4IAs';
const STARTER_ANNUAL = 'price_1TtpHiK5zyiZ50PBcGOuLfnR';
// Credit allowance: 2,400/mo → 28,800/yr (SCALE_CR_MO default).
const CR_MONTH = 2400;
const CR_YEAR = 28800;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoice = (over: any) => ({
  id: 'in_1',
  billing_reason: 'subscription_create',
  customer_email: 'buyer@x.com',
  lines: { data: [{ price: { id: STARTER_ANNUAL } }] },
  ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: CR_YEAR });
});

describe('handleMcpSubscriptionInvoice', () => {
  it('grants a full year of Starter credits on the annual invoice, keyed by invoice id', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({}));
    expect(r).toMatchObject({ handled: true, applied: true, credits: CR_YEAR, email: 'buyer@x.com', plan: 'scale', interval: 'year' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_1', 'buyer@x.com', CR_YEAR, 'mcp_sub_annual');
  });

  it('grants ONE month of Starter credits on the monthly invoice', async () => {
    m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: CR_MONTH });
    const r = await handleMcpSubscriptionInvoice(invoice({ lines: { data: [{ price: { id: STARTER_MONTHLY } }] } }));
    expect(r).toMatchObject({ handled: true, credits: CR_MONTH, plan: 'scale', interval: 'month' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_1', 'buyer@x.com', CR_MONTH, 'mcp_sub_monthly');
  });

  it('grants again on renewal (subscription_cycle) — fresh invoice id, fresh credits', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ id: 'in_2', billing_reason: 'subscription_cycle' }));
    expect(r).toMatchObject({ handled: true, plan: 'scale', interval: 'year' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_2', 'buyer@x.com', CR_YEAR, 'mcp_sub_annual');
  });

  it('falls back to price metadata plan+interval when the price id is unrecognized', async () => {
    m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: CR_MONTH });
    const r = await handleMcpSubscriptionInvoice(invoice({
      lines: { data: [{ price: { id: 'price_unknown', metadata: { plan: 'scale', interval: 'month' } } }] },
    }));
    expect(r).toMatchObject({ handled: true, plan: 'scale', interval: 'month', credits: CR_MONTH });
  });

  it('ignores non-subscription invoices (billing_reason=manual) — nothing granted', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ billing_reason: 'manual' }));
    expect(r.handled).toBe(false);
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('ignores a subscription invoice whose lines map to no MCP plan (incl. the retired Plus prices)', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ lines: { data: [{ price: { id: 'price_other_product' } }] } }));
    expect(r.handled).toBe(false);
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('retrieves the customer email when the invoice omits it', async () => {
    retrieve.mockResolvedValue({ email: 'FromCustomer@X.com' });
    await handleMcpSubscriptionInvoice(invoice({ customer_email: null, customer: 'cus_1' }));
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_1', 'fromcustomer@x.com', CR_YEAR, 'mcp_sub_annual');
  });

  it('errors cleanly (grants nothing) when no email can be resolved', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ customer_email: null, customer: null }));
    expect(r).toMatchObject({ handled: true, plan: 'scale', error: 'no_email' });
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });
});
