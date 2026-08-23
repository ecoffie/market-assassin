-- Which wall did this user actually see?
--
-- WHY NOW, WITH ONE VERSION LIVE: the moment the copy, price presentation, CTA or
-- checkout destination changes, every row written before the change becomes ambiguous —
-- and there is no way to recover the answer after the fact. Stamping the version from the
-- first row means v1 is v1 forever, instead of "everything before some deploy we'd have to
-- go find in the git log."
--
-- Existing rows are backfilled to 'v1' because they are v1: every attempt recorded so far
-- was written by the offer shipped in #1249, and nothing else has been deployed since.
--
-- Idempotent: safe to re-run.

ALTER TABLE mcp_paywall_attempts
  ADD COLUMN IF NOT EXISTS offer_version text NOT NULL DEFAULT 'v1';

-- Cohort reads slice by version first, then by stage.
CREATE INDEX IF NOT EXISTS mcp_paywall_attempts_offer_version_idx
  ON mcp_paywall_attempts (offer_version, rejected_at DESC);

COMMENT ON COLUMN mcp_paywall_attempts.offer_version IS
  'Which paywall offer this user saw. Bump in PAYWALL_OFFER_VERSION (src/lib/mcp/paywall.ts) on ANY change to copy, price presentation, CTA, or checkout destination -- otherwise a mixed-version funnel reads as one number and means nothing.';
