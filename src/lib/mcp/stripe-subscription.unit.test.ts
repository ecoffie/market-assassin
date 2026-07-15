import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./credits', () => ({ applyCreditOnce: vi.fn() }));
// Stub the Stripe client so the customer-email fallback is testable offline.
const retrieve = vi.fn();
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({ customers: { retrieve } }) }));

import { handleMcpSubscriptionInvoice } from './stripe-subscription';
import * as credits from './credits';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;

const PLUS_PRICE = 'price_1TtHCIK5zyiZ50PB6Lvi5NMo';
const SCALE_PRICE = 'price_1TtHCJK5zyiZ50PB57BKa1OW';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoice = (over: any) => ({
  id: 'in_1',
  billing_reason: 'subscription_create',
  customer_email: 'buyer@x.com',
  lines: { data: [{ price: { id: PLUS_PRICE } }] },
  ...over,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

beforeEach(() => {
  vi.clearAllMocks();
  m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: 3600 });
});

describe('handleMcpSubscriptionInvoice', () => {
  it('grants Plus annual credits on the initial charge, keyed by invoice id', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({}));
    expect(r).toMatchObject({ handled: true, applied: true, credits: 3600, email: 'buyer@x.com', plan: 'plus' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_1', 'buyer@x.com', 3600, 'mcp_sub_annual');
  });

  it('grants again on renewal (subscription_cycle) — fresh invoice id, fresh credits', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ id: 'in_2', billing_reason: 'subscription_cycle' }));
    expect(r).toMatchObject({ handled: true, plan: 'plus' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_2', 'buyer@x.com', 3600, 'mcp_sub_annual');
  });

  it('resolves Scale plan + credits from its price id', async () => {
    m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: 9600 });
    const r = await handleMcpSubscriptionInvoice(invoice({ lines: { data: [{ price: { id: SCALE_PRICE } }] } }));
    expect(r).toMatchObject({ handled: true, credits: 9600, plan: 'scale' });
  });

  it('falls back to price metadata `plan` when the price id is unrecognized', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({
      lines: { data: [{ price: { id: 'price_unknown', metadata: { plan: 'plus' } } }] },
    }));
    expect(r).toMatchObject({ handled: true, plan: 'plus', credits: 3600 });
  });

  it('ignores non-subscription invoices (billing_reason=manual) — nothing granted', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ billing_reason: 'manual' }));
    expect(r.handled).toBe(false);
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('ignores a subscription invoice whose lines map to no MCP plan', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ lines: { data: [{ price: { id: 'price_other_product' } }] } }));
    expect(r.handled).toBe(false);
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('retrieves the customer email when the invoice omits it', async () => {
    retrieve.mockResolvedValue({ email: 'FromCustomer@X.com' });
    await handleMcpSubscriptionInvoice(invoice({ customer_email: null, customer: 'cus_1' }));
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('in_1', 'fromcustomer@x.com', 3600, 'mcp_sub_annual');
  });

  it('errors cleanly (grants nothing) when no email can be resolved', async () => {
    const r = await handleMcpSubscriptionInvoice(invoice({ customer_email: null, customer: null }));
    expect(r).toMatchObject({ handled: true, plan: 'plus', error: 'no_email' });
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });
});
