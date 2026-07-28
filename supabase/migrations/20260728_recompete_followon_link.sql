-- Follow-on capture link (Eric 2026-07-27, the NRWA case).
-- When a tracked recompete contract expires, we look up its already-awarded FOLLOW-ON
-- (same recipient UEI + NAICS, PoP start after the parent's expiry) via USASpending and
-- ingest it as a live recompete row. These columns record the provenance of that capture:
--   predecessor_piid     = the expired parent PIID this row replaced (e.g. '12SAD121C0001')
--   followon_captured_at = when the follow-on capture stamped this row
-- Both NULL on ordinary sync rows; set only on rows the follow-on capture created/updated.
ALTER TABLE recompete_opportunities
  ADD COLUMN IF NOT EXISTS predecessor_piid     text,
  ADD COLUMN IF NOT EXISTS followon_captured_at timestamptz;

-- Fast reverse-lookup: "what replaced this expired contract?" (predecessor_piid -> follow-on row).
CREATE INDEX IF NOT EXISTS idx_recompete_predecessor_piid
  ON recompete_opportunities (predecessor_piid)
  WHERE predecessor_piid IS NOT NULL;
