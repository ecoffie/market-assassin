-- Access grant audit trail.
--
-- WHY: on 2026-07-30 staff reported that "many new people have not been getting access"
-- and were granting it by hand. That report could not be verified OR refuted, because
-- /api/admin/grant-briefings (and 10 sibling grant endpoints) called kv.set() and recorded
-- NOTHING — no actor, no timestamp, no reason. A manual grant left byte-identical state to
-- an automatic one, so:
--   • we cannot count how often provisioning actually fails
--   • we cannot tell which buyers were rescued by staff
--   • a fix cannot be proven to work, because the failure was never measurable
--
-- Every access grant / revoke now writes one row here. This table is the evidence.

create table if not exists access_grants (
  id            uuid primary key default gen_random_uuid(),

  -- WHO received it
  email         text        not null,

  -- WHAT changed. capability: 'briefings' | 'ma' | 'ospro' | 'team' | 'recompete' | …
  capability    text        not null,
  action        text        not null default 'grant',   -- 'grant' | 'revoke'
  tier          text,

  -- HOW it happened. This is the column that answers the staff question:
  --   'stripe_webhook'  = automatic, on payment (the path that is supposed to work)
  --   'admin_manual'    = a human fixed it by hand  ← the signal we were blind to
  --   'admin_bulk'      = a sweep/backfill endpoint
  --   'trial' | 'comp'  = granted without payment
  source        text        not null,

  -- WHO did it (admin endpoints are password-auth'd, so this is best-effort)
  actor         text,
  reason        text,

  -- WHERE it was written, so a KV/Supabase split is visible
  wrote_kv      boolean     not null default false,
  wrote_profile boolean     not null default false,

  -- Correlate a manual rescue back to the sale it should have provisioned
  stripe_session_id text,
  metadata      jsonb,

  created_at    timestamptz not null default now()
);

comment on table access_grants is
  'Audit trail for every access grant/revoke. source=admin_manual identifies grants a human had to perform because automatic provisioning did not land.';

create index if not exists idx_access_grants_email_created
  on access_grants (lower(email), created_at desc);

create index if not exists idx_access_grants_source_created
  on access_grants (source, created_at desc);

create index if not exists idx_access_grants_capability
  on access_grants (capability, created_at desc);

-- Service-role only; never client-readable (it names paying customers).
alter table access_grants enable row level security;

-- Verify:
select column_name, data_type
  from information_schema.columns
 where table_name = 'access_grants'
 order by ordinal_position;
