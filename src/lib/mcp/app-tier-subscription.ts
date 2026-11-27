/**
 * App-tier (Pro/Team) subscriptions — grant MCP credits when the invoice is paid.
 *
 * THE GAP THIS CLOSES
 * Pro ($149/mo) and Team ($499/mo) include a monthly MCP credit allowance, but the
 * ONLY thing that granted it was the `grant-mcp-pro-credits` cron, which fires
 * `0 9 1 * *` — once a month, on the 1st. Nothing granted at purchase. So a new
 * subscriber's wait was "days until the 1st": subscribe on the 2nd, wait ~30 days
 * for the credits you are already paying for.
 *
 * Measured 2026-07-30: 9 of 26 paying Pro subscribers had zero credits. Every one
 * of them subscribed Jul 21-30 — i.e. after the previous run. Not a bug in the
 * cron (it works, and no pre-Jul-20 subscriber was short); the cadence was simply
 * the wrong shape for onboarding.
 *
 * This mirrors handleMcpSubscriptionInvoice (the MCP-plan path) exactly: grant on
 * `invoice.paid` for both `subscription_create` and `subscription_cycle`.
 *
 * WHY THIS CANNOT DOUBLE-GRANT
 * The monthly cron keys its grant `pro:<email>:<YYYY-MM>` via applyCreditOnce. This
 * uses the SAME key. So whichever runs first wins and the other is a no-op:
 *   - subscribe Jul 28 -> webhook grants pro:x@y.com:2026-07 immediately
 *   - Aug 1 cron       -> different month key -> grants normally
 *   - Stripe redelivery-> same key -> skipped
 * Deliberately NOT keyed by invoice id (which is what the MCP path uses): the cron
 * has no invoice, so an invoice key would let both paths grant in the same month.
 *
 * Credits resolve SERVER-SIDE from the price amount, never from metadata.
 */
import type Stripe from 'stripe';
import {
  findPooledOrgBySubscription, provisionPooledOrg, replenishPool, isPoolSchemaMissing, subscriptionIdFromInvoice,
  promoPoolCeiling,
} from './team-pools';
import { applyCreditOnce } from './credits';
import { proAllowanceDecision } from './pro-allowance';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS } from './packages';
import { getStripe } from '@/lib/stripe';
import { teamSeatPlanForPriceId } from '@/lib/billing/team-seat-plans';
import { mindyDayPromoHasStarted, promoMultiplier, type PromoSubscription } from '@/lib/billing/mindy-day-annual-promo';

/** App-tier price amounts (cents). Mirrors grant-mcp-pro-credits so the two agree. */
const PRO_AMOUNTS = new Set([14900, 149000, 4900]);   // Pro $149/mo · $1,490/yr · $49 grandfathered
const TEAM_AMOUNTS = new Set([49900, 499000, 402700]);        // Team $499/mo · $4,990/yr · $4,027/yr (current annual)
/** The yearly amounts above — used only when an invoice line carries no billing interval. */
const ANNUAL_AMOUNTS = new Set([149000, 499000, 402700]);

export interface AppTierInvoiceOutcome {
  handled: boolean;   // false => not an app-tier subscription invoice
  applied?: boolean;  // true => granted; false => already granted this month
  credits?: number;
  email?: string;
  tier?: 'pro' | 'team';
  newBalance?: number;
  error?: string;
  /** Set when the allowance was deliberately NOT granted (e.g. team_pool_supersedes_pro). */
  skipped?: string;
}

/**
 * Which app tier a price amount (cents) belongs to, using the same amount sets as the
 * invoice grant below. null = not a Pro/Team price (e.g. an MCP credits plan).
 */
export function appTierForAmount(amountCents: number | null | undefined): 'pro' | 'team' | null {
  if (typeof amountCents !== 'number') return null;
  if (PRO_AMOUNTS.has(amountCents)) return 'pro';
  if (TEAM_AMOUNTS.has(amountCents)) return 'team';
  return null;
}

