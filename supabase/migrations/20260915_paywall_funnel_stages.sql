-- ============================================================================
-- Paywall funnel: name each stage for what it ACTUALLY measures (2026-09-15)
--
-- THE DEFECT: `checkout_started_at` is stamped when the /mcp/continue OFFER PAGE is
-- opened — never when Stripe checkout begins. The column name predates that page, and
-- the mismatch produced a wrong reading of the funnel three separate times in one
-- investigation ("3 checkout starts, 0 payments" → read as checkout abandonment, when
-- the truth is NOBODY has been recorded reaching Stripe at all).
--
-- A column read as its name, not its definition, is a measurement bug: it silently
-- relocates the drop-off. Splitting the stages is the repair.
--
--   offer_page_opened_at   the /mcp/continue page was OPENED (what the old column meant)
--   checkout_clicked_at    the customer CLICKED a buy link (we redirect them)
--   stripe_session_at      a Stripe Checkout Session was CREATED for them
--                          ⚠️ NOT proof the customer ever SAW Stripe's page
--   payment_confirmed_at   a signed Stripe webhook confirmed payment
--   credits_applied_at     credits actually landed in mcp_credit_balance
--   resumed_at/completed_at unchanged — the saved request ran / finished
--
-- The legacy column is RENAMED, not dropped: its 3 historical rows are real events and
-- keeping them under an honest name preserves the history instead of erasing it.
-- Idempotent; service_role only.
-- ============================================================================

-- 1) Relabel history. Existing values ARE offer-page opens — this is the rename that
--    makes the stored data true, not a migration of meaning.
ALTER TABLE mcp_paywall_attempts
  RENAME COLUMN checkout_started_at TO offer_page_opened_at;

-- 2) The stages that never existed. Each is nullable: absent = not observed, which must
--    stay distinguishable from "observed and zero" (Bug Prevention Rule #11).
ALTER TABLE mcp_paywall_attempts
  ADD COLUMN IF NOT EXISTS checkout_clicked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_session_at    timestamptz,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS credits_applied_at   timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_session_id    text;

COMMENT ON COLUMN mcp_paywall_attempts.offer_page_opened_at IS
  'The /mcp/continue offer page was OPENED. Renamed from checkout_started_at 2026-09-15: it never meant Stripe checkout, and being read as its old name misplaced the funnel drop-off three times.';
COMMENT ON COLUMN mcp_paywall_attempts.checkout_clicked_at IS
  'The customer clicked a buy link and we redirected them toward Stripe. The first stage that evidences deliberate purchase intent.';
COMMENT ON COLUMN mcp_paywall_attempts.stripe_session_at IS
  'A Stripe Checkout Session was CREATED. NOT proof the customer viewed Stripe''s page — a session can be created and never rendered, so never report this as "reached Stripe".';
COMMENT ON COLUMN mcp_paywall_attempts.payment_confirmed_at IS
  'A SIGNED Stripe webhook confirmed payment. Distinct from credits_applied_at: paying is not the same as receiving.';
COMMENT ON COLUMN mcp_paywall_attempts.credits_applied_at IS
  'Credits actually landed in mcp_credit_balance for this attempt. The gap from payment_confirmed_at is fulfillment failure.';

-- Find attempts awaiting fulfilment: paid but not yet credited.
CREATE INDEX IF NOT EXISTS idx_paywall_paid_uncredited
  ON mcp_paywall_attempts (payment_confirmed_at)
  WHERE payment_confirmed_at IS NOT NULL AND credits_applied_at IS NULL;

NOTIFY pgrst, 'reload schema';
