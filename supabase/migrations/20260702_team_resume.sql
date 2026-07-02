-- Key Personnel resume upload — store the source resume file alongside the
-- parsed fields. File lives in the private Supabase Storage bucket 'vault-assets';
-- we keep only the object key (storage_path) + original filename here and mint a
-- signed URL on demand (bucket is private). Hand-run in Supabase SQL editor
-- (no in-app DDL — rule #6). Idempotent.
alter table user_team_members
  add column if not exists resume_storage_path text,
  add column if not exists resume_filename     text;

-- Make PostgREST see the new columns immediately.
notify pgrst, 'reload schema';
