-- Connected accounts: one row per Mindy user, not per provider account (Agent 4 security review, 2026-11-27).
-- The original key (scope_key, provider, provider_account_id) let a colleague in the same client workspace who
-- connected the same Google / Microsoft account overwrite the first person's row (tokens and owner) on upsert.
-- The key now includes owner_email; store.ts upserts on the same four columns.
--
-- Idempotent and data-preserving: works whether or not 20261124_connected_accounts.sql was already applied (it
-- drops the old constraint only if it exists, and adds the new unique index only if missing). No rows change.
-- Run only via `npm run migrate -- --go --only 20261127_connected_accounts_owner_unique.sql`, after
-- 20261124_connected_accounts.sql, with Agent 4 review and Eric's approval.

do $$
begin
  if to_regclass('public.connected_accounts') is not null
     and exists (select 1 from pg_constraint where conname = 'connected_accounts_scope_key_provider_provider_account_id_key') then
    alter table connected_accounts drop constraint connected_accounts_scope_key_provider_provider_account_id_key;
  end if;
end $$;

do $$
begin
  if to_regclass('public.connected_accounts') is not null then
    create unique index if not exists connected_accounts_owner_account_key
      on connected_accounts (scope_key, provider, provider_account_id, owner_email);
  end if;
end $$;
