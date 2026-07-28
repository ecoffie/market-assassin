-- Contractor capability profiles — "what is this company actually GOOD AT", derived from award
-- history (PRD: docs/PRD-contractor-capability-profiles.md, Phase 1).
--
-- WHY: partner/subcontractor search shows raw codes today (ContractorsPanel renders award totals,
-- a count, and a truncated "NAICS: 541512, 541519, …" string), leaving the user to infer capability
-- themselves. This table holds the answer, precomputed.
--
-- WHY A TABLE AND NOT A LIVE QUERY: the source is the 63M-row BigQuery awards table. A per-request
-- BQ read on a user-facing path is how the June-2026 $2,075 spike happened
-- (tasks/bigquery-cost-spike-2026-06.md). One batched aggregate build (~4.8GB, ~$0.03) writes every
-- row here; all reads are Supabase.
--
-- GROUNDING (rule #1 — the LLM labels, the data supplies facts): every fact column below comes from
-- a coded BigQuery field. The free-text awards.description column is DELIBERATELY EXCLUDED as a
-- capability signal: median 35 chars, dominated by boilerplate ("FEDERAL SUPPLY SCHEDULE CONTRACT"
-- x16,249 rows; "PAPER, TOILET: - SEE ATTACHED DOCUMENT FOR DETAIL."), and it routinely CONTRADICTS
-- the coded fields — nitrile gloves filed under PSC "FLOOR POLISHERS AND VACUUM CLEANING EQUIPMENT".
-- Summarizing it would produce confident nonsense. psc_description / naics_description are populated
-- on 99.998% of FY2023+ rows and ARE the capability vocabulary.
--
-- KEYED ON rollup_uei, NOT recipient_uei: awards carries one row per UEI, and a single company can
-- hold several (measured: "LOCKHEED MARTIN CORPORATION" appears under both H7PNSVNN5827 and
-- KMEVRAKJVBD3 in FY2025 FL alone). recipients_rollup_merged already collapses parent + same-name
-- variants into one canonical company with child_ueis[] — profiles must agree with the contractor
-- SEO pages, which read that same rollup.
CREATE TABLE IF NOT EXISTS contractor_capability_profiles (
  rollup_uei        text PRIMARY KEY,               -- recipients_rollup_merged.rollup_uei
  rollup_name       text NOT NULL,
  child_ueis        text[],                          -- the company's full UEI set (provenance)
  state             text,                            -- firm HQ state, 2-letter

  -- ── FACTS (aggregated from coded BQ columns; never inferred, never LLM) ──────────────
  -- Each element: {code, description, awards, obligated, share}. Top 5 by obligated $.
  -- `description` is the real psc_description/naics_description string from the award row.
  top_pscs          jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_naics         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Each element: {agency, awards, obligated, share}. Top 5 by obligated $.
  top_agencies      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Distinct real set_aside strings this firm has WON. This is award BEHAVIOR, not certification —
  -- see the warning on set_aside_note below.
  set_asides_won    text[],
  award_count       integer NOT NULL DEFAULT 0,
  total_obligated   numeric NOT NULL DEFAULT 0,
  first_award_date  date,
  last_award_date   date,
  -- {"2021": 1234.56, ...} obligated $ per fiscal year → trend/growth without another BQ read.
  fy_totals         jsonb NOT NULL DEFAULT '{}'::jsonb,
  distinct_psc      integer NOT NULL DEFAULT 0,
  distinct_naics    integer NOT NULL DEFAULT 0,
  distinct_agencies integer NOT NULL DEFAULT 0,

  -- ── DERIVED (deterministic + explainable; NOT model output) ─────────────────────────
  -- Top PSC's share of obligated dollars, 0..1. Measured population distribution (FY2023+,
  -- 126,596 contractors): 69.6% >= 0.8, 20.0% in [0.5,0.8), 10.4% < 0.5. Phase-2 acceptance
  -- reproduces that split, which is how we know the scorer matches reality.
  specialty_score   numeric,
  specialty_tier    text CHECK (specialty_tier IN ('specialist','focused','diversified')),
  -- Herfindahl index over PSC dollar shares (1.0 = single PSC). Kept alongside specialty_score
  -- because HHI penalizes a long tail that a top-share alone hides.
  psc_hhi           numeric,
  agency_concentration numeric,                      -- top agency's share of obligated $, 0..1

  -- Phase 2 writes these. Composed from a TEMPLATE over the fact columns above — an LLM may later
  -- polish PHRASING but may never introduce a fact absent from this row.
  capability_label   text,
  capability_summary text,

  -- ⚠️ set-aside CERTIFICATION is NOT derivable from award behavior. recipient_certifications
  -- (20260728) exists precisely because inferring it mislabeled mega-primes — SAIC is 99.7%
  -- full-and-open but showed "SDVOSB · 8(a)" off ~2% edge-case awards. Join to
  -- recipient_certifications (SAM.gov, source of truth) for certs; treat set_asides_won here as
  -- "has won work under these set-aside codes" ONLY, and never render it as a certification.
  set_aside_note    text DEFAULT 'award behavior, not certification — join recipient_certifications for real certs',

  -- ── Phase 3 (embeddings) — columns created now so the drainer needs no second migration ──
  -- number[1536] from OpenAI text-embedding-3-small, stored as jsonb (no pgvector in this DB —
  -- same shape as user_notification_settings.capability_embedding, 20260706).
  capability_embedding          jsonb,
  capability_embed_source_hash  text,                -- sha1(meaning blob) → skip unchanged rows
  capability_embedded_at        timestamptz,

  built_at          timestamptz NOT NULL DEFAULT now(),  -- drives resumability + monthly rebuild
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Partner search: "specialists in my state", "who's focused in X".
CREATE INDEX IF NOT EXISTS idx_ccp_tier_state
  ON contractor_capability_profiles (specialty_tier, state);

-- Rank partner results by proven volume.
CREATE INDEX IF NOT EXISTS idx_ccp_obligated
  ON contractor_capability_profiles (total_obligated DESC);

-- Name search (trigram) — mirrors the pg_trgm pattern already used for sam_opportunities /
-- federal_contacts (20260612_load_reduction_indexes.sql).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_ccp_name_trgm
  ON contractor_capability_profiles USING gin (rollup_name gin_trgm_ops);

-- The Phase-3 embedding drainer claims least-recently-embedded first; NULLs (never embedded) lead.
CREATE INDEX IF NOT EXISTS idx_ccp_embed_queue
  ON contractor_capability_profiles (capability_embedded_at NULLS FIRST);

-- Rebuild/staleness sweeps.
CREATE INDEX IF NOT EXISTS idx_ccp_built_at
  ON contractor_capability_profiles (built_at);

-- Containment queries on the fact JSON (e.g. top_pscs @> '[{"code":"R499"}]').
CREATE INDEX IF NOT EXISTS idx_ccp_top_pscs
  ON contractor_capability_profiles USING gin (top_pscs jsonb_path_ops);
