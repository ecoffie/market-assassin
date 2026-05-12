CREATE TABLE IF NOT EXISTS opengov_iq_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL DEFAULT 'AllSamContacts',
  source_row_key TEXT NOT NULL UNIQUE,
  contact_fullname TEXT,
  contact_title TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  department_ind_agency TEXT,
  office TEXT,
  sub_tier TEXT,
  posted_date TEXT,
  solicitation_number TEXT,
  raw_data JSONB DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_opengov_iq_contacts_search ON opengov_iq_contacts
  USING GIN (to_tsvector('english', coalesce(contact_fullname, '') || ' ' || coalesce(contact_title, '') || ' ' || coalesce(department_ind_agency, '') || ' ' || coalesce(office, '') || ' ' || coalesce(sub_tier, '')));
CREATE INDEX IF NOT EXISTS idx_opengov_iq_contacts_agency ON opengov_iq_contacts(department_ind_agency);
CREATE INDEX IF NOT EXISTS idx_opengov_iq_contacts_email ON opengov_iq_contacts(contact_email);
