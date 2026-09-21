-- generate_market_report (one-shot market report) — the persisted deliverable.
-- Sue's workflow: build a whole-market report for a client and send them a LINK.
-- The tool stores the report payload here and returns /reports/<id>; the page
-- re-renders the stored payload with the shared renderer at view time.
--
-- We store the structured PAYLOAD, not the rendered HTML, so template fixes apply
-- to already-shared links (the renderer is deterministic from the payload).
--
-- ⚠️ `id` is an UNGUESSABLE random token, and that is the access control: the page
-- is deliberately PUBLIC so Sue's client can open it without a Mindy login (a
-- capability URL, same model as an unlisted share link). Never make id sequential,
-- and never put anything here the owner wouldn't hand to a client.
--
-- Service-role only (RLS on, no policies → anon/auth clients get nothing); the
-- public page reads via the service role server-side.
-- Idempotent; hand-run in the Supabase SQL editor.

create table if not exists market_reports (
  id           text primary key,               -- 22-char base64url random (crypto.randomBytes(16))
  owner_email  text not null,                  -- the verified MCP caller who generated it
  subject      text not null,                  -- keyword / NAICS / agency the report covers
  client_name  text,                           -- optional label on the deliverable header
  params       jsonb not null default '{}'::jsonb,  -- the input that produced it (reproducibility)
  payload      jsonb not null,                 -- the MarketReportResult (minus deliverable.html)
  created_at   timestamptz not null default now()
);

-- "My reports" listing for an owner, newest first.
create index if not exists market_reports_owner_created_idx
  on market_reports (owner_email, created_at desc);

alter table market_reports enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) reads/writes this.
