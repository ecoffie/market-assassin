-- Bounded retention for awards generations.
--
-- WHY THIS IS NEEDED
-- Immutable generation ids (added with the promotion fix) mean every legitimate
-- upstream advance mints a permanent ~23,492-page / ~95 MB snapshot. The daily
-- checker does NOT create one per day — the freshness gate rebuilds only when
-- `source_as_of` advances — but every real advance accumulates, so growth is
-- unbounded without pruning.
--
-- WHAT IS DELIBERATELY NOT THE MECHANISM
-- The delete-protection trigger is a BACKSTOP, not the selection rule. Selection
-- is explicit and positive: name the exact immutable data_versions to remove.
-- Relying on the trigger to "catch" a bad selection would be building on the same
-- assumption that already failed once — that a label reflects reality.

-- ── PERMANENT AUDIT METADATA ────────────────────────────────────────────────
-- Survives pruning. Page payloads are reclaimable; the record that a generation
-- existed, what it contained, and when it served is not.
CREATE TABLE IF NOT EXISTS awards_generation_audit (
  data_version      TEXT PRIMARY KEY,
  source_as_of      DATE,
  job_id            BIGINT,
  pages             INTEGER NOT NULL,
  recipients        INTEGER NOT NULL,
  award_rows        BIGINT,
  payload_bytes     BIGINT,
  payload_checksum  TEXT,              -- aggregate over the generation's pages
  first_generated_at TIMESTAMPTZ,
  last_generated_at  TIMESTAMPTZ,
  promoted_at       TIMESTAMPTZ,
  promoted_by       TEXT,
  retired_at        TIMESTAMPTZ,
  pruned_at         TIMESTAMPTZ,       -- non-null once payloads were removed
  pruned_by         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE awards_generation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE awards_generation_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE awards_generation_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE awards_generation_audit TO service_role;

CREATE INDEX IF NOT EXISTS awards_generation_audit_pruned_idx
  ON awards_generation_audit (pruned_at) WHERE pruned_at IS NULL;

COMMENT ON TABLE awards_generation_audit IS
  'Permanent per-generation metadata. Retained forever, including after page '
  'payloads are pruned. pruned_at non-null means the payloads are gone but the '
  'generation is still on the record.';

-- ── SNAPSHOT A GENERATION INTO THE AUDIT ────────────────────────────────────
-- Idempotent; refreshes the aggregates while the pages still exist.
CREATE OR REPLACE FUNCTION public.record_awards_generation(p_version text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO awards_generation_audit (
    data_version, source_as_of, pages, recipients, award_rows, payload_bytes,
    payload_checksum, first_generated_at, last_generated_at
  )
  SELECT
    p.data_version,
    max(p.source_as_of),
    count(*)::int,
    count(DISTINCT p.recipient_uei)::int,
    sum(p.row_count)::bigint,
    sum(pg_column_size(p.payload))::bigint,
    md5(string_agg(p.payload_checksum, '' ORDER BY p.recipient_uei, p.page_number)),
    min(p.generated_at),
    max(p.generated_at)
  FROM awards_serving_pages p
  WHERE p.data_version = p_version
  GROUP BY p.data_version
  ON CONFLICT (data_version) DO UPDATE SET
    source_as_of       = EXCLUDED.source_as_of,
    pages              = EXCLUDED.pages,
    recipients         = EXCLUDED.recipients,
    award_rows         = EXCLUDED.award_rows,
    payload_bytes      = EXCLUDED.payload_bytes,
    payload_checksum   = EXCLUDED.payload_checksum,
    first_generated_at = EXCLUDED.first_generated_at,
    last_generated_at  = EXCLUDED.last_generated_at;
END
$function$;

REVOKE ALL ON FUNCTION public.record_awards_generation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_awards_generation(text) TO service_role;

-- ── PRUNE CANDIDATE SELECTION (read-only; powers the dry run) ────────────────
-- One definition used by BOTH the dry run and the delete, so the report can never
-- describe a different set than the one removed.
CREATE OR REPLACE FUNCTION public.awards_prune_candidates(p_window_days int DEFAULT 7)
RETURNS TABLE(
  data_version text, pages bigint, recipients bigint, payload_bytes bigint,
  age interval, last_generated_at timestamptz, reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ptr  text;
  v_prev text;
BEGIN
  SELECT a.active_version, a.previous_version INTO v_ptr, v_prev
  FROM awards_active_version a WHERE a.id = 1;

  RETURN QUERY
  SELECT p.data_version,
         count(*)::bigint,
         count(DISTINCT p.recipient_uei)::bigint,
         sum(pg_column_size(p.payload))::bigint,
         now() - max(p.generated_at),
         max(p.generated_at),
         'retired, older than the rollback window'::text
  FROM awards_serving_pages p
  WHERE p.lifecycle = 'retired'
    -- Positive protection, each stated separately so the reason is auditable.
    AND p.data_version IS DISTINCT FROM v_ptr                       -- current pointer
    AND p.data_version IS DISTINCT FROM v_prev                      -- recorded previous
    AND NOT EXISTS (                                                -- referenced by live work
      SELECT 1 FROM awards_build_jobs j
       WHERE j.staging_version = p.data_version
         AND j.status IN ('queued','running','validated'))
  GROUP BY p.data_version
  HAVING max(p.generated_at) < now() - make_interval(days => p_window_days)
  ORDER BY max(p.generated_at);
END
$function$;

REVOKE ALL ON FUNCTION public.awards_prune_candidates(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.awards_prune_candidates(int) TO service_role;

-- ── BOUNDED PRUNE OF ONE GENERATION ─────────────────────────────────────────
-- One generation, one batch, one call. The caller loops. Keeping the batch small
-- keeps locks short and transactions bounded; a 23,492-row single delete would
-- hold locks far longer than necessary.
CREATE OR REPLACE FUNCTION public.awards_prune_batch(
  p_version text,
  p_batch   int DEFAULT 2000,
  p_actor   text DEFAULT NULL
)
RETURNS TABLE(deleted int, remaining bigint, aborted_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ptr   text;
  v_prev  text;
  v_del   int;
  v_left  bigint;
BEGIN
  -- Same advisory lock as promotion: pruning and promotion must never interleave.
  PERFORM pg_advisory_xact_lock(hashtext('promote_awards_version'));

  -- RE-READ the pointer inside the lock, immediately before deleting. The dry run
  -- may be minutes old and a promotion may have landed since.
  SELECT a.active_version, a.previous_version INTO v_ptr, v_prev
  FROM awards_active_version a WHERE a.id = 1 FOR SHARE;

  IF p_version = v_ptr THEN
    RETURN QUERY SELECT 0, 0::bigint, format('refused: %s is the current pointer target', p_version);
    RETURN;
  END IF;
  IF p_version = v_prev THEN
    RETURN QUERY SELECT 0, 0::bigint, format('refused: %s is the recorded previous generation', p_version);
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM awards_build_jobs j
              WHERE j.staging_version = p_version AND j.status IN ('queued','running','validated')) THEN
    RETURN QUERY SELECT 0, 0::bigint, format('refused: %s is referenced by an active job', p_version);
    RETURN;
  END IF;

  -- Snapshot the audit row BEFORE removing payloads, so the metadata survives.
  PERFORM record_awards_generation(p_version);

  WITH doomed AS (
    SELECT id FROM awards_serving_pages
     WHERE data_version = p_version
     ORDER BY id
     LIMIT p_batch
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM awards_serving_pages s USING doomed d WHERE s.id = d.id;
  GET DIAGNOSTICS v_del = ROW_COUNT;

  SELECT count(*) INTO v_left FROM awards_serving_pages WHERE data_version = p_version;

  IF v_left = 0 THEN
    UPDATE awards_generation_audit
       SET pruned_at = now(), pruned_by = coalesce(p_actor, 'awards_prune_batch')
     WHERE data_version = p_version AND pruned_at IS NULL;
  END IF;

  RETURN QUERY SELECT v_del, v_left, NULL::text;
END
$function$;

REVOKE ALL ON FUNCTION public.awards_prune_batch(text, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.awards_prune_batch(text, int, text) TO service_role;

-- Backfill audit rows for every generation currently present, so nothing that
-- exists today can be pruned without a permanent record already in place.
DO $backfill$
DECLARE v text;
BEGIN
  FOR v IN SELECT DISTINCT data_version FROM awards_serving_pages LOOP
    PERFORM record_awards_generation(v);
  END LOOP;
END
$backfill$;
