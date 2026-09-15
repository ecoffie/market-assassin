-- Decision Makers — explicit government/vendor provenance typing.
--
-- ADDITIVE ONLY. Adds one nullable column. Rewrites no row, drops nothing, and does NOT
-- backfill: the backfill is a separate controlled step that runs only after the live producer
-- is deployed writing the value explicitly, so no window exists where new rows land unclassified
-- while old ones are being classified.
--
-- ── WHY A NEW COLUMN RATHER THAN FIXING THE OLD ONES ──
--
-- `source`, `source_table` and `role_category` cannot carry this fact:
--   * `source` and `role_category` are column DEFAULTS no producer ever sets, so they are
--     uniform across all 287,534 rows and carry ZERO information — and they are factually
--     WRONG on the 82,017 vendor rows, which are labelled 'sam_opportunities_poc' /
--     'contracting' despite being neither.
--   * `source_table` is a GENERATION label, not a source identity. Two of its three values
--     (`AllSamContacts`, `sam_opportunities_pointOfContact`) are the SAME upstream source —
--     94.7% of the latter has already been re-adopted in place by the live drain, which is why
--     the control plane's held_population equals the two combined. Overwriting it would destroy
--     real import-lineage history.
--
-- The three concepts are deliberately kept separate:
--   source_table          → generation / import lineage (historical, never rewritten)
--   contact_kind          → customer + product semantics (THIS column, authoritative)
--   data_source_instances → upstream source identity + control plane
--
-- ⚠️ NO DEFAULT, deliberately. A default is exactly how `source` and `role_category` became
-- meaningless: every row inherited a value nobody asserted. NULL here means genuinely
-- unclassified, and every producer must state the kind explicitly.
ALTER TABLE federal_contacts
  ADD COLUMN IF NOT EXISTS contact_kind TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'federal_contacts_contact_kind_check'
  ) THEN
    ALTER TABLE federal_contacts
      ADD CONSTRAINT federal_contacts_contact_kind_check
      CHECK (contact_kind IS NULL OR contact_kind IN ('government_buyer', 'vendor_entity_poc'));
  END IF;
END $$;

COMMENT ON COLUMN federal_contacts.contact_kind IS
  'AUTHORITATIVE government-vs-vendor classification. government_buyer = a named POC on a SAM notice; vendor_entity_poc = a SAM entity-registration POC (UEI + company, no agency, no email). NULL = unclassified. Never defaulted — producers set it explicitly. Do NOT use source/source_table/role_category for this decision: see src/lib/gov-contacts/contact-kind.ts.';
