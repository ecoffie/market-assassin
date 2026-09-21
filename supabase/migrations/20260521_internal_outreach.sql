-- Internal outreach CRM tables.
--
-- Per MI-INTERNAL-COMMAND-CENTER-PRD §8 (docs/strategy/
-- MI-INTERNAL-COMMAND-CENTER-PRD.md). Sikander and Annelle currently
-- run their outreach from ANNELLE-SIKANDER-QUALIFIED-CUSTOMER-
-- OUTREACH.csv in the workspace root. Moving the source-of-truth to
-- Postgres so:
--   - the Launch Command Center can read live status (instead of stale
--     CSV exports)
--   - call notes are queryable / tied back to contacts
--   - tags are first-class so segment definitions don't drift
--   - last_contacted_at / next_action surfaces in the activation queues
--
-- Admin-only access. No RLS — accessed only via SUPABASE_SERVICE_
-- ROLE_KEY from /api/admin/* routes that already gate on the admin
-- password.

CREATE TABLE IF NOT EXISTS internal_outreach_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Email is the natural key tying back to user_notification_settings
  -- and Stripe customers. Case-insensitive uniqueness via citext or a
  -- lowercase index.
  email TEXT NOT NULL,
  name TEXT,
  company TEXT,
  -- Free-text segment (Recent Ultimate Buyer, MI Buyer, FHC Tool
  -- Buyer, etc.) — matches PRD §6 segment vocabulary.
  segment TEXT,
  score INT,
  -- Where this row came from: 'csv_import', 'stripe_webhook',
  -- 'manual', 'qualification_agent', etc.
  source TEXT,
  -- Annelle / Sikander / Branden / unassigned.
  owner TEXT,
  -- Workflow status: 'queued', 'invited', 'replied', 'call_booked',
  -- 'called', 'no_response', 'wrong_fit', 'won', 'lost'.
  status TEXT,
  recommended_ask TEXT,
  next_action TEXT,
  last_contacted_at TIMESTAMPTZ,
  call_booked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Email uniqueness, case-insensitive. Allows ON CONFLICT (email_lower)
-- in upsert paths.
CREATE UNIQUE INDEX IF NOT EXISTS internal_outreach_contacts_email_lower_uniq
  ON internal_outreach_contacts (LOWER(email));

CREATE INDEX IF NOT EXISTS internal_outreach_contacts_owner_idx
  ON internal_outreach_contacts (owner);
CREATE INDEX IF NOT EXISTS internal_outreach_contacts_status_idx
  ON internal_outreach_contacts (status);
CREATE INDEX IF NOT EXISTS internal_outreach_contacts_score_idx
  ON internal_outreach_contacts (score DESC NULLS LAST);

-- Per-contact notes. Multiple notes per contact, each tied to whoever
-- wrote it. note_type lets us distinguish "call summary" vs "email
-- reply" vs "general observation."
CREATE TABLE IF NOT EXISTS internal_outreach_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES internal_outreach_contacts(id) ON DELETE CASCADE,
  owner TEXT,
  note_type TEXT, -- 'call', 'email', 'observation', 'meeting'
  summary TEXT,
  what_they_value TEXT,
  what_confused_them TEXT,
  what_they_want_added TEXT,
  next_action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS internal_outreach_notes_contact_idx
  ON internal_outreach_notes (contact_id, created_at DESC);

-- Tags. Many-to-many between contacts and tag strings. PRD specifies
-- per-row tag entries (not arrays) so we can index by tag and query
-- "all contacts with tag X."
CREATE TABLE IF NOT EXISTS internal_outreach_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES internal_outreach_contacts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS internal_outreach_tags_contact_tag_uniq
  ON internal_outreach_tags (contact_id, LOWER(tag));
CREATE INDEX IF NOT EXISTS internal_outreach_tags_tag_idx
  ON internal_outreach_tags (LOWER(tag));

-- updated_at trigger for contacts (notes/tags are append-only so they
-- don't need it).
CREATE OR REPLACE FUNCTION internal_outreach_contacts_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS internal_outreach_contacts_updated_at ON internal_outreach_contacts;
CREATE TRIGGER internal_outreach_contacts_updated_at
  BEFORE UPDATE ON internal_outreach_contacts
  FOR EACH ROW EXECUTE FUNCTION internal_outreach_contacts_set_updated_at();

NOTIFY pgrst, 'reload schema';

COMMENT ON TABLE internal_outreach_contacts IS
  'CRM table for Sikander/Annelle/Branden outreach. Replaces ANNELLE-SIKANDER-QUALIFIED-CUSTOMER-OUTREACH.csv as source of truth. See docs/strategy/MI-INTERNAL-COMMAND-CENTER-PRD.md §8.';
COMMENT ON TABLE internal_outreach_notes IS
  'Append-only call / email / observation notes per contact.';
COMMENT ON TABLE internal_outreach_tags IS
  'Many-to-many tag system for contacts. Tags are case-insensitive unique per contact.';
