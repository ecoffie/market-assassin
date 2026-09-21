-- Cert provenance (Eric #3, 2026-07-28) — distinguish "SBA-certified" (authoritative) from "SAM
-- self-identified" for each set-aside, so we STOP presenting a self-cert flag as if it were the
-- authoritative VetCert/SBA determination. From real-run feedback: a VetCert-certified SDVOSB read
-- hasSDVOSB:false because we only read SAM's self-cert sbaBusinessTypeList.
--
-- What we KNOW from SAM v3 today (verified in entity-api.ts):
--   • 8(a)  → code A6 "SBA Certified 8(a) Program Participant"  → AUTHORITATIVE
--   • HUBZone → code XX "SBA Certified HUBZone Firm"            → AUTHORITATIVE
--   • SDVOSB / WOSB → derived from the self-identified description field → SELF-CERT (not SBA-cert)
--
-- These columns record, per cert, WHERE the signal came from ('sba' = SBA-certified code, 'self' =
-- SAM self-identified, 'vetcert' = future SBA VetCert ingest). The VetCert DATA ingest is a follow-up
-- (SBA has no clean public REST API; DSBS/cert-dataset source TBD) — but the schema + labeling ship now.

ALTER TABLE recipient_certifications
  ADD COLUMN IF NOT EXISTS is_8a_source     text,   -- 'sba' | 'self' | 'vetcert' | null(unknown)
  ADD COLUMN IF NOT EXISTS is_sdvosb_source text,
  ADD COLUMN IF NOT EXISTS is_wosb_source   text,
  ADD COLUMN IF NOT EXISTS is_hubzone_source text,
  -- When the authoritative SBA VetCert source was last checked for this UEI (null until ingested).
  ADD COLUMN IF NOT EXISTS vetcert_checked_at timestamptz;

-- Backfill provenance for the rows we already have, from what SAM's codes tell us today:
--   8(a) + HUBZone come from SBA-certified codes → 'sba'; SDVOSB + WOSB from the self-id field → 'self'.
-- Only stamp a source where the flag is actually true (a false flag has no source to record).
UPDATE recipient_certifications SET is_8a_source     = 'sba'  WHERE is_8a     = true AND is_8a_source     IS NULL;
UPDATE recipient_certifications SET is_hubzone_source = 'sba' WHERE is_hubzone = true AND is_hubzone_source IS NULL;
UPDATE recipient_certifications SET is_sdvosb_source = 'self' WHERE is_sdvosb  = true AND is_sdvosb_source IS NULL;
UPDATE recipient_certifications SET is_wosb_source   = 'self' WHERE is_wosb    = true AND is_wosb_source   IS NULL;
