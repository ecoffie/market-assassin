-- Add psc_codes to user_notification_settings so PSC can drive alert matching.
-- PSC = what was actually BOUGHT (the product), the most precise opportunity
-- signal (better than NAICS = who the seller is). Idempotent.
-- Run in the Supabase SQL editor (this DB has no in-app DDL).

alter table user_notification_settings
  add column if not exists psc_codes text[] default '{}'::text[];

-- Optional GIN index so PSC-array overlap filters stay fast at scale.
create index if not exists idx_uns_psc_codes
  on user_notification_settings using gin (psc_codes);
