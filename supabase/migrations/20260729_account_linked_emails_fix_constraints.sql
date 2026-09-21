-- Fix-up for 20260729_account_linked_emails.sql — make the uniqueness targetable by upsert.
--
-- WHY: the first migration used expression indexes on lower(owner_email)/lower(linked_email).
-- Those enforce uniqueness correctly, but PostgREST's `upsert(..., { onConflict: 'a,b' })`
-- can only name PLAIN COLUMNS — an expression index is not a valid ON CONFLICT target.
-- Verified live before shipping: every upsert failed with
--     42P10  there is no unique or exclusion constraint matching the ON CONFLICT specification
-- so the link row was never written and the feature would have silently done nothing.
--
-- FIX: emails are stored ALREADY NORMALIZED (lower+trim, done in linked-emails.ts), so plain
-- column constraints are equivalent to the lower() ones while remaining upsert-targetable.
-- A CHECK keeps the invariant honest rather than trusting the app layer alone.

-- Belt-and-braces: normalize anything already present (table is new, so typically a no-op).
UPDATE account_linked_emails
   SET owner_email  = lower(trim(owner_email)),
       linked_email = lower(trim(linked_email))
 WHERE owner_email <> lower(trim(owner_email))
    OR linked_email <> lower(trim(linked_email));

-- Replace the expression indexes with plain-column equivalents.
DROP INDEX IF EXISTS uniq_account_linked_emails_pair;
DROP INDEX IF EXISTS uniq_account_linked_emails_verified_target;
DROP INDEX IF EXISTS idx_account_linked_emails_owner;

-- Upsert target: one row per (owner, linked) pair.
ALTER TABLE account_linked_emails
  DROP CONSTRAINT IF EXISTS account_linked_emails_pair_key;
ALTER TABLE account_linked_emails
  ADD CONSTRAINT account_linked_emails_pair_key UNIQUE (owner_email, linked_email);

-- ABUSE GUARD (unchanged intent): a VERIFIED address may belong to only one owner, so two
-- people cannot both claim the same email and read each other's billing. Still a partial index
-- because unverified attempts must not block a legitimate claim.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_account_linked_emails_verified_target
  ON account_linked_emails (linked_email) WHERE verified_at IS NOT NULL;

-- Hot path: "which addresses has this signed-in user proven?"
CREATE INDEX IF NOT EXISTS idx_account_linked_emails_owner
  ON account_linked_emails (owner_email) WHERE verified_at IS NOT NULL;

-- Enforce the normalization the app promises.
ALTER TABLE account_linked_emails
  DROP CONSTRAINT IF EXISTS account_linked_emails_normalized_chk;
ALTER TABLE account_linked_emails
  ADD CONSTRAINT account_linked_emails_normalized_chk
  CHECK (owner_email = lower(owner_email) AND linked_email = lower(linked_email)
         AND owner_email <> linked_email);
