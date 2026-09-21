import { describe, it, expect, vi } from 'vitest';
import { findUnonboardedPayers, formatUnonboarded } from './unonboarded-payers';

/** Minimal Supabase stub — only the paged select this module makes. */
function stub(tables: Record<string, unknown[]>, failOn?: string) {
  return {
    from(table: string) {
      return {
        select: () => ({
          range: (from: number) => {
            if (table === failOn) return Promise.resolve({ data: null, error: { message: 'boom' } });
            return Promise.resolve({ data: from === 0 ? (tables[table] ?? []) : [], error: null });
          },
        }),
      };
    },
  } as never;
}

const buy = (email: string, amount: number, product = 'Mindy Ai', created = '2026-06-27T00:00:00Z') =>
  ({ user_email: email, amount_paid: amount, product_name: product, created_at: created, superseded_by: null,
     stripe_customer_id: `cus_${email}` });

/** An ACTIVE subscription for that buyer — required now that the detector is scoped to
 *  subscribers. Without one, the customer is a one-time buyer and is never flagged. */
const sub = (email: string, status = 'active') => ({ customer_id: `cus_${email}`, status });

describe('findUnonboardedPayers', () => {
  it('flags a payer with NO notification settings row', async () => {
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [sub('a@b.com')],
      purchases: [buy('a@b.com', 299700)],
      user_notification_settings: [],
      user_profiles: [{ email: 'a@b.com' }],
      mcp_credit_balance: [{ user_email: 'a@b.com', balance: 200 }],
    }));
    expect(r.payers).toHaveLength(1);
    expect(r.payers[0].needs).toBe('both');
    expect(r.payers[0].hasSettings).toBe(false);
    expect(r.payers[0].creditBalance).toBe(200);
    // The credits are what made the account LOOK provisioned.
    expect(formatUnonboarded(r.payers)).toContain('a grant alone does nothing');
  });

  it('flags a reachable payer who has zero targeting', async () => {
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [sub('c@d.com')],
      purchases: [buy('c@d.com', 14900)],
      user_notification_settings: [{ user_email: 'c@d.com', naics_codes: [], keywords: [], agencies: [] }],
      user_profiles: [], mcp_credit_balance: [],
    }));
    expect(r.payers[0].needs).toBe('targeting');
    expect(formatUnonboarded(r.payers)).toContain('would be generic');
  });

  it('IGNORES a one-time buyer with no subscription (the 2026-08-19 false alarm)', async () => {
    // 38 "stranded customers / $34,855" were mostly one-time product buyers — Product
    // Supplier Program, Consultant Meeting, database downloads. None entitled to Mindy,
    // so an empty settings row is CORRECT for them, not a fault.
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [],
      purchases: [buy('onetime@b.com', 99700, 'Product Supplier Program')],
      user_notification_settings: [],
      user_profiles: [], mcp_credit_balance: [],
    }));
    expect(r.payers).toHaveLength(0);
  });

  it('IGNORES a customer whose subscription was cancelled', async () => {
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [sub('gone@b.com', 'canceled')],
      purchases: [buy('gone@b.com', 299700)],
      user_notification_settings: [],
      user_profiles: [], mcp_credit_balance: [],
    }));
    expect(r.payers).toHaveLength(0);
  });

  it('FLAGS a past_due subscriber — still owed delivery', async () => {
    // Deliberate: the subscription has not ended, so staying silent would compound a
    // billing problem with a service one.
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [sub('late@b.com', 'past_due')],
      purchases: [buy('late@b.com', 299700)],
      user_notification_settings: [],
      user_profiles: [], mcp_credit_balance: [],
    }));
    expect(r.payers).toHaveLength(1);
    expect(r.payers[0].email).toBe('late@b.com');
  });

  it('FLAGS a trialing subscriber', async () => {
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [sub('trial@b.com', 'trialing')],
      purchases: [buy('trial@b.com', 299700)],
      user_notification_settings: [],
      user_profiles: [], mcp_credit_balance: [],
    }));
    expect(r.payers).toHaveLength(1);
  });

  it('reports only the SUBSCRIBER when a one-time buyer sits alongside one', async () => {
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [sub('subbed@b.com')],
      purchases: [buy('subbed@b.com', 299700), buy('onetime@b.com', 99700, 'Consultant Meeting')],
      user_notification_settings: [],
      user_profiles: [], mcp_credit_balance: [],
    }));
    expect(r.payers.map((p) => p.email)).toEqual(['subbed@b.com']);
  });

  it('does NOT flag a fully wired-up customer', async () => {
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [sub('ok@x.com')],
      purchases: [buy('ok@x.com', 14900)],
      user_notification_settings: [{ user_email: 'ok@x.com', naics_codes: ['541512'], keywords: [], agencies: [] }],
      user_profiles: [], mcp_credit_balance: [],
    }));
    expect(r.payers).toHaveLength(0);
    expect(r.checked).toBe(1);
  });

  it('ignores test charges below the floor', async () => {
    // Values under 1000 are read as DOLLARS (every real product here is >= $10),
    // so 49 = $49 and 5 = $5 — both under the $99 floor.
    //
    // NOTE 149 is deliberately NOT in this list: it is the real Mindy Ai price in
    // dollars, and an earlier version of this test wrongly asserted it was a
    // $1.49 fee line. Ambiguous low values are resolved by taking the MAX charge
    // per customer, not by blocklisting amounts — see asCents().
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [sub('tiny@x.com'), sub('tiny2@x.com')],
      purchases: [buy('tiny@x.com', 49), buy('tiny2@x.com', 5)],
      user_notification_settings: [], user_profiles: [], mcp_credit_balance: [],
    }));
    expect(r.payers).toHaveLength(0);
  });

  it('a fee line never beats the real charge it accompanies', async () => {
    // The two webhooks write the same purchase twice, and Stripe adds fee lines.
    // 1490 is ambiguous alone ($14.90 in cents OR $1,490 in dollars) — resolved
    // by taking the MAX per customer rather than guessing per value.
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [sub('real@x.com')],
      purchases: [buy('real@x.com', 1490), buy('real@x.com', 149000)],
      user_notification_settings: [], user_profiles: [], mcp_credit_balance: [],
    }));
    expect(r.payers).toHaveLength(1);
    expect(r.payers[0].paidCents).toBe(149000); // the real $1,490 charge
  });

  it('skips superseded duplicate rows so a customer is not counted twice', async () => {
    // The two webhooks wrote the same purchase in dollars AND cents.
    const dup = { ...buy('dup@x.com', 14900), superseded_by: 'some-uuid' };
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [sub('dup@x.com')],
      purchases: [buy('dup@x.com', 149), dup],
      user_notification_settings: [], user_profiles: [], mcp_credit_balance: [],
    }));
    expect(r.payers).toHaveLength(1);
    expect(r.payers[0].paidCents).toBe(14900); // dollars normalized, not doubled
  });

  it('ranks by spend — the biggest account is the one to call', async () => {
    const r = await findUnonboardedPayers(stub({
      stripe_subscriptions: [sub('small@x.com'), sub('big@x.com')],
      purchases: [buy('small@x.com', 14900), buy('big@x.com', 600000)],
      user_notification_settings: [], user_profiles: [], mcp_credit_balance: [],
    }));
    expect(r.payers.map((p) => p.email)).toEqual(['big@x.com', 'small@x.com']);
  });

  it('reports the read error instead of claiming nobody is stranded', async () => {
    const r = await findUnonboardedPayers(stub({ purchases: [] }, 'purchases'));
    expect(r.error).toBeTruthy();
    expect(r.payers).toHaveLength(0);
  });
});
