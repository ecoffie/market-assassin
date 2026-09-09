/**
 * Paid-entitlement reconciliation — "active paid subscription ⇒ paid entitlement".
 *
 * THE INVARIANT (Eric, 2026-08-19, narrowed 2026-09-09): a customer with an
 * active subscription to a BRIEFING-bearing product must hold paid
 * `briefings_access`. Payment status is not entitlement. Entitlement is
 * product-specific. Measured 2026-08-19: 49 briefing-product subscribers sat
 * on `beta_preview` or had no row, including a $1,490/yr Mindy Ai subscriber.
 *
 * MCP IS NOT THAT PRODUCT. `briefingGrantForPurchase` in product-entitlement.ts
 * (Eric, 2026-08-15) is explicit: Mindy MCP sells API credits, not intelligence.
 * A $2,490/yr MCP subscriber on `beta_preview` is not a briefing mismatch. Checking
 * MCP here made the daily digest page the wrong failure. Exclude it BEFORE the
 * named-product list AND before the $99 monthly floor — otherwise MCP Entry at
 * $99/mo would still entitle through the floor.
 *
 * WHY STRIPE IS THE AUTHORITY, not our columns. `paid_status` and
 * `has_active_subscription` are OUR flags, set by webhooks that can miss. And
 * `stripe_customer_id` was populated on only 23 of 10,599 profiles, so joining
 * from our side found 22 subscribers when Stripe held 103. Any check that starts
 * from our data under-reports by ~80%. This walks Stripe and matches on EMAIL.
 *
 * WHY PRODUCT NAME, NOT PRICE ALONE. The Stripe account carries several distinct
 * businesses — Academy courses, FHC Community, Starter plans, Rhinos Bid Alert —
 * alongside Mindy. A naive "has an active subscription ⇒ grant briefings" rule
 * would have granted Mindy access to 68 people, most of whom bought a course.
 * That is the mirror image of the bug this fixes.
 */

export interface StripeSub {
  email: string;
  productName: string;
  amount: number;                 // dollars
  interval: 'month' | 'year' | 'once';
}

/** Access levels that count as PAID. Anything else (beta_preview/none) is free tier. */
export const PAID_ACCESS = new Set(['subscription', 'lifetime', '1_year']);

/**
 * Products Eric named as entitled, matched on the Stripe product NAME.
 * `Copy of PRO Member Group` is included deliberately: it is a duplicated Pro
 * Member SKU (~19 active subscribers) and is the $99 Pro plan by another name.
 */
const ENTITLED_PRODUCTS: RegExp[] = [
  /^mindy ai/i,
  /^pro member plan/i,
  /^copy of pro member/i,
  /^pro member lifetime/i,
  /^ongoing coaching/i,          // parked 2026-09-09: still an explicit policy question, not "paid ⇒ briefings"
  /^alert pro/i,
  /^small business$/i,
];

/**
 * MCP sells API credits, not briefings. Same token product-entitlement.ts uses
 * (`name.includes('mcp')`) so a Mid/Entry rename cannot re-open the digest page.
 */
function isMcpProduct(productName: string): boolean {
  return productName.toLowerCase().includes('mcp');
}

/**
 * Honored floor: ANY monthly subscription at or above this price, except MCP.
 * Eric, 2026-08-19: "we did honor any monthly subscriptions over $99/mo."
 * Applied literally — a $799/mo Academy subscriber qualifies on price even though
 * Academy is not a Mindy product, because that is the promise that was made.
 * MCP is excluded in isEntitling before this floor is consulted.
 */
export const HONORED_MONTHLY_FLOOR = 99;

/** Does this subscription entitle the customer to paid BRIEFING access? */
export function isEntitling(sub: Pick<StripeSub, 'productName' | 'amount' | 'interval'>): boolean {
  if (isMcpProduct(sub.productName)) return false;
  if (ENTITLED_PRODUCTS.some((r) => r.test(sub.productName))) return true;
  return sub.interval === 'month' && sub.amount >= HONORED_MONTHLY_FLOOR;
}

/**
 * The tier a qualifying subscription maps to.
 * Annual plans get `1_year`; everything else `subscription`. Neither expires on
 * its own — `briefings_expiry` stays null, matching every existing paid row.
 */
export function tierFor(sub: Pick<StripeSub, 'interval'>): 'subscription' | '1_year' {
  return sub.interval === 'year' ? '1_year' : 'subscription';
}

export interface Mismatch {
  email: string;
  currentAccess: string | null;   // null = no classification row at all
  productName: string;
  amount: number;
  interval: string;
  targetAccess: 'subscription' | '1_year';
}

/**
 * Compare a set of active Stripe subscriptions against current entitlements.
 * Pure — no I/O — so the rule is unit-testable without Stripe or Supabase.
 *
 * When one email holds several qualifying subscriptions, the HIGHEST-priced one
 * wins: a customer on both a $27 Starter and a $149 Mindy plan is a Mindy
 * customer, and the cheaper row must not decide their tier.
 */
export function findMismatches(
  subs: StripeSub[],
  accessByEmail: Map<string, string>,
): Mismatch[] {
  const best = new Map<string, StripeSub>();
  for (const s of subs) {
    const email = s.email.toLowerCase().trim();
    if (!email || !isEntitling(s)) continue;
    const prev = best.get(email);
    if (!prev || s.amount > prev.amount) best.set(email, { ...s, email });
  }

  const out: Mismatch[] = [];
  for (const [email, sub] of best) {
    const current = accessByEmail.get(email) ?? null;
    if (current && PAID_ACCESS.has(current)) continue;   // already correct
    out.push({
      email,
      currentAccess: current,
      productName: sub.productName,
      amount: sub.amount,
      interval: sub.interval,
      targetAccess: tierFor(sub),
    });
  }
  return out;
}
