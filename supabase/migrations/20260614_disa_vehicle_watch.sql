-- DISA Vehicle Expiry Watch — automate the manual IDIQ/IDV spreadsheet tracking.
--
-- DISA tracks all their vehicles by hand in spreadsheets and manually notifies the
-- incumbent vendor when a vehicle nears expiration. This table holds the watched
-- vehicles so the system can auto-notify the incumbent at 6mo / 90d / 30d instead.
--
-- Prototype: live sends stay behind a dry-run flag until DISA approves the notice
-- voice + vendor list. The dashboard + "would-send" preview run off this table.
--
-- No in-app DDL on this DB — run by hand in Supabase.

CREATE TABLE IF NOT EXISTS disa_watched_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_email TEXT NOT NULL,                 -- the DISA account that owns this watchlist
  vehicle_piid TEXT NOT NULL,              -- PIID / vehicle number
  vehicle_title TEXT,
  incumbent_name TEXT,
  incumbent_uei TEXT,
  incumbent_email TEXT,                    -- the notify target (from DISA's spreadsheet; USASpending lacks it)
  expiration_date DATE,
  ceiling_value NUMERIC,
  naics TEXT,
  agency TEXT,
  notify_6mo BOOLEAN DEFAULT TRUE,
  notify_90d BOOLEAN DEFAULT TRUE,
  notify_30d BOOLEAN DEFAULT TRUE,
  last_notified_stage TEXT,               -- '6mo' | '90d' | '30d' | NULL — so we don't double-send
  last_notified_at TIMESTAMPTZ,
  source TEXT DEFAULT 'upload',           -- 'upload' | 'usaspending'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_email, vehicle_piid)
);

CREATE INDEX IF NOT EXISTS idx_disa_watched_org ON disa_watched_vehicles (org_email);
CREATE INDEX IF NOT EXISTS idx_disa_watched_expiry ON disa_watched_vehicles (expiration_date);
