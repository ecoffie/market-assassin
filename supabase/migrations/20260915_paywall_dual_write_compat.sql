-- ============================================================================
-- URGENT: restore DATABASE compatibility for the deployed writer (2026-09-15)
--
-- WHAT I BROKE: 20260915_paywall_funnel_stages.sql renamed checkout_started_at →
-- offer_page_opened_at in PRODUCTION while the deployed build still writes the OLD name.
-- The write fails, the call site swallows it in a bare try/catch, the offer page still
-- returns 200 — so funnel stamps have been vanishing with no error anywhere.
-- Measured on prod: opened a real offer page, offer_page_opened_at stayed NULL.
--
-- WHY CODE COULD NOT FIX IT: a source re-export only helps a build that has been
-- deployed. The bundle running RIGHT NOW cannot be changed by editing source, so the
-- transition has to be supported by the DATABASE until the new build ships.
--
-- THE REPAIR: re-introduce checkout_started_at as a real column and keep the two in sync
-- with triggers, so an OLD writer and a NEW writer both land on the same event.
--   old writer → checkout_started_at → trigger mirrors to offer_page_opened_at
--   new writer → offer_page_opened_at → trigger mirrors to checkout_started_at
--
-- Both directions are guarded on IS DISTINCT FROM so the mirror cannot recurse, and
-- first-write-wins matches the .is(col, null) guard the application uses.
--
-- The legacy column is DROPPED only once the new build is confirmed live everywhere —
-- deliberately a separate, later migration. Removing it now would recreate the outage.
-- Idempotent; service_role only.
-- ============================================================================

ALTER TABLE mcp_paywall_attempts
  ADD COLUMN IF NOT EXISTS checkout_started_at timestamptz;

COMMENT ON COLUMN mcp_paywall_attempts.checkout_started_at IS
  'DEPRECATED transition column. Kept ONLY so builds deployed before the funnel-stage rename keep writing successfully; mirrored to offer_page_opened_at by trigger. Drop after the new build is live everywhere. Never read this for analysis — it never meant Stripe checkout.';

-- Backfill any event that arrived under either name before the mirror existed.
UPDATE mcp_paywall_attempts
   SET checkout_started_at = offer_page_opened_at
 WHERE offer_page_opened_at IS NOT NULL AND checkout_started_at IS NULL;

UPDATE mcp_paywall_attempts
   SET offer_page_opened_at = checkout_started_at
 WHERE checkout_started_at IS NOT NULL AND offer_page_opened_at IS NULL;

CREATE OR REPLACE FUNCTION mcp_paywall_mirror_offer_open()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Old writer stamped the legacy column → carry it to the real one.
  IF NEW.checkout_started_at IS NOT NULL
     AND NEW.offer_page_opened_at IS NULL THEN
    NEW.offer_page_opened_at := NEW.checkout_started_at;
  END IF;
  -- New writer stamped the real column → keep the legacy one in step so an old reader
  -- (and the old .is(col, null) guard) still behaves correctly during the window.
  IF NEW.offer_page_opened_at IS NOT NULL
     AND NEW.checkout_started_at IS NULL THEN
    NEW.checkout_started_at := NEW.offer_page_opened_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mcp_paywall_mirror_offer_open ON mcp_paywall_attempts;
CREATE TRIGGER trg_mcp_paywall_mirror_offer_open
  BEFORE INSERT OR UPDATE ON mcp_paywall_attempts
  FOR EACH ROW EXECUTE FUNCTION mcp_paywall_mirror_offer_open();

NOTIFY pgrst, 'reload schema';
