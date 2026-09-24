/**
 * CANCELLATION → REVOCATION PLAN: remove ONLY the access the cancelled subscription granted.
 *
 * ── WHAT WAS WRONG (stripe-webhook, before 2026-09-23) ─────────────────────────────────────
 *   • Alert Pro cancel deleted `alertpro:` only — but the purchase ALSO wrote `ospro:` (which
 *     /app counts as full Pro) and `access_hunter_pro`, so a cancelled $19 customer kept Pro.
 *   • FHC cancel deleted `ma:`, `alertpro:`, `ospro:` and both flags UNCONDITIONALLY — wiping a
 *     Market Assassin or Opportunity Hunter Pro purchase, another live subscription, or a comp.
 *   • Both ran on `past_due` / `unpaid` updates, i.e. during Stripe's retry window, before the
 *     paid-through period had ended.
 *   • Both reset `alert_frequency` to weekly, although daily alerts are free for everyone —
 *     that removed a PREFERENCE, not a paid entitlement.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────
 * A grant is revoked only when THIS subscription is its only remaining source. Any other source —
 * another live subscription, a one-time purchase, an admin/purchase-written KV value, a comp
 * account — keeps it. When attribution is uncertain the grant is KEPT (and reported): a customer
 * wrongly keeping access is recoverable; a paying customer wrongly locked out is the incident
 * this rule exists to prevent. Access paid through a future date expires at that date instead
 * of being removed now.
 */

export type CancellableProduct = 'alert_pro' | 'fhc';
export type GrantKey = 'ma' | 'alertpro' | 'ospro';
export type FlagKey = 'access_assassin_standard' | 'access_hunter_pro';

/** What each subscription product writes on purchase (stripe-webhook checkout branches). */
export const SUBSCRIPTION_GRANTS: Record<CancellableProduct, { kv: GrantKey[]; flags: FlagKey[] }> = {
  alert_pro: { kv: ['alertpro', 'ospro'], flags: ['access_hunter_pro'] },
  fhc: { kv: ['ma', 'alertpro', 'ospro'], flags: ['access_assassin_standard', 'access_hunter_pro'] },
};
const FLAG_FOR: Record<FlagKey, GrantKey> = { access_assassin_standard: 'ma', access_hunter_pro: 'ospro' };

/** A subscription in one of these states has ENDED — a replayed checkout must not re-grant it. */
export function isEndedSubscriptionStatus(status: string): boolean {
  return status === 'canceled' || status === 'incomplete_expired';
}

/** Subscription statuses that are NOT an end of access (still paying or retrying). */
export const NON_TERMINAL_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

export interface RevocationInput {
  cancelled: CancellableProduct;
  /** Stripe status on the event (deleted events carry 'canceled'). */
  status: string;
  /** True for customer.subscription.deleted. */
  deleted: boolean;
  /** Other subscriptions of the same customer that are still live. */
  otherLiveSubscriptions: CancellableProduct[];
  /** Raw KV values currently stored for this email (undefined = key absent). */
  kvValues: Partial<Record<GrantKey, unknown>>;
  /** Text of the customer's one-time purchases (product_id / product_name / tier / bundle). */
  purchaseTexts: string[];
  /** Staff, advocate or comp/testimonial account. */
  isComp: boolean;
  /** End of the paid-through period (ms since epoch), if known. */
  paidThroughMs: number | null;
  nowMs: number;
}

export interface RevocationPlan {
  action: 'revoke' | 'none';
  reason: string;
  deleteKv: GrantKey[];
  /** Keys to expire at the paid-through end instead of deleting now. */
  expireKvAt: Array<{ key: GrantKey; atMs: number }>;
  clearFlags: FlagKey[];
  keep: Array<{ key: GrantKey | FlagKey; because: string }>;
  /** Never touch preferences (daily alerts are free for everyone). */
  setSubscriptionStatusCanceled: boolean;
}

// One-time purchases that also confer the grant. Broad on purpose — a false match KEEPS access.
const PURCHASE_CONFERS: Record<GrantKey, RegExp> = {
  ma: /assassin|pro[\s_-]?giant|ultimate|market[\s_-]?intelligence[\s_-]?bundle/i,
  ospro: /hunter|ospro|starter|ultimate|opportunity/i,
  alertpro: /alert[\s_-]?pro/i,
};

/** A value written by a purchase/admin grant (an object) is not the subscription's `'true'`. */
function writtenByAnotherSource(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (v === true || v === 'true') return false;
  return true; // object / other string: purchase or admin grant — or unknown → keep
}

export function planCancellationRevocation(i: RevocationInput): RevocationPlan {
  const none = (reason: string): RevocationPlan => ({
    action: 'none', reason, deleteKv: [], expireKvAt: [], clearFlags: [], keep: [], setSubscriptionStatusCanceled: false,
  });

  if (!i.deleted && NON_TERMINAL_STATUSES.has(i.status)) {
    return none(`status ${i.status} is not an end of access (Stripe is still billing/retrying)`);
  }
  if (!i.deleted && i.status !== 'canceled') return none(`status ${i.status} is not a cancellation`);

  const grants = SUBSCRIPTION_GRANTS[i.cancelled];
  const plan: RevocationPlan = {
    action: 'revoke', reason: 'subscription ended', deleteKv: [], expireKvAt: [], clearFlags: [], keep: [],
    setSubscriptionStatusCanceled: true,
  };
  const paidThroughFuture = i.paidThroughMs !== null && i.paidThroughMs > i.nowMs;
  const purchases = i.purchaseTexts.join(' | ');

  const otherSource = (key: GrantKey): string | null => {
    if (i.isComp) return 'comp/staff/advocate account';
    const liveOther = i.otherLiveSubscriptions.find((p) => SUBSCRIPTION_GRANTS[p].kv.includes(key));
    if (liveOther) return `another live ${liveOther} subscription`;
    if (PURCHASE_CONFERS[key].test(purchases)) return 'a one-time purchase that includes it';
    if (writtenByAnotherSource(i.kvValues[key])) return 'KV value written by a purchase/admin grant, not this subscription';
    return null;
  };

  const revokedKeys = new Set<GrantKey>();
  for (const key of grants.kv) {
    const why = otherSource(key);
    if (why) { plan.keep.push({ key, because: why }); continue; }
    if (i.kvValues[key] === undefined) continue; // nothing to remove
    revokedKeys.add(key);
    if (paidThroughFuture) plan.expireKvAt.push({ key, atMs: i.paidThroughMs! });
    else plan.deleteKv.push(key);
  }
  for (const flag of grants.flags) {
    const key = FLAG_FOR[flag];
    const why = otherSource(key);
    if (why) { plan.keep.push({ key: flag, because: why }); continue; }
    // Flags cannot expire; while paid-through they stay (they never grant tool access alone —
    // KV is the gate) and are cleared by the next cancellation event or a sweep.
    if (paidThroughFuture) { plan.keep.push({ key: flag, because: 'paid through a future date' }); continue; }
    plan.clearFlags.push(flag);
  }
  if (!plan.deleteKv.length && !plan.expireKvAt.length && !plan.clearFlags.length) {
    plan.action = 'none';
    plan.reason = 'every grant has another source';
  }
  return plan;
}
