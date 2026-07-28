-- Authoritative set-aside certifications by UEI, from SAM.gov's entity registry (Eric 2026-07-28).
-- The company set-aside chips were INFERRED from award behavior, which mislabeled mega-primes (SAIC,
-- 99.7% full-and-open, showed "SDVOSB · 8(a)" off 2% edge-case awards). SAM.gov is the SOURCE OF TRUTH
-- for a firm's real SBA certifications — this table caches getEntityByUEI() results so the map reads
-- authoritative certs, not a guess, without a live (10/min-limited) SAM call per pin.
--
-- One row per UEI. `checked_at` = when we last asked SAM. `found` distinguishes "SAM has no record"
-- (found=false — a firm not registered, or a bad UEI) from "registered but holds no small-biz cert"
-- (found=true, all four booleans false — exactly SAIC). A NULL boolean = we haven't resolved it.
CREATE TABLE IF NOT EXISTS recipient_certifications (
  uei          text PRIMARY KEY,
  found        boolean NOT NULL DEFAULT false,     -- did SAM return an entity for this UEI?
  legal_name   text,                                -- SAM's legalBusinessName (sanity/debugging)
  is_8a        boolean,                             -- 8(a) Business Development (SBA-certified)
  is_sdvosb    boolean,                             -- Service-Disabled Veteran-Owned Small Business
  is_wosb      boolean,                             -- Women-Owned Small Business (incl. EDWOSB)
  is_hubzone   boolean,                             -- HUBZone (SBA-certified)
  sba_business_types text[],                        -- raw SBA business-type labels from SAM (provenance)
  checked_at   timestamptz NOT NULL DEFAULT now(),  -- last SAM lookup — drives the refresh window
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The backfill/refresh queue reads least-recently-checked first.
CREATE INDEX IF NOT EXISTS idx_recipient_cert_checked
  ON recipient_certifications (checked_at);

-- Fast "does this firm hold ANY small-biz cert" filter for the map chip lookup.
CREATE INDEX IF NOT EXISTS idx_recipient_cert_any
  ON recipient_certifications (uei)
  WHERE is_8a OR is_sdvosb OR is_wosb OR is_hubzone;

-- Service-role only (same posture as sam_api_cache / recipient tables).
ALTER TABLE recipient_certifications ENABLE ROW LEVEL SECURITY;
