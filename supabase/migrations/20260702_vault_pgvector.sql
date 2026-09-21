-- ============================================================================
-- Vault semantic evidence — pgvector substrate (scale-correct, build once)
--
-- Powers the Proposal Assist "requirement -> evidence" matcher: embed every
-- Vault item (past performance, capabilities, key personnel) as a native
-- Postgres vector, and retrieve the best evidence per RFP requirement with an
-- indexed cosine search — instead of JS-side cosine over JSONB (which does not
-- scale to thousands of users x hundreds of rows).
--
-- Model: OpenAI text-embedding-3-small => 1536 dims (matches src/lib/market/embeddings.ts).
--
-- Hand-run in Supabase (this DB has no in-app DDL):
--   paste + run, confirm "Success. No rows returned", then verify the columns
--   exist before the app writes to them.
-- ============================================================================

-- 1) Enable pgvector (idempotent). Supabase ships the extension; this activates it.
create extension if not exists vector;

-- 2) Embedding columns on the three Vault evidence tables.
--    Nullable — a row is embedded on write / by the backfill; NULL = not yet embedded.
alter table user_past_performance    add column if not exists embedding vector(1536);
alter table user_past_performance    add column if not exists embedded_at timestamptz;

alter table user_capabilities_library add column if not exists embedding vector(1536);
alter table user_capabilities_library add column if not exists embedded_at timestamptz;

alter table user_team_members         add column if not exists embedding vector(1536);
alter table user_team_members         add column if not exists embedded_at timestamptz;

-- 3) Approximate-nearest-neighbor indexes (ivfflat, cosine).
--    lists=100 is fine up to ~1M rows/table; revisit only at large scale.
--    Partial index (WHERE embedding IS NOT NULL) keeps it lean while rows backfill.
create index if not exists idx_upp_embedding
  on user_past_performance using ivfflat (embedding vector_cosine_ops) with (lists = 100)
  where embedding is not null;

create index if not exists idx_ucl_embedding
  on user_capabilities_library using ivfflat (embedding vector_cosine_ops) with (lists = 100)
  where embedding is not null;

create index if not exists idx_utm_embedding
  on user_team_members using ivfflat (embedding vector_cosine_ops) with (lists = 100)
  where embedding is not null;

-- 4) Per-user evidence match RPC. Given a query embedding + the owner's email,
--    return the best-matching evidence across ALL THREE tables (full weave),
--    each tagged with its kind + a display label + cosine similarity.
--    Cosine similarity = 1 - cosine_distance (the <=> operator).
--    Owner-scoped: only ever searches the caller's own rows.
create or replace function match_vault_evidence(
  p_email       text,
  p_query       vector(1536),
  p_match_count int default 8,
  p_min_score   float default 0.0
)
returns table (
  kind        text,
  id          uuid,
  label       text,
  detail      text,
  score       float
)
language sql
stable
as $$
  with ranked as (
    -- Past performance
    select
      'past_performance'::text as kind,
      pp.id,
      pp.contract_title as label,
      coalesce(pp.scope_description, '') as detail,
      1 - (pp.embedding <=> p_query) as score
    from user_past_performance pp
    where pp.user_email = p_email
      and pp.archived_at is null
      and pp.embedding is not null

    union all

    -- Capabilities
    select
      'capability'::text,
      c.id,
      c.capability_name,
      coalesce(c.description, ''),
      1 - (c.embedding <=> p_query)
    from user_capabilities_library c
    where c.user_email = p_email
      and c.archived_at is null
      and c.embedding is not null

    union all

    -- Key personnel
    select
      'person'::text,
      t.id,
      t.full_name,
      coalesce(t.bio_short, t.title, ''),
      1 - (t.embedding <=> p_query)
    from user_team_members t
    where t.user_email = p_email
      and t.archived_at is null
      and t.embedding is not null
  )
  select kind, id, label, detail, score
  from ranked
  where score >= p_min_score
  order by score desc
  limit greatest(p_match_count, 1);
$$;

-- 5) Reload PostgREST schema cache so the new columns + RPC are visible immediately.
notify pgrst, 'reload schema';
