-- Linked emails — let a user prove they own a SECOND email and see its billing.
--
-- WHY (Eric, 2026-07-29): "our users do this all the time — buy with one email, sign in with
-- another. This is a standard, not a bug." Today the Billing card looks up ONLY the logged-in
-- email, so a customer who checked out with a different address sees the WRONG subscription
-- (or none) and cannot reach the Stripe portal that owns their real plan.
--
-- Real case that prompted this: Alisha Martin signed in as financiallysanelife@gmail.com,
-- which held an old $99 coaching sub, while her ACTIVE $149 Mindy subscription sat under
-- alishamartin044@gmail.com. Her settings showed "Ongoing Coaching" with a Manage-billing
-- button that could not cancel Mindy. She had to email support; without that she'd have kept
-- being billed.
--
-- WHY NOT AUTO-LINK: nothing in our data connects two emails (separate user_profiles rows, no
-- stripe_customer_id, no purchases rows). Any automatic linkage would be a GUESS, and guessing
-- wrong shows one customer another customer's billing. So the USER asserts the link and PROVES
-- it with an OTP sent to the address being added — the same two_factor_codes pipeline
-- (hashed code, 10-min TTL, 60s throttle) already used by mi-login.
--
-- RELATIONSHIP TO THE IDENTITY PRD: this is a narrow, shippable slice of the same idea as
-- docs/PRD-identity-model.md P1 — "email is an attribute, not the identity". It does NOT
-- re-key anything; it only records additional PROVEN-OWNED addresses for an existing account,
-- so it composes with account_id later rather than competing with it.
CREATE TABLE IF NOT EXISTS account_linked_emails (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The account doing the linking = the email the user is SIGNED IN as.
  owner_email    text NOT NULL,
  -- The additional address they proved they control (e.g. their Stripe checkout email).
  linked_email   text NOT NULL,
  -- NULL until the OTP is confirmed. Nothing reads an unverified row for billing.
  verified_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One link per (owner, linked) pair. Re-requesting just refreshes the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_account_linked_emails_pair
  ON account_linked_emails (lower(owner_email), lower(linked_email));

-- Billing lookup path: "what other addresses has this signed-in user proven?"
CREATE INDEX IF NOT EXISTS idx_account_linked_emails_owner
  ON account_linked_emails (lower(owner_email)) WHERE verified_at IS NOT NULL;

-- ⚠️ ABUSE GUARD — the reverse lookup. Without this, two different people could each link the
-- same address and both see its billing. A verified linked_email may belong to only ONE owner.
-- Enforced as a partial unique index so unverified attempts don't block a legitimate claim.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_account_linked_emails_verified_target
  ON account_linked_emails (lower(linked_email)) WHERE verified_at IS NOT NULL;
