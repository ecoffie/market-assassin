-- Vault point-of-contact fields (#41) — Proposal Assist placeholdered
-- "[Project Manager Name], [Phone], [Email], [Website]" because user_identity_profile
-- had the company codes (UEI/CAGE) but NO contact-person fields. Real cert
-- packages (Responsible Office / Contact Person) + Point-of-Contact sections need
-- these to fill instead of placeholdering.

ALTER TABLE user_identity_profile
  ADD COLUMN IF NOT EXISTS contact_name    TEXT,   -- the responsible person (e.g. "Eric Coffie")
  ADD COLUMN IF NOT EXISTS contact_title   TEXT,   -- their title (e.g. "Founder / President")
  ADD COLUMN IF NOT EXISTS contact_phone   TEXT,
  ADD COLUMN IF NOT EXISTS contact_email   TEXT,
  ADD COLUMN IF NOT EXISTS website         TEXT,
  ADD COLUMN IF NOT EXISTS office_address  TEXT,   -- office location for the cert package
  ADD COLUMN IF NOT EXISTS bonding_single  TEXT,   -- single bonding capacity
  ADD COLUMN IF NOT EXISTS bonding_aggregate TEXT; -- aggregate bonding capacity
