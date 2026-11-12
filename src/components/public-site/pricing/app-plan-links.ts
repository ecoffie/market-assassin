/**
 * Mindy app plan checkout links (14-day free trial) — created in Stripe 2026-11-12. Each link
 * carries metadata.tier so the webhook grants the right plan on a $0 trial checkout.
 * Env vars override. Shared by /pricing (SimplePricing) and the unified surface.
 */
export const PRO_TRIAL_MONTHLY = process.env.NEXT_PUBLIC_PRO_TRIAL_CHECKOUT_MONTHLY || 'https://buy.stripe.com/7sYcN64Au4QWcFv70QfnO18';
export const PRO_TRIAL_ANNUAL = process.env.NEXT_PUBLIC_PRO_TRIAL_CHECKOUT_ANNUAL || 'https://buy.stripe.com/fZudRaff82IO48Z5WMfnO19';
export const TEAM_TRIAL_MONTHLY = process.env.NEXT_PUBLIC_TEAM_TRIAL_CHECKOUT_MONTHLY || 'https://buy.stripe.com/eVq28s8QK3MS34VdpefnO1a';
export const TEAM_TRIAL_ANNUAL = process.env.NEXT_PUBLIC_TEAM_TRIAL_CHECKOUT_ANNUAL || 'https://buy.stripe.com/3cI9AU2sm5V020R2KAfnO1b';

export const PRO_MONTHLY_USD = 149;
export const PRO_ANNUAL_USD = 1490;          // $124.17/mo, 17% off
export const TEAM_MONTHLY_USD = 499;
export const TEAM_ANNUAL_USD = 4027;         // $335.58/mo, 33% off
export const TEAM_ANNUAL_PER_MONTH = 335.58;
export const SALES_URL = '/contact-sales';

/** Percent off monthly-billed-for-a-year, rounded. */
export const pctOff = (annual: number, monthly: number) => Math.round((1 - annual / (monthly * 12)) * 100);
