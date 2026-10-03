/**
 * The TS half of ChatGPT-attributed auto-recharge suppression
 * (20261003_mcp_autorecharge_chatgpt_attribution.sql; the SQL half is proven in
 * autorecharge-chatgpt-attribution.pglite.unit.test.ts).
 *
 *   · rechargeGate() — the single rule, same truth table as SQL mcp_recharge_gate()
 *   · listRechargeCandidates() pre-filters with the gate (cron backstop)
 *   · maybeAutoRecharge() returns 'chatgpt_caused' WITHOUT claiming or calling Stripe
 *   · a read error fails CLOSED (no charge) and the cron candidate list throws
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Resp = { data: unknown; error: { message: string } | null };
const responses: Record<string, Resp> = {};
const rpc = vi.fn();

function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'not', 'limit', 'update', 'upsert']) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve(responses[`${table}:single`] ?? { data: null, error: null });
  b.then = (resolve: (r: Resp) => unknown) => resolve(responses[table] ?? { data: [], error: null });
  return b;
}
vi.mock('@/lib/supabase/server-clients', () => ({
  getWriteClient: () => ({ from: (t: string) => builder(t), rpc: (...a: unknown[]) => rpc(...a) }),
  getReadClient: () => ({ from: (t: string) => builder(t) }),
}));
const createPI = vi.fn();
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({ paymentIntents: { create: (...a: unknown[]) => createPI(...a) } }) }));
vi.mock('@/lib/stripe/resolve-customer', () => ({ getOrCreateStripeCustomerId: vi.fn() }));
vi.mock('./credit-emails', () => ({ sendCreditReceiptEmail: vi.fn() }));
vi.mock('@/lib/send-email', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
const applyCreditOnce = vi.fn();
vi.mock('./credits', () => ({ applyCreditOnce: (...a: unknown[]) => applyCreditOnce(...a), getBalance: vi.fn() }));

const { rechargeGate, listRechargeCandidates, maybeAutoRecharge } = await import('./autorecharge');

const SETTINGS = {
  user_email: 'u@x.com', enabled: true, threshold_credits: 100, refill_package: 'refill',
  stripe_customer_id: 'cus_1', stripe_payment_method_id: 'pm_1', card_brand: 'visa', card_last4: '4242',
  paused: false, consecutive_failures: 0, last_recharge_at: null,
};

beforeEach(() => {
  for (const k of Object.keys(responses)) delete responses[k];
  rpc.mockReset();
  createPI.mockReset();
  applyCreditOnce.mockReset();
});

describe('rechargeGate truth table (mirrors SQL mcp_recharge_gate)', () => {
  it.each([
    [100, 0, 100, 'sufficient'],
    [150, 999, 100, 'sufficient'],
    [99, 0, 100, 'eligible'],
    [99, 1, 100, 'chatgpt_caused'], // H == T is not eligible
    [50, 49, 100, 'eligible'],
    [0, 150, 100, 'chatgpt_caused'],
    [0, 0, 100, 'eligible'],
  ] as const)('balance=%i S=%i T=%i → %s', (b, s, t, want) => {
    expect(rechargeGate(b, s, t)).toBe(want);
  });
});

describe('listRechargeCandidates', () => {
  it('pre-filters with the gate: ChatGPT-caused and sufficient balances are excluded', async () => {
    responses.mcp_autorecharge = {
      data: [
        { user_email: 'normal@x.com', threshold_credits: 100 },
        { user_email: 'chat@x.com', threshold_credits: 100 },
        { user_email: 'rich@x.com', threshold_credits: 100 },
        { user_email: 'norow@x.com', threshold_credits: 100 },
      ],
      error: null,
    };
    responses.mcp_credit_balance = {
      data: [
        { user_email: 'normal@x.com', balance: 40, chatgpt_spend_since_recharge: 0 },
        { user_email: 'chat@x.com', balance: 40, chatgpt_spend_since_recharge: 60 },
        { user_email: 'rich@x.com', balance: 500, chatgpt_spend_since_recharge: 0 },
      ],
      error: null,
    };
    expect(await listRechargeCandidates()).toEqual(['normal@x.com', 'norow@x.com']);
  });

  it('throws on a balance read error instead of reporting zero candidates', async () => {
    responses.mcp_autorecharge = { data: [{ user_email: 'a@x.com', threshold_credits: 100 }], error: null };
    responses.mcp_credit_balance = { data: null, error: { message: 'column does not exist' } };
    await expect(listRechargeCandidates()).rejects.toThrow(/column does not exist/);
  });
});

describe('maybeAutoRecharge', () => {
  it('returns chatgpt_caused without claiming or calling Stripe', async () => {
    responses['mcp_autorecharge:single'] = { data: SETTINGS, error: null };
    responses['mcp_credit_balance:single'] = { data: { balance: 40, chatgpt_spend_since_recharge: 60 }, error: null };
    expect(await maybeAutoRecharge('u@x.com')).toEqual({ charged: false, reason: 'chatgpt_caused' });
    expect(rpc).not.toHaveBeenCalled();
    expect(createPI).not.toHaveBeenCalled();
  });

  it('returns sufficient without claiming', async () => {
    responses['mcp_autorecharge:single'] = { data: SETTINGS, error: null };
    responses['mcp_credit_balance:single'] = { data: { balance: 100, chatgpt_spend_since_recharge: 0 }, error: null };
    expect(await maybeAutoRecharge('u@x.com')).toEqual({ charged: false, reason: 'sufficient' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('eligible → claims; a SQL-side chatgpt_caused refusal (race) stops before Stripe', async () => {
    responses['mcp_autorecharge:single'] = { data: SETTINGS, error: null };
    responses['mcp_credit_balance:single'] = { data: { balance: 40, chatgpt_spend_since_recharge: 0 }, error: null };
    rpc.mockResolvedValue({ data: [{ claimed: false, reason: 'chatgpt_caused' }], error: null });
    expect(await maybeAutoRecharge('u@x.com')).toEqual({ charged: false, reason: 'chatgpt_caused' });
    expect(rpc).toHaveBeenCalledWith('mcp_autorecharge_claim', expect.objectContaining({ p_user: 'u@x.com' }));
    expect(createPI).not.toHaveBeenCalled();
  });

  it('eligible + claimed → charges and grants (behaviour unchanged for non-ChatGPT depletion)', async () => {
    responses['mcp_autorecharge:single'] = { data: SETTINGS, error: null };
    responses['mcp_credit_balance:single'] = { data: { balance: 40, chatgpt_spend_since_recharge: 10 }, error: null };
    rpc.mockResolvedValue({ data: [{ claimed: true, reason: 'ok' }], error: null });
    createPI.mockResolvedValue({ id: 'pi_1', status: 'succeeded' });
    applyCreditOnce.mockResolvedValue({ applied: true, newBalance: 1040 });
    const r = await maybeAutoRecharge('u@x.com');
    expect(r.charged).toBe(true);
    expect(applyCreditOnce).toHaveBeenCalledWith('pi_1', 'u@x.com', expect.any(Number), 'auto_recharge');
  });

  it('fails CLOSED on a balance read error (no claim, no charge)', async () => {
    responses['mcp_autorecharge:single'] = { data: SETTINGS, error: null };
    responses['mcp_credit_balance:single'] = { data: null, error: { message: 'boom' } };
    expect(await maybeAutoRecharge('u@x.com')).toEqual({ charged: false, reason: 'error' });
    expect(rpc).not.toHaveBeenCalled();
    expect(createPI).not.toHaveBeenCalled();
  });
});
