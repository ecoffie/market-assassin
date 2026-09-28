-- P0-I — provenance for the canonical company legal name (Eric decision, 2026-09-28, option B).
--
-- Company identity lives in the Vault: user_identity_profile.legal_name. This adds WHERE that
-- value came from, so a typed onboarding name is never mistaken for SAM's registered name and
-- onboarding can never overwrite a SAM-grounded one.
--
--   sam           matches SAM legalBusinessName for the registered UEI
--   user_entered  the owner typed / submitted it
--   admin         set by admin/staff tooling
--   NULL          unknown
--
-- NO BACKFILL, deliberately. Every existing row stays NULL (unknown): nothing on the row proves
-- whether its name came from SAM prefill or was typed, and inferring it is the defect this
-- column exists to prevent. The 22 users whose Vault and workspace names disagree are NOT
-- reconciled here (read-only discrepancy report only).
--
-- Writers: src/lib/vault/legal-name.ts (the only decision point). Idempotent.

ALTER TABLE public.user_identity_profile
  ADD COLUMN IF NOT EXISTS legal_name_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_identity_profile_legal_name_source_chk'
  ) THEN
    ALTER TABLE public.user_identity_profile
      ADD CONSTRAINT user_identity_profile_legal_name_source_chk
      CHECK (legal_name_source IS NULL OR legal_name_source IN ('sam', 'user_entered', 'admin'));
  END IF;
END $$;

COMMENT ON COLUMN public.user_identity_profile.legal_name_source IS
  'Provenance of legal_name: sam | user_entered | admin | NULL = unknown (never inferred). Decided only by src/lib/vault/legal-name.ts.';
