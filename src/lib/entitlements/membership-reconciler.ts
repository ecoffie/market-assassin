/**
 * R2 — $99 membership SOURCE reconciler (shadow evidence only).
 *
 * Ruling 2026-10-03: an ACTIVE qualifying $99 membership is a Mindy Pro source (app only,
 * no MCP credits) that ENDS when the membership ends. This module observes that fact from
 * live Stripe subscription state and records it in `entitlement_source_observations`, the
 * table only the canonical resolver reads. It grants NOTHING: no KV key, no profile flag,
 * no email, no Stripe write. R3 decides whether a gate ever reads it.
 *
 * WHY STRIPE, NOT customer_classifications: the classification table is a 2026-05 snapshot
 * (products_purchased usually empty) and cannot say who is a member TODAY.
 *
 * WHY PRODUCT IDS, NOT NAMES: the Stripe account sells ~15 "PRO Member …" products
 * (lifetime, accelerator, installments, one-time). Only two are the ruled $99 monthly plan.
 *
 * Safety:
 *   - A sweep that errors anywhere writes NOTHING (no partial picture, no false "ended").
 *   - An observation is ended only when a COMPLETE sweep no longer sees it.
 *   - Dry run by default.
 */
import Stripe from 'stripe';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Ruled qualifying (2026-10-03): the $99/mo Pro Member plan under both product names. */
export const QUALIFYING_MEMBERSHIP_PRODUCTS: Readonly<Record<string, string>> = {
  prod_TaiXlKb350EIQs: 'Copy of PRO Member Group - Monthly',
  prod_TMUmxKTtooTx6C: 'Pro Member Plan - Monthly',
};

/** Observed, NOT granting — each awaits an explicit ruling (commercial-actions-packet §3). */
export const UNRULED_MEMBERSHIP_PRODUCTS: Readonly<Record<string, string>> = {
  prod_TaiXme4nmh2QLc: 'Copy of PRO Member Group - Annual ($799/yr)',
  prod_TEEWMTb5ngGx0f: 'Ongoing Coaching - Monthly',
  prod_TPVg3YGHuYHE08: 'Pro Member Group (Free Trial) - Monthly',
};

export interface ObservedSub {
  subscriptionId: string;
  productId: string;
  stripeStatus: string;
  email: string | null;
}

export interface Observation {
  email: string;
  source: 'membership' | 'membership_unruled';
  evidence_key: string;
  status: 'active' | 'past_due';
  evidence: { subscription_id: string; product_id: string; product: string; stripe_status: string };
}

/** Stripe status → observation status. Anything else (canceled, incomplete…) is "not a member now". */
function observedStatus(stripeStatus: string): 'active' | 'past_due' | null {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'past_due';
  return null;
}

/** Pure: subscriptions → observations, plus what could not be attributed. */
export function classifyMembershipSubs(subs: ObservedSub[]): { observations: Observation[]; missingEmail: number } {
  const observations: Observation[] = [];
  let missingEmail = 0;
  for (const s of subs) {
    const status = observedStatus(s.stripeStatus);
    if (!status) continue;
    const qualifying = s.productId in QUALIFYING_MEMBERSHIP_PRODUCTS;
    const unruled = s.productId in UNRULED_MEMBERSHIP_PRODUCTS;
    if (!qualifying && !unruled) continue;
    const email = (s.email || '').toLowerCase().trim();
    if (!email) { missingEmail++; continue; }
    observations.push({
      email,
      source: qualifying ? 'membership' : 'membership_unruled',
      evidence_key: s.subscriptionId,
      status,
      evidence: {
        subscription_id: s.subscriptionId,
        product_id: s.productId,
        product: QUALIFYING_MEMBERSHIP_PRODUCTS[s.productId] ?? UNRULED_MEMBERSHIP_PRODUCTS[s.productId],
        stripe_status: s.stripeStatus,
      },
    });
  }
  return { observations, missingEmail };
}

