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
// Default to a genuinely PAID session — the only state that may grant credits. These
// fixtures previously omitted payment_status entirely, i.e. they modelled a session we
// cannot prove was paid and asserted that it granted. Overridable per test.
const session = (over: any) => ({ id: 'cs_1', metadata: {}, payment_status: 'paid', ...over }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  m(credits.applyCreditOnce).mockResolvedValue({ applied: true, newBalance: 250 });
  listLineItems.mockResolvedValue({ data: [] }); // default: no line items
});

describe('handleMcpCreditTopup — PRODUCT metadata (Dashboard-set, the live path)', () => {
  it('reads type+package off the purchased product when the session has none', async () => {
    listLineItems.mockResolvedValue({
      data: [{ price: { product: { metadata: { type: 'mcp_credit_topup', package: 'refill' } } } }],
    });
    const r = await handleMcpCreditTopup(session({ metadata: {}, client_reference_id: 'buyer@x.com' }));
    expect(r).toMatchObject({ handled: true, applied: true, credits: 500, email: 'buyer@x.com' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('cs_1', 'buyer@x.com', 500, 'stripe_topup');
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
      payment_status: 'paid',
      metadata: { type: 'mcp_credit_topup', package: 'refill', user_email: 'U@X.com' },
    }));
    expect(r).toMatchObject({ handled: true, applied: true, credits: 500, email: 'u@x.com' });
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('cs_abc', 'u@x.com', 500, 'stripe_topup');
  });

  it('resolves email from client_reference_id when metadata lacks it', async () => {
    await handleMcpCreditTopup(session({
      metadata: { type: 'mcp_credit_topup', package: 'refill' },
      client_reference_id: 'ref@x.com',
    }));
    expect(credits.applyCreditOnce).toHaveBeenCalledWith('cs_1', 'ref@x.com', 500, 'stripe_topup');
  });

  it('TAMPER: unknown package grants nothing', async () => {
    const r = await handleMcpCreditTopup(session({
      metadata: { type: 'mcp_credit_topup', package: 'forged', user_email: 'u@x.com' },
    }));
    expect(r).toMatchObject({ handled: true, error: 'unknown_package' });
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });

  it('errors cleanly when no email can be resolved', async () => {
    const r = await handleMcpCreditTopup(session({ metadata: { type: 'mcp_credit_topup', package: 'refill' } }));
    expect(r).toMatchObject({ handled: true, error: 'no_email' });
    expect(credits.applyCreditOnce).not.toHaveBeenCalled();
  });
});

describe('payment_status gate — completion is not payment', () => {
  /**
   * checkout.session.completed fires when the SESSION finishes, which is not the same as
   * money arriving. Delayed payment methods complete with payment_status 'unpaid' and
   * settle (or FAIL) later; mode:'setup' sessions complete with no payment at all.
   * Granting on completion alone hands out credits for an unpaid session.
   */
  const base = {
    id: 'cs_test_gate',
    metadata: { type: 'mcp_credit_topup', package: 'refill', user_email: 'x@y.com' },
  } as never;

  it('REFUSES to grant when payment_status is unpaid', async () => {
    const { handleMcpCreditTopup } = await import('./stripe-topup');
    const out = await handleMcpCreditTopup({ ...(base as object), payment_status: 'unpaid' } as never);
    expect(out.handled).toBe(true);
    expect(out.applied).toBeUndefined();
    expect(String(out.error)).toContain('unpaid');
  });

  it('REFUSES when payment_status is missing entirely', async () => {
    const { handleMcpCreditTopup } = await import('./stripe-topup');
    const out = await handleMcpCreditTopup({ ...(base as object) } as never);
    expect(out.handled).toBe(true);
    expect(String(out.error)).toContain('unpaid');
  });

  it("REJECTS mode:'setup' outright — it collects a card, it is not a purchase", async () => {
    const { handleMcpCreditTopup } = await import('./stripe-topup');
    const out = await handleMcpCreditTopup({ ...(base as object), mode: 'setup', payment_status: 'paid' } as never);
    expect(out.handled).toBe(true);
    expect(String(out.error)).toContain('ineligible_mode');
  });

  it("treats no_payment_required as a ZERO-DOLLAR entitlement, not as 'paid'", async () => {
    const { handleMcpCreditTopup } = await import('./stripe-topup');
    // Genuine 100% discount: zero total → allowed.
    const ok = await handleMcpCreditTopup({
      ...(base as object), mode: 'payment', payment_status: 'no_payment_required', amount_total: 0,
    } as never);
    expect(String(ok.error ?? '')).not.toContain('inconsistent');
    // Contradiction: claims nothing owed while carrying a real total → refused.
    const bad = await handleMcpCreditTopup({
      ...(base as object), mode: 'payment', payment_status: 'no_payment_required', amount_total: 11900,
    } as never);
    expect(String(bad.error)).toContain('inconsistent_zero_dollar');
  });

  it('the unpaid refusal is not a dead end — async_payment_succeeded routes back here', async () => {
    // Guard on the CONTRACT, not the wiring: the refusal is only safe because the
    // follow-up event grants later, keyed on session.id so it applies exactly once.
    const { handleMcpCreditTopup } = await import('./stripe-topup');
    const first = await handleMcpCreditTopup({ ...(base as object), mode: 'payment', payment_status: 'unpaid' } as never);
    expect(String(first.error)).toContain('unpaid');
    const settled = await handleMcpCreditTopup({ ...(base as object), mode: 'payment', payment_status: 'paid' } as never);
    expect(settled.handled).toBe(true);
    expect(String(settled.error ?? '')).not.toContain('unpaid');
  });
});
