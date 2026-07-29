-- proposal_jobs — async job queue for one_click_proposal (FM-P03, 2026-07-28).
--
-- one_click_proposal chains 5 sequential LLM passes and exceeds the 60s MCP gateway window on a real
-- RFP. Fix: the tool inserts a QUEUED job here + returns the id immediately; a dispatcher-fired worker
-- drains queued jobs and runs the full pipeline with a long maxDuration; the caller polls
-- get_proposal_job by id for status + the finished payload.
--
-- The id IS the access key (unguessable). owner_email scopes ownership (the verified MCP caller).
create table if not exists proposal_jobs (
  id            text primary key,                    -- 22-char base64url capability token
  owner_email   text not null,
  status        text not null default 'queued',      -- queued | running | done | error
  input         jsonb not null,                       -- { notice_id?, rfp_text?, agency?, title? }
  result        jsonb,                                -- the OneClickProposalResult payload when done
  error         text,                                 -- message when status='error'
  attempts      int  not null default 0,
  locked_at     timestamptz,                          -- worker lease (stale lock reclaim)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The worker pulls the oldest queued (or stale-locked) job cheaply.
create index if not exists proposal_jobs_queue_idx
  on proposal_jobs (status, created_at)
  where status in ('queued', 'running');

-- Owner can list their own jobs.
create index if not exists proposal_jobs_owner_idx on proposal_jobs (owner_email, created_at desc);

alter table proposal_jobs enable row level security;
-- Service-role only (all access is through the MCP tools / worker with the service key).
drop policy if exists proposal_jobs_service_all on proposal_jobs;
create policy proposal_jobs_service_all on proposal_jobs
  for all to service_role using (true) with check (true);