/** Read-only Stripe sweep over every price of every watched product. Throws on any error. */
export async function fetchMembershipSubs(stripe: Stripe): Promise<ObservedSub[]> {
  const productIds = [...Object.keys(QUALIFYING_MEMBERSHIP_PRODUCTS), ...Object.keys(UNRULED_MEMBERSHIP_PRODUCTS)];
  const out = new Map<string, ObservedSub>();
  for (const product of productIds) {
    for await (const price of stripe.prices.list({ product, limit: 100 })) {
      for await (const sub of stripe.subscriptions.list({ price: price.id, status: 'all', limit: 100, expand: ['data.customer'] })) {
        const customer = sub.customer as Stripe.Customer | Stripe.DeletedCustomer | string;
        const email = typeof customer === 'object' && !('deleted' in customer && customer.deleted)
          ? (customer as Stripe.Customer).email : null;
        out.set(sub.id, { subscriptionId: sub.id, productId: product, stripeStatus: sub.status, email });
      }
    }
  }
  return [...out.values()];
}

export interface ReconcilePlan {
  observed: number;
  missingEmail: number;
  upsert: Observation[];
  end: Array<{ source: string; evidence_key: string }>;
  bySourceStatus: Record<string, number>;
}

/** Pure: compare observations with the currently-open rows. */
export function planReconcile(
  observations: Observation[],
  open: Array<{ source: string; evidence_key: string }>,
  missingEmail: number,
): ReconcilePlan {
  const seen = new Set(observations.map((o) => `${o.source}|${o.evidence_key}`));
  const bySourceStatus: Record<string, number> = {};
  for (const o of observations) bySourceStatus[`${o.source}:${o.status}`] = (bySourceStatus[`${o.source}:${o.status}`] || 0) + 1;
  return {
    observed: observations.length,
    missingEmail,
    upsert: observations,
    end: open
      .filter((r) => r.source === 'membership' || r.source === 'membership_unruled')
      .filter((r) => !seen.has(`${r.source}|${r.evidence_key}`)),
    bySourceStatus,
  };
}

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase unconfigured');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Sweep Stripe and (with go=true) write ONLY entitlement_source_observations.
 * Any failure before the writes → throws, nothing written.
 */
export async function reconcileMembershipObservations({ go }: { go: boolean }): Promise<ReconcilePlan & { wrote: boolean; openRowsUnknown?: boolean }> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('STRIPE_SECRET_KEY unset');
  const subs = await fetchMembershipSubs(new Stripe(secret));
  const { observations, missingEmail } = classifyMembershipSubs(subs);

  const sb = getSupabase();
  const { data: open, error: openErr } = await sb
    .from('entitlement_source_observations')
    .select('source, evidence_key')
    .in('source', ['membership', 'membership_unruled'])
    .neq('status', 'ended');
  // A dry run may preview before the table exists; a real run never proceeds on an unknown.
  if (openErr && go) throw new Error(`read open observations: ${openErr.message}`);

  const plan = planReconcile(observations, open ?? [], missingEmail);
  if (!go) return { ...plan, wrote: false, openRowsUnknown: !!openErr };

  const now = new Date().toISOString();
  if (plan.upsert.length) {
    const { error } = await sb.from('entitlement_source_observations').upsert(
      plan.upsert.map((o) => ({ ...o, last_observed_at: now, ended_at: null })),
      { onConflict: 'source,evidence_key' },
    );
    if (error) throw new Error(`upsert observations: ${error.message}`);
  }
  for (const e of plan.end) {
    const { error } = await sb.from('entitlement_source_observations')
      .update({ status: 'ended', ended_at: now })
      .eq('source', e.source).eq('evidence_key', e.evidence_key).neq('status', 'ended');
    if (error) throw new Error(`end observation: ${error.message}`);
  }
  return { ...plan, wrote: true };
}

/** Bounded retention for the shadow log (30 days). Returns rows deleted, or null if unknown. */
export async function purgeShadowLog(days = 30): Promise<number | null> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { count, error } = await getSupabase()
    .from('entitlement_shadow_log')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);
  if (error) throw new Error(`purge shadow log: ${error.message}`);
  return count ?? null;
}
