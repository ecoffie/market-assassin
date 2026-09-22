-- Create the 'pursuit-documents' Storage bucket.
--
-- WHY: the bucket was never created. Every upload in fetch-pursuit-docs.ts and
-- solicitation-documents.ts has failed with "Bucket not found" for the life of
-- the feature, and because both call sites treat the upload as best-effort and
-- only console.warn, nothing ever surfaced. Measured 2026-09-22:
--   pursuit_documents  = 28,092 rows
--   storage_path NULL  = 28,092  (100% — not one raw file was ever persisted)
--
-- Consequence: get_solicitation_documents advertises a signed download_url to
-- "the full raw PDF" but always degrades to the public SAM link, which is the
-- link that agent clients get blocked on. The raw file is the ONLY way to read
-- past the extraction ceiling, so this is what makes the tail unrecoverable.
--
-- PRIVATE bucket: files are served exclusively through short-lived signed URLs
-- minted server-side. SAM attachments are public federal data, but the stored
-- copy stays private so access goes through our own ownership checks.
insert into storage.buckets (id, name, public, file_size_limit)
values ('pursuit-documents', 'pursuit-documents', false, 20971520) -- 20MB = MAX_FILE_SIZE
on conflict (id) do nothing;

-- Service-role-only access; signed URLs are minted server-side.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'pursuit_documents_service_role'
  ) then
    create policy pursuit_documents_service_role on storage.objects
      for all to service_role
      using (bucket_id = 'pursuit-documents')
      with check (bucket_id = 'pursuit-documents');
  end if;
end $$;
