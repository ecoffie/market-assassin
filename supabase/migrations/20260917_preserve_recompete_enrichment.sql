-- MINDY-007: spending_by_award returns psc_code / description / psc_description
-- NULL even when requested. The hourly sync upserted those nulls over richer
-- USASpending-detail / BQ fills. A less-complete source must not erase verified
-- enrichment. Incoming non-null values still win (sync may improve known data).
--
-- Idempotent. Safe to re-run.

CREATE OR REPLACE FUNCTION preserve_recompete_enrichment()
RETURNS TRIGGER AS $$
BEGIN
  -- Treat blank the same as NULL: a less-complete source sending '' is not an improvement.
  IF (NEW.psc_code IS NULL OR btrim(NEW.psc_code) = '') AND NULLIF(btrim(COALESCE(OLD.psc_code, '')), '') IS NOT NULL THEN
    NEW.psc_code := OLD.psc_code;
  END IF;
  IF (NEW.psc_description IS NULL OR btrim(NEW.psc_description) = '') AND NULLIF(btrim(COALESCE(OLD.psc_description, '')), '') IS NOT NULL THEN
    NEW.psc_description := OLD.psc_description;
  END IF;
  IF (NEW.description IS NULL OR btrim(NEW.description) = '') AND NULLIF(btrim(COALESCE(OLD.description, '')), '') IS NOT NULL THEN
    NEW.description := OLD.description;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recompete_preserve_enrichment ON recompete_opportunities;
CREATE TRIGGER trg_recompete_preserve_enrichment
  BEFORE UPDATE ON recompete_opportunities
  FOR EACH ROW
  EXECUTE FUNCTION preserve_recompete_enrichment();
