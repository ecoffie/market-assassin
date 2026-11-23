/**
 * Pro credit add-ons (owner, 2026-11-23): "change these [credit-only plans] to add-ons to the base
 * Pro plan", shown as a picker on the Pro card (Zapier / Clay style) and as "more credits every
 * month" inside the app.
 *
 * An add-on IS one of the existing Entry / Mid / Growth credit subscriptions, bought through its
 * existing Stripe checkout link. Nothing new is created in Stripe and the webhook is unchanged:
 * the add-on is its own subscription, its credits are granted by the existing invoice path
 * (handleMcpSubscriptionInvoice, by price id) into the same per-account balance Pro fills. So
 * Pro + "+3,000" = 1,500 + 3,000 credits a month, on two subscriptions.
 *
 * Prices and credits are read from SUBSCRIPTION_PLANS (packages.ts is the pricing authority), so
 * this file can never drift from what Stripe charges.
 */
import { SUBSCRIPTION_PLANS } from '@/lib/mcp/packages';

export const ADDON_PLAN_IDS = ['entry', 'mid', 'growth'] as const;
export type AddonPlanId = (typeof ADDON_PLAN_IDS)[number];

export interface ProCreditAddon {
  id: AddonPlanId;
  credits: number;
  monthlyUsd: number;
  monthlyHref: string;
  annualPerMonthUsd: number;
  annualHref: string;
}

export const PRO_CREDIT_ADDONS: ProCreditAddon[] = ADDON_PLAN_IDS.map((id) => {
  const p = SUBSCRIPTION_PLANS.find((s) => s.id === id);
  if (!p || !p.annual) throw new Error(`pro-credit-addons: plan ${id} missing from SUBSCRIPTION_PLANS`);
  return {
    id,
    credits: p.creditsPerMonth,
    monthlyUsd: p.monthly.usd,
    monthlyHref: p.monthly.checkoutUrl,
    annualPerMonthUsd: p.annual.usdPerMonth,
    annualHref: p.annual.checkoutUrl,
  };
});

/** Remembers an add-on picked on /pricing before the visitor has an account (per browser). */
export const PENDING_ADDON_KEY = 'mindy_pending_addon';

export function addonById(id: string | null | undefined): ProCreditAddon | null {
  return PRO_CREDIT_ADDONS.find((a) => a.id === id) ?? null;
}

export function addonPrice(a: ProCreditAddon, annual: boolean): number {
  return annual ? a.annualPerMonthUsd : a.monthlyUsd;
}

/** The add-on's checkout link, with the buyer's email filled in when known (Stripe prefilled_email). */
export function addonCheckoutHref(a: ProCreditAddon, annual: boolean, email?: string | null): string {
  const base = annual ? a.annualHref : a.monthlyHref;
  if (!email) return base;
  return `${base}${base.includes('?') ? '&' : '?'}prefilled_email=${encodeURIComponent(email)}`;
}
