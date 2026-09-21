-- Opportunity DNA — persist the genome so the STRATEGY FILTER can run over the WHOLE corpus.
--
-- WHY: the genome (src/lib/opportunities/genome.ts) is computed live per pin today, so a filter over
-- it could only ever narrow the CURRENT viewport page (~400 pins). To let a contractor filter the
-- entire opportunity corpus by STRATEGY — "show me Repeat Buyers + Set-Aside + Closes Soon", not
-- "NAICS 541330" — the strands must be stored on the row and filtered with a WHERE. This is the
-- differentiator: you stop filtering by classification code and start filtering by how you WIN.
--
-- SHAPE: two columns, both nullable (metadata-only ALTER, safe on the live 88K-row table):
--   • opportunity_dna       JSONB   — the FULL genome array ([{category,key,label,tone,tier}, ...]),
--                                     the exact computeGenome() output. Rendered surfaces + audits
--                                     read this. Kept so the persisted genome is a faithful copy of
--                                     the live one (no lossy re-derivation).
--   • opportunity_dna_keys  TEXT[]  — JUST the strand keys (['repeat_buyer','set_aside',...]). This
--                                     is what the strategy filter queries. A TEXT[] with a GIN index
--                                     gives a clean, fast containment/overlap predicate:
--                                       •  opportunity_dna_keys @> ARRAY['repeat_buyer','set_aside']  (has ALL — AND)
--                                       •  opportunity_dna_keys && ARRAY['repeat_buyer','set_aside']  (has ANY — OR)
--                                     far simpler + faster than JSONB path queries for "has strand X".
--   • dna_computed_at       TIMESTAMPTZ — when the row's genome was last computed (a NULL here means
--                                     "never computed", the honest signal the backfill/sync drain on;
--                                     NOT a fabricated empty genome).
--
-- Both are populated by scripts/backfill-opportunity-dna.ts (one-time drain over the corpus) and kept
-- fresh by the sam-opportunities sync (which calls the SAME computeGenome — one source of truth, no
-- drift). Absent columns / NULL keys → the strategy filter simply matches nothing for that row (an
-- honest "not yet computed", never a fabricated strand).
--
-- Hand-run in Supabase (this DB has no in-app DDL): paste + run, confirm "Success. No rows returned",
-- then `npm run db:check -- sam_opportunities opportunity_dna_keys` before the code uses it.

ALTER TABLE public.sam_opportunities
  ADD COLUMN IF NOT EXISTS opportunity_dna      JSONB,
  ADD COLUMN IF NOT EXISTS opportunity_dna_keys TEXT[],
  ADD COLUMN IF NOT EXISTS dna_computed_at      TIMESTAMPTZ;

-- GIN index on the keys array — makes the strategy filter's @>/&& predicate an index scan, not a
-- full-table sweep across 88K rows. array_ops is the operator class for TEXT[] containment/overlap.
CREATE INDEX IF NOT EXISTS idx_sam_opportunities_dna_keys
  ON public.sam_opportunities USING GIN (opportunity_dna_keys array_ops);

-- Partial index on the freshness cursor so the backfill/sync can cheaply find never-computed rows
-- (WHERE dna_computed_at IS NULL) to drain, exactly like the description-backfill pattern.
CREATE INDEX IF NOT EXISTS idx_sam_opportunities_dna_pending
  ON public.sam_opportunities (dna_computed_at)
  WHERE dna_computed_at IS NULL;

COMMENT ON COLUMN public.sam_opportunities.opportunity_dna IS
  'Opportunity DNA genome (full array of {category,key,label,tone,tier}) — computeGenome() output, computed at dna_computed_at. NULL = not yet computed.';
COMMENT ON COLUMN public.sam_opportunities.opportunity_dna_keys IS
  'Strand keys only (TEXT[]) for the strategy filter — GIN-indexed. Query with @> (all) / && (any).';