/** Resolve the payer email: invoice field first, then the customer record. */
export async function resolveInvoiceEmail(invoice: Stripe.Invoice): Promise<string | null> {
  const direct = invoice.customer_email;
  if (direct) return direct.toLowerCase().trim();
  const cust = invoice.customer;
  if (!cust) return null;
  try {
    const stripe = getStripe();
    const id = typeof cust === 'string' ? cust : cust.id;
    const full = await stripe.customers.retrieve(id);
    if (full.deleted) return null;
    return (full.email || '').toLowerCase().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Grant the app-tier monthly allowance for a paid subscription invoice.
 * Returns handled=false for anything that isn't a Pro/Team subscription invoice,
 * so the caller continues normally.
 */
export async function handleAppTierSubscriptionInvoice(
  invoice: Stripe.Invoice,
): Promise<AppTierInvoiceOutcome> {
  const reason = invoice.billing_reason;
  if (reason !== 'subscription_create' && reason !== 'subscription_cycle') return { handled: false };

  // The `price` field is present in API 2025-01-27 but isn't on the SDK's
  // InvoiceLineItem type; guard with an `unknown` cast the same way
  // stripe-subscription.ts does, so a future rename can't break the build.
  // Falls back to amount_paid, which is what the cron effectively matches on.
  const line = invoice.lines?.data?.[0] as unknown as
    { price?: { unit_amount?: number | null; recurring?: { interval?: string | null } | null }; plan?: { interval?: string | null } } | undefined;
  const amount = line?.price?.unit_amount ?? invoice.amount_paid ?? 0;
  let tier: 'pro' | 'team' | null = null;
  let credits = 0;
  // Team by seats (2026-11-24, held behind Stripe price ids that do not exist yet): matched by
  // price ID, never by amount ($249 for 2 seats is also the Mid credit plan's amount).
  const seatLines = (invoice.lines?.data ?? []) as unknown as Array<{ price?: { id?: string } }>;
  const seat = seatLines.map((l) => teamSeatPlanForPriceId(l.price?.id)).find(Boolean) ?? null;
  if (seat) { tier = 'team'; credits = seat.plan.credits; }
  else if (PRO_AMOUNTS.has(amount)) { tier = 'pro'; credits = PRO_MONTHLY_CREDITS; }
  else if (TEAM_AMOUNTS.has(amount)) { tier = 'team'; credits = TEAM_MONTHLY_CREDITS; }
  if (!tier || credits <= 0) return { handled: false };

  const email = await resolveInvoiceEmail(invoice);
  if (!email) {
    console.error('[app-tier:sub] no email on invoice', invoice.id);
    return { handled: true, tier, error: 'no_email' };
  }

  const month = new Date().toISOString().slice(0, 7); // YYYY-MM

  // MINDY DAY ANNUAL PROMO (src/lib/billing/mindy-day-annual-promo.ts): an annual plan bought
  // Nov 28 – Dec 5 2026 gets double the allowance every month of its first paid year. The rule
  // reads the SUBSCRIPTION (interval, current period, trial), so it is re-read from Stripe —
  // only for an annual line, and only once the window has opened. A failed read grants nothing
  // here: granting 1x would claim the month at the normal amount and lose the doubling for it;
  // the daily cron evaluates the same rule and self-heals within a day.
  let multiplier = 1;
  const interval = line?.price?.recurring?.interval ?? line?.plan?.interval ?? null;
  const annualLine = interval === 'year' || (interval == null && (ANNUAL_AMOUNTS.has(amount) || seat?.interval === 'year'));
  if (annualLine && mindyDayPromoHasStarted()) {
    const subscriptionId = subscriptionIdFromInvoice(invoice);
    if (subscriptionId) {
      try {
        const sub = await getStripe().subscriptions.retrieve(subscriptionId);
        multiplier = promoMultiplier(sub as unknown as PromoSubscription);
      } catch (e) {
        console.error('[app-tier:sub] Mindy Day promo check failed, deferring to cron:', (e as Error).message);
        return { handled: true, tier, email, error: 'promo_check_failed' };
      }
    }
  }
  credits *= multiplier;

  // TEAM → the organization's POOL (tasks/PRD-pooled-team-credits.md). Provision the
  // pooled org here (idempotent) rather than waiting for checkout provisioning: if this
  // invoice arrived first and granted personally, the pool would be granted again later
  // and the first month's allowance would be paid twice.
  if (tier === 'team') {
    const subscriptionId = subscriptionIdFromInvoice(invoice);
    if (subscriptionId) {
      try {
        let org = await findPooledOrgBySubscription(subscriptionId);
        if (!org) {
          const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
          await provisionPooledOrg({
            subscriptionId, customerId, ownerEmail: email, planKey: 'team',
            // A seat plan sets its own seat limit and shared credits; classic Team keeps the defaults.
            ...(seat ? { seatLimit: seat.plan.seats, monthlyCredits: seat.plan.credits } : {}),
          });
          org = await findPooledOrgBySubscription(subscriptionId);
        }
        if (org) {
          // The promo doubles the pool's own allowance, but never tops up a month already
          // replenished at the normal allowance (promoPoolCeiling).
          const ceiling = multiplier > 1 ? await promoPoolCeiling(org, month, multiplier) : org.monthlyCredits;
          const r = await replenishPool(ceiling === org.monthlyCredits ? org : { ...org, monthlyCredits: ceiling }, month);
          console.log(`[app-tier:sub] pool ${org.orgId} +${r.granted} (team, ${reason}, applied=${r.applied}) invoice ${invoice.id}`);
          return { handled: true, applied: r.applied, credits: r.granted, email, tier, newBalance: r.newBalance };
        }
      } catch (e) {
        if (!isPoolSchemaMissing(e)) {
          // Pools exist but this one could not be resolved: grant NOTHING personally
          // (that would double-pay once the pool is found). The daily cron self-heals.
          console.error('[app-tier:sub] pool grant failed, deferring to cron:', (e as Error).message);
          return { handled: true, tier, email, error: 'pool_grant_failed' };
        }
        // Migration not applied yet → legacy personal grant below.
      }
    }
  }

  // Team supersedes Pro: a Pro allowance for someone whose calls bill a TEAM pool is
  // credit they can never spend. Same rule as the monthly cron (src/lib/mcp/pro-allowance.ts),
  // so the renewal invoice cannot grant what the cron withheld.
  // tier-display-ok: billing — which PRICE was paid decides the allowance; not a capability gate.
  if (tier === 'pro') {
    const d = await proAllowanceDecision(email);
    if (!d.grant) {
      console.log(`[app-tier:sub] ${email} Pro allowance NOT granted (${d.reason}: ${d.detail}) invoice ${invoice.id}`);
      return { handled: true, applied: false, credits: 0, email, tier, skipped: d.reason };
    }
  }

  // SAME key shape as the monthly cron — this is what makes the two paths safe
  // together. See the header note. A promo grant uses the same key: a month already claimed
  // (at any amount) stays claimed, so doubling can never stack on, or top up, a 1x grant.
  const key = `pro:${email}:${month}`;
  const { applied, newBalance } = await applyCreditOnce(key, email, credits, `app_tier_${tier}`);
  console.log(
    `[app-tier:sub] ${email} +${credits} (${tier}, ${reason}, applied=${applied}, balance=${newBalance}) invoice ${invoice.id}`,
  );
  return { handled: true, applied, credits, email, tier, newBalance };
}
