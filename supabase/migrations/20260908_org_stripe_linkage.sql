-- Organization ↔ Stripe linkage — the durable billing relationship.
--
-- PR 1 of the Teams shared-MCP sequence. ADDITIVE AND INERT: adds three nullable
-- columns to an existing table. No code reads them yet, no behaviour changes, no
-- data is written by this migration. Team allowance stays 1,000 on the billing
-- contact until the shared pool ships and production read-back proves it.
--
-- ── WHY organizations AND NOT A NEW TABLE ────────────────────────────────────
-- `organizations` / `org_members` / `org_clients` (20260605_coach_mode_orgs.sql) is
-- already live — 2 orgs, 64 clients — with explicit identity, explicit membership
-- and roles. Creating a second org/team entity would be the "don't invent a second
-- model" mistake. `docs/PRD-identity-model.md` already decided the direction:
-- workspaces keyed by an explicit id owned by an account, NOT derived from email
-- domain. This is that clause, applied to billing.
--
-- ⚠️ THE DOMAIN-DERIVED workspace_id IS NOT A BILLING IDENTITY. `getWorkspaceId()`
-- returns the email DOMAIN, so `proton.me` (5 unrelated members) and `xerox.com` (3)
-- would pool a paid allowance between strangers. Organization membership must stay
-- explicit. Nothing in this migration infers an org from a domain.
--
-- ── WHY stripe_subscription_id IS THE KEY, NOT AN EMAIL ──────────────────────
-- Measured 2026-09-08 on live data: the ONE active Team subscriber holds TWO Stripe
-- customer records with TWO concurrently active subscriptions under a single email —
-- Team $499 (cus_V0LXQHSe1GUEJl, 2026-08-03) and Pro $149 (cus_V30TrrguYOseoa,
-- 2026-08-10). An email key resolves that to two customers and two plans with no
-- deterministic winner. The subscription id resolves it exactly.
--
-- That duplicate-subscription case is FILED, NOT FIXED (Eric, 2026-09-08): whether
-- paying for both plans is intentional or accidental is undetermined. Do NOT cancel,
-- credit, consolidate or modify either subscription without explicit approval.
--
-- ── WHY THERE IS NO seat_limit HERE ──────────────────────────────────────────
-- Traced against live Stripe before writing this: `quantity` on the Team subscription
-- is **1**, at both subscription and item level, on a `licensed` recurring price. It
-- is 1 because nothing ever sets it — checkout passes no `quantity`/`adjustable_quantity`,
-- and the webhook mirror discards the field entirely. So quantity encodes "one
-- subscription", NOT "five seats", and seeding a seat_limit from it would persist a
-- number that means something else.
-- The advertised "Up to 5 users included" (pricing/page.tsx) is marketing copy —
-- enforced NOWHERE in src/lib or src/app/api today. Seat capacity is therefore
-- currently ungoverned; that is pre-existing and is filed, not changed here.
-- Add seat_limit when a real authorization path needs it, sourced from a field that
-- actually carries seats.

-- The durable billing relationship. UNIQUE: one Stripe subscription funds at most one
-- organization, so a pool can never be double-funded by the same subscription.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_stripe_subscription_id_key'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_stripe_subscription_id_key UNIQUE (stripe_subscription_id);
  END IF;
END $$;

-- Audit/traversal convenience. NOT the key: one email can own several customers
-- (measured above), so this is for reconciliation and support, never for resolution.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- DISPLAY METADATA ONLY — explicitly non-authoritative. Present so support can see
-- who to contact without a Stripe round-trip. Never join on this; never resolve
-- entitlement from it. It can be stale the moment a customer changes their email,
-- which is precisely why it is not the relationship.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS billing_email TEXT;

COMMENT ON COLUMN organizations.stripe_subscription_id IS
  'AUTHORITATIVE billing link → stripe_subscriptions.id. UNIQUE. Resolve orgs by this, never by email.';
COMMENT ON COLUMN organizations.stripe_customer_id IS
  'Audit/traversal only → stripe_customers.id. One email may own multiple customers, so this is not a key.';
COMMENT ON COLUMN organizations.billing_email IS
  'DISPLAY ONLY. Non-authoritative, may go stale. Never join or resolve entitlement from this column.';

-- Partial index: only the linked rows matter, and today that is a handful.
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_sub
  ON organizations (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
