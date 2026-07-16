-- add_contacts_to_crm (one-shot CRM push) — per-user CRM connection.
-- Stores the user's OWN GoHighLevel credential so the MCP tool can upsert contacts
-- into THEIR location (bring-your-own token now; provisioned sub-accounts later —
-- `provisioned` flags an agency-created location). The token is AES-256-GCM
-- encrypted at rest (src/lib/crypto/secretbox.ts) — never stored in plaintext.
-- Service-role only (RLS on, no policies → anon/auth clients get nothing).
-- Idempotent; hand-run in the Supabase SQL editor.

create table if not exists user_crm_connections (
  owner_email     text primary key,
  provider        text not null default 'ghl',
  token_encrypted text not null,
  location_id     text not null,
  provisioned     boolean not null default false,  -- true = Mindy provisioned this sub-account under the agency
  label           text,                             -- optional human label (e.g. the GHL sub-account name)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table user_crm_connections enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) reads/writes this.
