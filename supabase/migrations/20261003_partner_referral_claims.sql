-- SEC-5d (P0, 2026-10-03): the durable record that an account has consumed its ONE promotional
-- partner trial. One row per account, ever (PRIMARY KEY on user_email) — the INSERT is the atomic
-- gate: of two concurrent claims exactly one inserts, the other hits the key and is told
-- "already claimed". Trial expiry is NOT the consumption record; this row is.
--
-- Written only by POST /api/app/partner-referral/claim for a VERIFIED session identity.
-- partner_code preserves attribution (which partner generated the claim).
-- Additive, idempotent, no data movement. The historical pre-fix anonymous MDEAT grants
-- (user_notification_settings.trial_source = 'partner_mdeat') are deliberately NOT copied here;
-- the claim path treats a legacy partner tag as already consumed without touching those rows.

CREATE TABLE IF NOT EXISTS partner_referral_claims (
  user_email      TEXT PRIMARY KEY,
  partner_code    TEXT NOT NULL,
  trial_ends_at   TIMESTAMPTZ NOT NULL,
  identity_method TEXT NOT NULL,
  claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT partner_referral_claims_email_lower CHECK (user_email = lower(btrim(user_email)))
);

CREATE INDEX IF NOT EXISTS idx_partner_referral_claims_partner
  ON partner_referral_claims (partner_code, claimed_at DESC);

ALTER TABLE partner_referral_claims ENABLE ROW LEVEL SECURITY;
-- No policies: service role only (the claim route uses the service-role client).
