-- Decision Makers — source 1: control-plane registration + durable checkpoint.
--
-- Additive only. Creates nothing that existing code reads, changes no contact row, and
-- drops nothing.
--
-- The keyset INDEX this source needs lives in its own sibling file
-- (20260915_decision_makers_keyset_index.sql) because CREATE INDEX CONCURRENTLY cannot run in
-- a transaction block — and the runner sends a multi-statement file as one simple query, which
-- Postgres wraps in an implicit transaction regardless of the no-transaction directive. So a
-- CONCURRENTLY statement must be ALONE in its file, not merely flagged.

-- ── 1. The dataset. data_source_instances.dataset_key is a FK to data_sources(key), so the
--       domain must exist before an instance can be registered against it.
INSERT INTO data_sources (key, name, category, built_from, refresh_cadence, notes)
VALUES (
  'decision_makers',
  'Decision makers (federal buying-office contacts)',
  'built_curated',
  'sam_opportunities.points_of_contact',
  'daily',
  'Named government POCs on SAM notices. Producer: /api/cron/sync-gov-buyer-data?pull=contacts.'
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. The durable checkpoint.
--
-- One row per lane. The backfill lane advances a keyset cursor over
-- (sam_opportunities.created_at, notice_id); the refresh lane has no cursor (it re-reads a
-- bounded recent window every run) but keeps its own counters so the two lanes stay
-- independently explainable.
--
-- `cursor_created_at`/`cursor_notice_id` are the position ALREADY PROCESSED — the next run
-- reads strictly greater. NULL means "never started", which is distinct from "finished"
-- (pass_completed_at IS NOT NULL). Never collapse those two.
CREATE TABLE IF NOT EXISTS decision_makers_sync_state (
  lane                TEXT PRIMARY KEY CHECK (lane IN ('backfill', 'refresh')),
  cursor_created_at   TIMESTAMPTZ,
  cursor_notice_id    TEXT,
  -- Set when the lane reaches the end of the eligible corpus. Cleared when it restarts.
  pass_completed_at   TIMESTAMPTZ,
  pass_number         INTEGER NOT NULL DEFAULT 1 CHECK (pass_number > 0),
  -- Cumulative, for an explainable run history without a second table.
  notices_scanned     BIGINT  NOT NULL DEFAULT 0 CHECK (notices_scanned >= 0),
  contacts_inserted   BIGINT  NOT NULL DEFAULT 0 CHECK (contacts_inserted >= 0),
  contacts_updated    BIGINT  NOT NULL DEFAULT 0 CHECK (contacts_updated >= 0),
  contacts_unchanged  BIGINT  NOT NULL DEFAULT 0 CHECK (contacts_unchanged >= 0),
  last_run_at         TIMESTAMPTZ,
  last_error          TEXT,
  -- Concurrency lease. The 'backfill' row's lease governs the WHOLE source run (both lanes),
  -- so there is exactly one checkpoint owner. Acquired by a conditional UPDATE, which is
  -- atomic under the row lock; expiry means a crashed run self-heals instead of wedging.
  -- Deliberately in Postgres next to the cursor rather than in KV: KV has a documented
  -- monthly quota, and a lock that fails open would let two runs advance one cursor.
  lease_owner         TEXT,
  lease_expires_at    TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO decision_makers_sync_state (lane) VALUES ('backfill'), ('refresh')
ON CONFLICT (lane) DO NOTHING;

COMMENT ON TABLE decision_makers_sync_state IS
  'Checkpoint for the SAM buyer-contact source. backfill = keyset drain over (created_at, notice_id); refresh = bounded recent window. See src/lib/gov-contacts/buyer-contact-source.ts for why the cursor is created_at and not posted_date.';

-- ── 4. The source instance.
--
-- Clocks are left NULL on purpose. NULL means UNMEASURED — the runner sets each one only
-- when it has real evidence for it. Seeding them with now() would be exactly the
-- "stamp ahead of the data" defect the control plane exists to detect.
--
-- upstream_population and held_population are also NULL here; the first run measures both.
INSERT INTO data_source_instances (
  dataset_key, source_key, name, discovery_url, ingest_mode, owner,
  watch_cadence_days, source_state, intervention_state, manual_action_type, runbook_path
)
VALUES (
  'decision_makers',
  'decision_makers_sam_contacts',
  'SAM notice points-of-contact → federal_contacts',
  'https://sam.gov/opportunities',
  'automated',
  'data-core',
  1,
  'unmeasured',
  'none_required',
  NULL,
  'docs/runbooks/decision-makers-sam-contacts.md'
)
ON CONFLICT (source_key) DO NOTHING;

-- ── 5. Upstream population oracle.
--
-- `held_population` counts contact ROWS, so `upstream_population` must count the same unit:
-- POC SLOTS that clear the email-or-phone gate. PostgREST cannot express
-- `LATERAL jsonb_array_elements`, and a population in a different unit (notices vs rows)
-- would make the held-vs-upstream deficit meaningless, so the count lives here as a
-- function the runner calls. STABLE + read-only.
--
-- The remaining deficit after this is the NAME-QUALITY rejection ("Telephone: 7175503112"
-- placeholders and buyer-lookup paragraphs), which every run reports separately rather than
-- folding into the population — so a deficit is explainable instead of looking like lost ingest.
CREATE OR REPLACE FUNCTION decision_makers_upstream_slots()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::bigint
  FROM sam_opportunities o,
       LATERAL jsonb_array_elements(o.points_of_contact) e
  WHERE o.points_of_contact IS NOT NULL
    AND (coalesce(e->>'email', '') <> '' OR coalesce(e->>'phone', '') <> '');
$$;
