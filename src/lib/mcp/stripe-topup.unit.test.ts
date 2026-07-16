import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./credits', () => ({ applyCreditOnce: vi.fn() }));
vi.mock('./credit-emails', () => ({ sendCreditReceiptEmail: vi.fn() }));
// Stub the Stripe client so the product-metadata fallback is testable offline.
const listLineItems = vi.fn();
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({ checkout: { sessions: { listLineItems } } }) }));

import { handleMcpCreditTopup } from './stripe-topup';
import * as credits from './credits';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (fn: unknown) => fn as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const session = (over: any) => ({ id: 'cs_1', metadata: {}, ...over }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: 250 });
  listLineItems.mockResolvedValue({ data: [] }); // default: no line items
});

describe('handleMcpCreditTopup — PRODUCT metadata (Dashboard-set, the live path)', () => {
  it('reads type+package off the purchased product when the session has none', async () => {
    listLineItems.mockResolvedValue({
      data: [{ price: { product: { metadata: { type: 'mcp_credit_topup', package: 'plus' } } } }],
    });
    const r = await handleMcpCreditTopup(session({ metadata: {}, client_reference_id: 'buyer@x.com' }));
    expect(r).toMatchObject({ handled: true, applied: true, credits: 2000, email: 'buyer@x.com' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('cs_1', 'buyer@x.com', 2000, 'stripe_topup');
  });

  it('still ignores a non-MCP product (normal purchase) without granting', async () => {
    listLineItems.mockResolvedValue({ data: [{ price: { product: { metadata: { tier: 'briefings' } } } }] });
    const r = await handleMcpCreditTopup(session({ metadata: {} }));
    expect(r.handled).toBe(false);
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });
});

describe('handleMcpCreditTopup', () => {
  it('ignores non-MCP sessions (normal purchases pass through)', async () => {
    const r = await handleMcpCreditTopup(session({ metadata: { tier: 'briefings' } }));
    expect(r.handled).toBe(false);
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('grants the package credits, keyed idempotently by session id', async () => {
    const r = await handleMcpCreditTopup(session({
      id: 'cs_abc',
      metadata: { type: 'mcp_credit_topup', package: 'plus', user_email: 'U@X.com' },
    }));
    expect(r).toMatchObject({ handled: true, applied: true, credits: 2000, email: 'u@x.com' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('cs_abc', 'u@x.com', 2000, 'stripe_topup');
  });

  it('resolves email from client_reference_id when metadata lacks it', async () => {
    await handleMcpCreditTopup(session({
      metadata: { type: 'mcp_credit_topup', package: 'plus' },
      client_reference_id: 'ref@x.com',
    }));
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('cs_1', 'ref@x.com', 2000, 'stripe_topup');
  });

  it('TAMPER: unknown package grants nothing', async () => {
    const r = await handleMcpCreditTopup(session({
      metadata: { type: 'mcp_credit_topup', package: 'forged', user_email: 'u@x.com' },
    }));
    expect(r).toMatchObject({ handled: true, error: 'unknown_package' });
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('errors cleanly when no email can be resolved', async () => {
    const r = await handleMcpCreditTopup(session({ metadata: { type: 'mcp_credit_topup', package: 'plus' } }));
    expect(r).toMatchObject({ handled: true, error: 'no_email' });
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });
});
