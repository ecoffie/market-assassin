-- MCP keyless OAuth 2.1 — authorization-server storage.
-- Idempotent; hand-run by Eric in the Supabase SQL editor, then verified live.
--
-- Three tables back the flow:
--   mcp_oauth_clients  — Dynamic Client Registration (RFC 7591): each MCP client
--                        (Claude Desktop, Cursor, …) self-registers once.
--   mcp_oauth_codes    — short-lived authorization codes (PKCE), single-use.
--   mcp_oauth_tokens   — refresh tokens (hashed). Access tokens are stateless
--                        JWTs (not stored); only refresh tokens live here so they
--                        can be rotated + revoked.
-- All RLS service-role-only — every read/write is server-side.

-- ── Registered clients ─────────────────────────────────────────────────────
create table if not exists public.mcp_oauth_clients (
  client_id                   text primary key,
  client_secret_hash          text,                       -- null for public (PKCE) clients
  client_name                 text,
  redirect_uris               jsonb not null default '[]'::jsonb,
  grant_types                 jsonb not null default '["authorization_code","refresh_token"]'::jsonb,
  token_endpoint_auth_method  text  not null default 'none',
  scope                       text,
  created_at                  timestamptz not null default now()
);

-- ── Authorization codes (PKCE, single-use, short TTL) ──────────────────────
create table if not exists public.mcp_oauth_codes (
  code_hash               text primary key,               -- sha256(code); raw code never stored
  client_id               text not null,
  user_email              text not null,
  redirect_uri            text not null,
  code_challenge          text not null,
  code_challenge_method   text not null default 'S256',
  scope                   text,
  resource                text,                           -- RFC 8707 audience binding
  consumed                boolean not null default false,
  expires_at              timestamptz not null,
  created_at              timestamptz not null default now()
);
create index if not exists mcp_oauth_codes_expires_idx on public.mcp_oauth_codes (expires_at);

-- ── Refresh tokens (hashed, rotated on use, revocable) ─────────────────────
create table if not exists public.mcp_oauth_tokens (
  token_hash    text primary key,                         -- sha256(refresh_token)
  client_id     text not null,
  user_email    text not null,
  scope         text,
  resource      text,
  revoked       boolean not null default false,
  expires_at    timestamptz not null,
  rotated_from  text,                                     -- token_hash this replaced (rotation audit)
  created_at    timestamptz not null default now()
);
create index if not exists mcp_oauth_tokens_user_idx on public.mcp_oauth_tokens (user_email);

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes   enable row level security;
alter table public.mcp_oauth_tokens  enable row level security;

-- Service-role bypasses RLS; these deny-all policies make the intent explicit
-- (no anon/authenticated access to OAuth internals).
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'mcp_oauth_clients' and policyname = 'service_role_only') then
    create policy service_role_only on public.mcp_oauth_clients for all using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'mcp_oauth_codes' and policyname = 'service_role_only') then
    create policy service_role_only on public.mcp_oauth_codes for all using (false) with check (false);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'mcp_oauth_tokens' and policyname = 'service_role_only') then
    create policy service_role_only on public.mcp_oauth_tokens for all using (false) with check (false);
  end if;
end $$;

notify pgrst, 'reload schema';
