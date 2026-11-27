-- Rules knowledge base + source register ("How the Government Buys Now", Eric 2026-11-27).
--
-- One row per claim (KB-1 … KB-16 today). Doubles as the SOURCE REGISTER of Eric's hardening plan (Fix 1): every
-- claim a report section can make carries its source, the date it was last confirmed (verified_on), how often it must
-- be re-confirmed (recheck_interval_days; 0 = before every use) and a status. Reports call the pre-ship check
-- (src/lib/knowledge/rules-kb.ts checkClaims) and must re-verify or drop a stale / superseded / unverified claim.
--
-- Written ONLY by scripts/kb/ingest-rules-kb.ts (dry by default; --go upserts by claim_id). Text fields are Eric's
-- file verbatim (docs/knowledge/how-government-buys-now-2026-11-27.md); `sources` carries each official source's own
-- passage from the committed snapshot (…sources.json), so Mindy cites the rule, not a summary.
--
-- Idempotent and additive: new table only. Apply with `npm run migrate -- --go --only 20261127_kb_rule_claims.sql`.

CREATE TABLE IF NOT EXISTS kb_rule_claims (
  claim_id              text PRIMARY KEY CHECK (claim_id ~ '^KB-([CX])?[0-9]+$'),  -- KB-n rules, KB-Cn consortia, KB-Xn other checks
  kb_doc                text NOT NULL,                 -- the repo file the claim comes from
  entry_no              int  NOT NULL,
  part                  text NOT NULL CHECK (part IN ('A', 'B', 'C', 'D')),  -- D = Fix 1C verification rows
  claim                 text NOT NULL,                 -- the entry heading: one sentence a report can carry
  change                text,
  source_text           text,
  status_text           text,
  affects               text,
  common_mistake        text,
  how_to_use            text,
  practice_text         text,                          -- Part C only (GovCon Giants practice, not law)
  -- [{url, kind: official|official_mirror|secondary, fetch_status: ok|fetch_failed|not_fetched_secondary,
  --   passage, fetched_from, fetched_at, fetch_error, absent_phrases}]  (consortium_primary for Fix 1C rows)
  sources               jsonb NOT NULL DEFAULT '[]'::jsonb,
  legal_status          text NOT NULL CHECK (legal_status IN (
                          'final_rule', 'class_deviation', 'proposed_rule', 'statute', 'withdrawn',
                          'executive_order', 'omb_memo', 'agency_memo', 'regulation', 'practice', 'operational_fact')),
  effective_date        date,
  verified              boolean NOT NULL,              -- false when the entry carries any [Not fully verified] tag
  caveats               text[] NOT NULL DEFAULT '{}',  -- every [Not fully verified: …] caveat, verbatim
  -- Source register (Fix 1A)
  verified_on           date NOT NULL,
  recheck_interval_days int  NOT NULL CHECK (recheck_interval_days >= 0),
  status                text NOT NULL CHECK (status IN ('current', 'superseded', 'unverified', 'pending')),
  supersedes            text,
  superseded_by         text,
  notes                 text,
  -- Retrieval: the claim's own words + official passages, written by the ingest.
  search_text           text NOT NULL,
  search_tsv            tsvector GENERATED ALWAYS AS (to_tsvector('english', search_text)) STORED,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_rule_claims_search ON kb_rule_claims USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_kb_rule_claims_status ON kb_rule_claims (status);

ALTER TABLE kb_rule_claims ENABLE ROW LEVEL SECURITY; -- service role only; no client policies

COMMENT ON TABLE kb_rule_claims IS
  'Rules KB + source register (Eric 2026-11-27). Claims with official passages, legal status, verified_on and recheck interval. Written only by scripts/kb/ingest-rules-kb.ts.';

NOTIFY pgrst, 'reload schema';
