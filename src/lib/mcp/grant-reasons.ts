/**
 * Classification of every credit-GRANT reason for the ChatGPT auto-recharge attribution
 * window (owner decision 2026-10-03).
 *
 * The AUTHORITATIVE allowlist is the SQL function `mcp_grant_resets_chatgpt_window()`
 * (supabase/migrations/20261003_mcp_autorecharge_chatgpt_attribution.sql) — every personal
 * grant path consults it in the same transaction as the grant. This file mirrors it so
 * tests can prove (a) the SQL list equals CHATGPT_WINDOW_RESET_REASONS, (b) every reason
 * the code can produce is classified here (grant-reasons.unit.test.ts scans the source),
 * and (c) any reason NOT in the SQL list — including an unknown one — does not reset.
 *
 * RESET = an independent funding event: new customer entitlement the customer paid for,
 * directly or by subscription. It starts a new window (S := 0).
 * NO RESET = everything else. Unknown/new reasons default to NO RESET.
 *
 * Runtime code does NOT read this file; changing a classification means changing the SQL
 * allowlist (a new migration) AND this mirror — the equality test fails otherwise.
 */

export type GrantWindowClass = 'reset' | 'no_reset' | 'needs_owner';

export interface GrantReasonEntry {
  class: GrantWindowClass;
  why: string;
  /** Where it comes from today ('historical' = in the prod ledger, no current code path). */
  source: string;
}

export const GRANT_REASONS: Record<string, GrantReasonEntry> = {
  // ---- RESET: independent funding events ------------------------------------------
  auto_recharge: { class: 'reset', why: 'successful off-session auto-recharge: the customer\'s card was charged', source: 'autorecharge.ts maybeAutoRecharge + stripe-webhook backstop (same PaymentIntent key)' },
  stripe_topup: { class: 'reset', why: 'customer-paid manual top-up', source: 'stripe-topup.ts handleMcpCreditTopup' },
  pro_monthly: { class: 'reset', why: 'Pro monthly allowance to a personal balance (subscription entitlement)', source: 'cron/grant-mcp-pro-credits (applyCreditOnce mode)' },
  app_tier_pro: { class: 'reset', why: 'Pro subscription invoice: monthly allowance (renewal credit grant)', source: 'app-tier-subscription.ts handleAppTierSubscriptionInvoice' },
  app_tier_team: { class: 'reset', why: 'Team subscription invoice, legacy PERSONAL grant when no pool exists (renewal credit grant)', source: 'app-tier-subscription.ts handleAppTierSubscriptionInvoice' },
  mcp_sub_monthly: { class: 'reset', why: 'MCP subscription renewal credit grant (monthly)', source: 'stripe-subscription.ts' },
  mcp_sub_annual: { class: 'reset', why: 'MCP subscription renewal credit grant (annual)', source: 'stripe-subscription.ts' },

  // ---- NEEDS OWNER CLASSIFICATION (treated as NO RESET until decided) --------------
  sponsor_monthly: { class: 'needs_owner', why: 'sponsor-funded monthly top-up to a ceiling: paid, but by a third-party sponsor, not the customer', source: 'cron/grant-mcp-pro-credits → mcp_topup_to_ceiling' },
  pro_monthly_supplement: { class: 'needs_owner', why: 'one-off allowance supplement (40 rows, 2026-09-08); subscription-related but not a normal refill', source: 'historical (prod ledger only)' },

  // ---- NO RESET ---------------------------------------------------------------------
  signup_grant: { class: 'no_reset', why: 'free signup/welcome credits (promotional)', source: 'mcp_grant_signup_credits (fixed reason)' },
  referral: { class: 'no_reset', why: 'referral bonus (promotional)', source: 'referrals.ts' },
  admin_grant: { class: 'no_reset', why: 'admin/debug grant', source: 'api/admin/mcp-credits, acceptance scripts' },
  comp_reset: { class: 'no_reset', why: 'comp account reset (correction)', source: 'scripts/reset-comp-credits.ts' },
  comp_grant: { class: 'no_reset', why: 'complimentary credit (promotional)', source: 'historical (prod ledger only)' },
  courtesy_credit_restore_first_session: { class: 'no_reset', why: 'courtesy restore (refund/correction)', source: 'historical (prod ledger only)' },
  member_credit_reset: { class: 'no_reset', why: 'member balance reset (correction)', source: 'historical (prod ledger only)' },
  alert_exhausted: { class: 'no_reset', why: 'internal idempotency marker seen in mcp_credit_topups, not a customer funding event', source: 'historical (mcp_credit_topups only)' },
  pool_monthly: { class: 'no_reset', why: 'POOL grant: never touches a personal balance or S', source: 'mcp_replenish_pool' },
  pool_migration_in: { class: 'no_reset', why: 'pool transfer: credits a POOL, never a personal balance', source: 'mcp_transfer_personal_to_pool' },
};

/** Must equal the SQL ARRAY in mcp_grant_resets_chatgpt_window() (test-asserted). */
export const CHATGPT_WINDOW_RESET_REASONS: readonly string[] = Object.entries(GRANT_REASONS)
  .filter(([, e]) => e.class === 'reset')
  .map(([r]) => r)
  .sort();
