-- Add SAM.gov fields that we already capture in raw_data but never
-- surface to users. Delivers on the "never go to SAM.gov again"
-- promise by giving users:
--   - the actual attachment files (resourceLinks)
--   - the contracting officer points of contact
--   - the office address
--   - fair-opportunity / J&A info (sole-source justifications, etc.)
--   - additional info link/text (RFP supplement, Q&A page, etc.)
--
-- All stored as JSONB so the sync code can stuff the SAM payload in
-- without flattening every nested array/object.

ALTER TABLE sam_opportunities
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS points_of_contact JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS office_address JSONB,
  ADD COLUMN IF NOT EXISTS fair_opportunity JSONB,
  ADD COLUMN IF NOT EXISTS additional_info_link TEXT,
  ADD COLUMN IF NOT EXISTS additional_info_text TEXT;

COMMENT ON COLUMN sam_opportunities.attachments IS
  'SAM resourceLinks array — each entry has the file URL and metadata. Lets users download solicitation docs, drawings, Q&A, amendments without leaving Mindy.';
COMMENT ON COLUMN sam_opportunities.points_of_contact IS
  'SAM pointOfContact array — contracting officer name, email, phone, type. Drives "who to talk to" for BD outreach.';
COMMENT ON COLUMN sam_opportunities.office_address IS
  'SAM officeAddress object — street address of the contracting office for site visits and physical correspondence.';
COMMENT ON COLUMN sam_opportunities.fair_opportunity IS
  'SAM fairOpportunity object — sole-source justification info (J&A) including reason codes and notices.';
COMMENT ON COLUMN sam_opportunities.additional_info_link IS
  'SAM additionalInfoLink — URL pointing at the RFP supplement, Q&A page, or other off-system reference.';
COMMENT ON COLUMN sam_opportunities.additional_info_text IS
  'SAM additionalInfoText — inline supplemental text that ships with the notice.';

NOTIFY pgrst, 'reload schema';
