import { describe, it, expect, vi } from 'vitest';
import { resolveStripeCustomerByEmail } from './resolve-customer';

/**
 * REGRESSION (measured 2026-07-29 across 832 live Stripe customers):
 *   109 emails (13%) have MORE THAN ONE customer record.
 *   `stripe.customers.list({ email, limit: 1 })` returns them NEWEST-FIRST, so the old code
 *   took the most recent record — which for many users is the EMPTY one created by a repeat
 *   Payment Link checkout. Verified against production: 6+ real users where the newest record
 *   had NO subscription while an older one held it. Those users were shown "no subscription"
 *   on /api/app/billing and got a billing portal with no plan in it.
 */

// Minimal Stripe stub — only the two methods the resolver touches.
function stubStripe(customers: Array<{ id: string; created: number }>, subs: Record<string, string[]>) {
  return {
    customers: {
      // Stripe returns newest-first; mirror that so the test reflects reality.
      list: vi.fn(async () => ({ data: [...customers].sort((a, b) => b.created - a.created) })),
    },
    subscriptions: {
      list: vi.fn(async ({ customer }: { customer: string }) => ({
        data: (subs[customer] || []).map((status) => ({ status })),
      })),
    },
  } as never;
}

describe('resolveStripeCustomerByEmail', () => {
  it('returns null for an email with no customers', async () => {
    const r = await resolveStripeCustomerByEmail(stubStripe([], {}), 'nobody@example.com');
    expect(r.customer).toBeNull();
    expect(r.reason).toBe('none');
  });

  it('returns null on empty input rather than querying', async () => {
    const r = await resolveStripeCustomerByEmail(stubStripe([], {}), '   ');
    expect(r.customer).toBeNull();
  });

  it('fast-paths the common single-record case', async () => {
    const r = await resolveStripeCustomerByEmail(
      stubStripe([{ id: 'cus_only', created: 100 }], {}), 'one@example.com');
    expect(r.customer!.id).toBe('cus_only');
    expect(r.all).toHaveLength(1);
  });

  it('THE BUG: picks the older record holding the ACTIVE sub, not the newest empty one', async () => {
    // Exactly the production shape: newest record created by a repeat checkout, no sub on it.
    const r = await resolveStripeCustomerByEmail(
      stubStripe(
        [{ id: 'cus_old_haspaid', created: 100 }, { id: 'cus_new_empty', created: 999 }],
        { cus_old_haspaid: ['active'] },
      ),
      'dup@example.com',
    );
    expect(r.customer!.id).toBe('cus_old_haspaid');
    expect(r.reason).toBe('active-sub');
    // The old `limit: 1` would have returned cus_new_empty (newest).
    expect(r.customer!.id).not.toBe('cus_new_empty');
  });

  it('treats trialing as live, not just active', async () => {
    const r = await resolveStripeCustomerByEmail(
      stubStripe(
        [{ id: 'cus_a', created: 100 }, { id: 'cus_trial', created: 50 }],
        { cus_trial: ['trialing'] },
      ),
      'dup@example.com',
    );
    expect(r.customer!.id).toBe('cus_trial');
    expect(r.reason).toBe('active-sub');
  });

  it('prefers an ACTIVE sub over a canceled one even if the canceled record is newer', async () => {
    const r = await resolveStripeCustomerByEmail(
      stubStripe(
        [{ id: 'cus_canceled', created: 900 }, { id: 'cus_active', created: 100 }],
        { cus_canceled: ['canceled'], cus_active: ['active'] },
      ),
      'dup@example.com',
    );
    expect(r.customer!.id).toBe('cus_active');
    expect(r.reason).toBe('active-sub');
  });

  it('falls back to ANY subscription when none are live — history still beats an empty record', async () => {
    const r = await resolveStripeCustomerByEmail(
      stubStripe(
        [{ id: 'cus_empty_new', created: 999 }, { id: 'cus_canceled', created: 100 }],
        { cus_canceled: ['canceled'] },
      ),
      'dup@example.com',
    );
    expect(r.customer!.id).toBe('cus_canceled');
    expect(r.reason).toBe('any-sub');
  });

  it('falls back to the OLDEST record when nothing has a subscription — deterministic, not newest', async () => {
    const r = await resolveStripeCustomerByEmail(
      stubStripe([{ id: 'cus_new', created: 999 }, { id: 'cus_original', created: 100 }], {}),
      'dup@example.com',
    );
    expect(r.customer!.id).toBe('cus_original');
    expect(r.reason).toBe('oldest');
  });

  it('never requests limit:1 — the whole point is seeing the duplicates', async () => {
    const s = stubStripe([{ id: 'cus_a', created: 1 }], {});
    await resolveStripeCustomerByEmail(s, 'x@example.com');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (s as any).customers.list.mock.calls[0][0];
    expect(arg.limit).toBe(100);
    expect(arg.email).toBe('x@example.com');
  });

  it('normalizes the email before lookup', async () => {
    const s = stubStripe([{ id: 'cus_a', created: 1 }], {});
    await resolveStripeCustomerByEmail(s, '  MixedCase@Example.COM  ');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((s as any).customers.list.mock.calls[0][0].email).toBe('mixedcase@example.com');
  });

  it('exposes every duplicate record so callers can surface/diagnose the dup', async () => {
    const r = await resolveStripeCustomerByEmail(
      stubStripe(
        [{ id: 'cus_a', created: 1 }, { id: 'cus_b', created: 2 }, { id: 'cus_c', created: 3 }],
        { cus_a: ['active'] },
      ),
      'dup@example.com',
    );
    expect(r.all).toHaveLength(3);
  });
});
