-- DIBBS RFQ store — DLA Internet Bid Board small-buy solicitations.
-- Sourced via the Apify parseforge/dibbs-rfq-scraper actor (US residential proxy
-- beats the DIBBS WAF; our own probe couldn't — memory dla_dibbs_not_feasible).
-- This is the PILOT: prove the data + demand before owning a scraper.
-- Hand-run in Supabase SQL editor (no in-app DDL — rule #6). Idempotent.

CREATE TABLE IF NOT EXISTS dibbs_rfqs (
  solicitation_number TEXT PRIMARY KEY,   -- DIBBS solicitation/RFQ id
  nsn                 TEXT,               -- National Stock Number (13 digits)
  fsc                 TEXT,               -- Federal Supply Classification (4 digits)
  description         TEXT,
  quantity            NUMERIC,
  unit_of_issue       TEXT,
  return_by_date      DATE,               -- bid deadline
  buyer               TEXT,               -- (only when includeDetails=true)
  status              TEXT,
  url                 TEXT,               -- RFQ page on DIBBS
  pdf_url             TEXT,               -- direct solicitation PDF
  raw                 JSONB,              -- full scraped record (future-proof)
  scraped_at          TIMESTAMPTZ,        -- when Apify collected it
  synced_at           TIMESTAMPTZ DEFAULT now()  -- when we upserted it
);

-- Hot queries: by FSC (≈ what's being bought) and by deadline (active RFQs).
CREATE INDEX IF NOT EXISTS idx_dibbs_fsc ON dibbs_rfqs (fsc);
CREATE INDEX IF NOT EXISTS idx_dibbs_return_by ON dibbs_rfqs (return_by_date);
CREATE INDEX IF NOT EXISTS idx_dibbs_nsn ON dibbs_rfqs (nsn);
