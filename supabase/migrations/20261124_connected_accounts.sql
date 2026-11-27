-- Connected business apps (Google Workspace / Microsoft 365), Slice A: per-scope connected accounts.
-- Spec: docs/connected-apps/CONNECTED-APPS-SPEC-2026-11-24.md.
--
-- A connection belongs to an ACTING SCOPE (`own:<email>` or `ws:<workspaceId>`, from the same resolver Vault and
-- chat use), never just a browser session: one customer's account can never answer for another workspace.
-- Refresh/access tokens are AES-256-GCM encrypted at rest (src/lib/crypto/secretbox.ts); never logged, never in
-- chat or model context. Service-role only (RLS on, no policies). Idempotent. NOT applied: needs Eric's approval
-- and is run only via `npm run migrate -- --go --only 20261124_connected_accounts.sql`.

create table if not exists connected_accounts (
  id                   uuid primary key default gen_random_uuid(),
  provider             text not null check (provider in ('google', 'microsoft')),
  provider_account_id  text not null,                 -- immutable provider id (Google sub / Graph user id)
  connected_email      text not null,                 -- the account the customer chose, shown in the UI
  display_name         text,
  owner_email          text not null,                 -- Mindy user who connected it (verified at /start)
  scope_key            text not null,                 -- acting scope: own:<email> | ws:<workspaceId>
  granted_scopes       text[] not null default '{}',
  refresh_token_enc    text,                          -- secretbox ciphertext
  access_token_enc     text,                          -- secretbox ciphertext (short-lived cache)
  access_expires_at    timestamptz,
  status               text not null default 'connected' check (status in ('connected', 'reauth_needed', 'revoked')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (scope_key, provider, provider_account_id)
);

create index if not exists connected_accounts_scope_idx on connected_accounts (scope_key, status);

alter table connected_accounts enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) reads/writes this.
