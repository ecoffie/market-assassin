CREATE TABLE IF NOT EXISTS opengov_iq_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL DEFAULT 'SAMEntities',
  source_row_key TEXT NOT NULL UNIQUE,
  uei_sam TEXT,
  duns TEXT,
  cage_code TEXT,
  legal_business_name TEXT,
  dba_name TEXT,
  entity_url TEXT,
  entity_structure TEXT,
  physical_city TEXT,
  physical_state TEXT,
  physical_zip TEXT,
  physical_country TEXT,
  business_type_string TEXT,
  sba_business_types_string TEXT,
  primary_naics TEXT,
  naics_code_string TEXT,
  psc_code_string TEXT,
  registration_expiration_date TEXT,
  exclusion_status_flag TEXT,
  government_poc_name TEXT,
  government_poc_title TEXT,
  electronic_poc_name TEXT,
  electronic_poc_title TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opengov_iq_entities_uei ON opengov_iq_entities(uei_sam);
CREATE INDEX IF NOT EXISTS idx_opengov_iq_entities_cage ON opengov_iq_entities(cage_code);
CREATE INDEX IF NOT EXISTS idx_opengov_iq_entities_primary_naics ON opengov_iq_entities(primary_naics);
CREATE INDEX IF NOT EXISTS idx_opengov_iq_entities_state ON opengov_iq_entities(physical_state);
CREATE INDEX IF NOT EXISTS idx_opengov_iq_entities_search ON opengov_iq_entities
  USING GIN (to_tsvector('english', coalesce(legal_business_name, '') || ' ' || coalesce(dba_name, '') || ' ' || coalesce(business_type_string, '') || ' ' || coalesce(naics_code_string, '') || ' ' || coalesce(psc_code_string, '')));

CREATE TABLE IF NOT EXISTS opengov_iq_idiq_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL DEFAULT 'IDIQ_details',
  source_row_key TEXT NOT NULL UNIQUE,
  description TEXT,
  award_id TEXT,
  naics TEXT,
  agency TEXT,
  recipient_uei TEXT,
  recipient_name TEXT,
  ai_generated_text TEXT,
  cleaned_vehicle TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opengov_iq_idiq_award ON opengov_iq_idiq_vehicles(award_id);
CREATE INDEX IF NOT EXISTS idx_opengov_iq_idiq_naics ON opengov_iq_idiq_vehicles(naics);
CREATE INDEX IF NOT EXISTS idx_opengov_iq_idiq_agency ON opengov_iq_idiq_vehicles(agency);
CREATE INDEX IF NOT EXISTS idx_opengov_iq_idiq_recipient ON opengov_iq_idiq_vehicles(recipient_name);
CREATE INDEX IF NOT EXISTS idx_opengov_iq_idiq_search ON opengov_iq_idiq_vehicles
  USING GIN (to_tsvector('english', coalesce(description, '') || ' ' || coalesce(agency, '') || ' ' || coalesce(recipient_name, '') || ' ' || coalesce(cleaned_vehicle, '') || ' ' || coalesce(ai_generated_text, '')));
