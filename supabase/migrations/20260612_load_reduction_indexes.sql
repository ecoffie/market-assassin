-- Load-reduction indexes (June 2026). Idempotent.
-- Non-concurrent version: runs in one shot in the Supabase SQL editor.
-- Each CREATE INDEX briefly locks its table for writes while building (seconds).
-- Run during low traffic.

create extension if not exists pg_trgm;

-- sam_opportunities: keyword search hits title + description with ilike '%kw%'
create index if not exists idx_sam_opps_title_trgm
  on sam_opportunities using gin (title gin_trgm_ops);
create index if not exists idx_sam_opps_desc_trgm
  on sam_opportunities using gin (description gin_trgm_ops);

-- sam_opportunities: posted_date ordered on, no index
create index if not exists idx_sam_opps_posted_date
  on sam_opportunities (posted_date desc);

-- sam_opportunities: looked up by solicitation_number via .in(...)
create index if not exists idx_sam_opps_sol_num
  on sam_opportunities (solicitation_number);

-- federal_contacts (125K rows): agency/office/name searched with ilike '%x%'
create index if not exists idx_fed_contacts_agency_trgm
  on federal_contacts using gin (department_ind_agency gin_trgm_ops);
create index if not exists idx_fed_contacts_office_trgm
  on federal_contacts using gin (office gin_trgm_ops);
create index if not exists idx_fed_contacts_name_trgm
  on federal_contacts using gin (contact_fullname gin_trgm_ops);
