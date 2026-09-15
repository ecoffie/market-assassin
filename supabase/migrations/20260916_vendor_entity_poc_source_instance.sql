-- Register the FROZEN vendor entity POC source in the Decision Makers control plane.
--
-- The provenance audit proved the domain has TWO sources, not three:
--
--   1. decision_makers_sam_contacts   ACTIVE. SAM notice POCs. Spans BOTH physical generations
--      (`AllSamContacts` and `sam_opportunities_pointOfContact`) because source_table is an
--      IMPORT-GENERATION label, not a source identity — the live drain has re-adopted 94.7% of
--      the older generation in place, and its held_population already equals the two combined.
--
--   2. decision_makers_vendor_entity_pocs   THIS ROW. SAM entity-registration POCs: UEI +
--      company, no agency, no email, no notice. Zero rows touched by the active drain. Different
--      product semantics entirely — these are suppliers, not government decision makers.
--
-- ⚠️ Deliberately NO instance for `sam_opportunities_pointOfContact`. It belongs to source 1.
--
-- CLOCKS ARE NULL ON PURPOSE. This source has NO currentness oracle that can be honestly read:
--   * last_source_advance — SAM publishes no "as of" for entity POCs; the rows carry no
--     posted_date at all (verified: 0/82,017). The only timestamps are Mindy's own import
--     clocks, which say when WE wrote, never when the SOURCE moved.
--   * upstream_population — we hold a one-time export; the live upstream size is unknown and
--     cannot be sampled without a fresh pull.
--   * fingerprint / revision — nothing to compare against.
-- Writing any of them would be a fabricated stamp of exactly the kind the control plane exists
-- to detect. `source_state = 'unmeasured'` is the honest answer.
INSERT INTO data_source_instances (
  dataset_key, source_key, name, discovery_url, ingest_mode, owner,
  watch_cadence_days, source_state, intervention_state, manual_action_type, runbook_path,
  held_population
)
SELECT
  'decision_makers',
  'decision_makers_vendor_entity_pocs',
  'SAM entity registrations → vendor POCs (frozen)',
  'https://sam.gov/content/entity-registration',
  'manual',
  'data-core',
  NULL,
  'unmeasured',
  'none_required',
  NULL,
  'docs/runbooks/decision-makers-sam-contacts.md',
  -- Derived at write time from the AUTHORITATIVE classification, never from source_table and
  -- never hardcoded — the drain is running while this migration applies.
  (SELECT count(*) FROM federal_contacts WHERE contact_kind = 'vendor_entity_poc')
WHERE NOT EXISTS (
  SELECT 1 FROM data_source_instances WHERE source_key = 'decision_makers_vendor_entity_pocs'
);

-- Re-derive the ACTIVE source's held population from contact_kind too, so both instances are
-- measured the same way and neither depends on the generation label.
UPDATE data_source_instances
   SET held_population = (SELECT count(*) FROM federal_contacts WHERE contact_kind = 'government_buyer')
 WHERE source_key = 'decision_makers_sam_contacts';
