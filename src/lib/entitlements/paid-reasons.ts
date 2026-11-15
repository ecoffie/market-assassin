/**
 * Pure ledger-reason classification + flags for the shared paid-status resolver
 * (paid-status.ts). No I/O, no heavy imports, so dashboards can import the lists cheaply.
 */

// ---------------------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------------------

function flagOn(name: string): boolean {
  return (process.env[name] || '').trim().toLowerCase() === 'true';
}

/** Consumers read the shared resolver instead of their own reason list. Default OFF. */
export function paidStatusResolverEnabled(): boolean {
  return flagOn('PAID_STATUS_RESOLVER');
}

/** Compute the new answer alongside the old one and log disagreements only. Default OFF. */
export function paidStatusShadowEnabled(): boolean {
  return flagOn('PAID_STATUS_SHADOW');
}

// ---------------------------------------------------------------------------------------
// Ledger reason classification
// ---------------------------------------------------------------------------------------

/**
 * Ledger reasons that represent MONEY RECEIVED. The first four are unconditional: each is
 * written only on a charged card / paid invoice. app_tier_pro / app_tier_team are listed
 * because a paid Pro/Team invoice writes them, but see REQUIRES_PAID_INVOICE.
 */
export const PAID_FUNDING_REASONS: readonly string[] = [
  'stripe_topup',
  'auto_recharge',
  'mcp_sub_monthly',
  'mcp_sub_annual',
  'app_tier_pro',
  'app_tier_team',
];

/**
 * Paid ONLY when tied to a non-zero paid invoice. A $0 trial invoice has written
 * app_tier_pro, so a bare ledger row is not proof of payment. Without a corroborating
 * paid Stripe subscription or succeeded charge these are reported as
 * `unverified_app_tier`, never as paid.
 */
export const REQUIRES_PAID_INVOICE: readonly string[] = ['app_tier_pro', 'app_tier_team'];

/** Money received directly for credits (not a subscription). */
export const CREDIT_PURCHASE_REASONS = new Set(['stripe_topup', 'auto_recharge']);

/**
 * Historically mixed. pro_monthly was written for paying Pro subscribers AND (before
 * 2026-10-03, when comp moved to comp_monthly) for comp/advocate accounts, AND for
 * lifetime/bundle buyers. A bare pro_monthly row is therefore NOT paid funding; it is
 * surfaced as `ambiguous_pro_monthly`; when nothing else establishes the answer the
 * resolver returns `unknown` (not free), so a shadow report can count those accounts.
 */
export const HISTORICALLY_AMBIGUOUS_REASONS: readonly string[] = ['pro_monthly', 'pro_monthly_supplement'];

/** Complimentary allowances: access, never payment. */
export const COMPLIMENTARY_REASONS = new Set(['comp_monthly', 'comp_grant', 'comp_reset']);

/** Pool bookkeeping and corrections. Never personal funding, never promotional. */
export const NEUTRAL_REASONS = new Set([
  'pool_monthly', 'pool_migration_in', 'courtesy_credit_restore_first_session',
  'member_credit_reset', 'alert_exhausted',
]);

/** Live windows for subscription ledger rows when Stripe facts are absent. */
export const MCP_SUB_MONTHLY_WINDOW_DAYS = 40;
export const MCP_SUB_ANNUAL_WINDOW_DAYS = 370;
export const DAY_MS = 86_400_000;

/** The legacy lists, frozen here only so the golden test can prove flag-OFF is unchanged. */
export const LEGACY_ACTIVATION_PAID_REASONS: readonly string[] = [
  'pro_monthly', 'app_tier_pro', 'mcp_sub_monthly', 'mcp_sub_annual', 'stripe_topup',
];

/**
 * The activation dashboard's ledger reason list. It can only read the ledger per row, so it
 * cannot corroborate app_tier_* against an invoice; with the flag ON it uses
 * PAID_FUNDING_REASONS (adds auto_recharge + app_tier_team, drops pro_monthly because it
 * includes comp). Historical app_tier_pro rows from $0 trials remain a known caveat there.
 */
export function activationPaidReasons(): string[] {
  return paidStatusResolverEnabled() ? [...PAID_FUNDING_REASONS] : [...LEGACY_ACTIVATION_PAID_REASONS];
}
