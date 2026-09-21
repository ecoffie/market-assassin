-- Phase 4 SEO: AI-enrichment columns on sam_opportunities.
-- Stores a pre-generated, data-grounded analysis paragraph per opportunity so
-- the public /opportunity/[slug] page reads cached text (NEVER an LLM call at
-- request time — cost + latency would kill it, and Google must see static HTML).
-- Generated in bulk by /api/cron/enrich-opportunity-seo (job: 'extraction',
-- cheap models). Resumable via seo_enriched_at (rule #7).
--
-- Idempotent: safe to re-run.

ALTER TABLE sam_opportunities
  ADD COLUMN IF NOT EXISTS seo_summary TEXT,           -- the AI analysis paragraph (what/who/why)
  ADD COLUMN IF NOT EXISTS seo_enriched_at TIMESTAMPTZ; -- when it was generated (resume stamp)

-- Partial index: the enrich cron repeatedly scans for "active + not yet enriched".
-- Keeps that hot query cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_sam_opps_seo_unenriched
  ON sam_opportunities (posted_date DESC)
  WHERE active = true AND seo_enriched_at IS NULL;
