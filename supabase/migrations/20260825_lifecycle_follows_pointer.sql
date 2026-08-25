-- Promotion safety: make the pointer the ONLY authority, lifecycle auditable
-- metadata that follows it, and deletion safe even when the labels drift.
--
-- ── THE OBSERVED DEFECT (2026-08-25, job 3) ─────────────────────────────────
-- After a successful promotion the database asserted two contradictory things:
--     pointer          -> 2026-08-11-build-3-a2   (new generation)
--     lifecycle='live' -> v3-2026-06              (OLD generation)
-- The 23,492 newly promoted rows sat labelled 'staging' while actively serving
-- production. These are POINTER-ACTIVE / LIFECYCLE-DIVERGENT rows. They are NOT
-- orphans and NOT cleanup candidates; deleting them would take production down.
--
-- Serving was never wrong (readServedPage resolves by data_version through the
-- pointer and ignores lifecycle), which is exactly why this went unnoticed.
--
-- ── WHY IT IS DANGEROUS ANYWAY ──────────────────────────────────────────────
-- The worker's failure path deletes `data_version = stagingVersion`, and
-- stagingVersion was DETERMINISTIC ({source}-build-{id}-a{attempts}). A retry
-- landing on the same name would delete the rows the pointer is serving. Two
-- sources of truth is the bug; the labels are only the symptom.
--
-- ── INDEX NOTE (corrected 2026-08-25 by EXPLAIN, not by reasoning) ──────────
-- An earlier claim that relabeling would "restore index usage" was WRONG.
-- readServedPage() issues no `lifecycle` predicate, so Postgres can never use the
-- partial index `... WHERE lifecycle='live'` for it. Measured on production:
--
--   Index Scan using awards_serving_pages_uniq  (actual time=0.043..0.044 rows=1)
--   Index Cond: recipient_uei, page_number, page_size, data_version
--   Buffers: shared hit=4   Execution Time: 0.092 ms
--
-- The plan is IDENTICAL before and after relabeling (verified in a rolled-back
-- transaction). The read path is already served by `awards_serving_pages_uniq`,
-- a NONPARTIAL unique index on exactly the lookup keys. There is no performance
-- recovery in this migration, because there was no degradation.
--
-- Do NOT add `lifecycle` to the read query to make the partial index apply. That
-- would reintroduce lifecycle as a second serving authority — the precise bug
-- this migration exists to remove.
--
-- ── DESIGN ──────────────────────────────────────────────────────────────────
-- 1. The pointer is authoritative. Readers must never consult lifecycle.
-- 2. Lifecycle is maintained INSIDE the pointer-move transaction, so a promotion
--    can never leave them divergent.
-- 3. Deletion safety does NOT depend on lifecycle being correct — a trigger
--    refuses to delete the pointer target no matter how the labels drift.

-- ── DEFENSE 2: deletion can never remove what the pointer serves ─────────────
-- Enforced in the database, not in application code, because the guarantee must
-- hold for the worker's failure path, ad-hoc psql, and any future cleanup job
-- alike. Deliberately independent of lifecycle: the labels are the thing that
-- already proved it can drift.
CREATE OR REPLACE FUNCTION public.refuse_delete_pointer_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active text;
BEGIN
  SELECT active_version INTO v_active FROM awards_active_version WHERE id = 1;
  IF v_active IS NOT NULL AND OLD.data_version = v_active THEN
    RAISE EXCEPTION
      'refusing to delete row from the pointer-active generation % (recipient %, page %). '
      'These rows serve production regardless of their lifecycle label. '
      'Promote a different generation first.',
      OLD.data_version, OLD.recipient_uei, OLD.page_number
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_refuse_delete_pointer_target ON awards_serving_pages;
CREATE TRIGGER trg_refuse_delete_pointer_target
  BEFORE DELETE ON awards_serving_pages
  FOR EACH ROW EXECUTE FUNCTION public.refuse_delete_pointer_target();

-- ── The promotion RPC ───────────────────────────────────────────────────────
-- Adding parameters creates an OVERLOAD, not a replacement: the 3-arg and 5-arg
-- forms would both exist and every call would fail as ambiguous. Drop the old
-- signature explicitly first.
-- Deterministic regardless of what is already installed. Both signatures are
-- named explicitly (never CASCADE — that would drop dependent objects silently).
-- The whole migration runs in ONE transaction, so there is no window in which
-- the function is absent to any other session.
DROP FUNCTION IF EXISTS public.promote_awards_version(text, date, text);
DROP FUNCTION IF EXISTS public.promote_awards_version(text, date, text, text, boolean);

CREATE OR REPLACE FUNCTION public.promote_awards_version(
  p_version           text,
  p_source_as_of      date DEFAULT NULL::date,
  p_promoted_by       text DEFAULT NULL::text,
  p_expected_previous text DEFAULT NULL::text,  -- stale-worker guard
  p_reconcile         boolean DEFAULT true      -- relabel in-transaction
)
RETURNS TABLE(active_version text, previous_version text, pages integer,
              rows_set_live integer, rows_retired integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pages   int;
  v_prev    text;
  v_live    int := 0;
  v_retired int := 0;
  v_mixed   int;
  v_count   int;
BEGIN
  -- (1) SERIALIZE PROMOTIONS. Transaction-scoped advisory lock, released on
  -- COMMIT or ROLLBACK. Two workers cannot interleave their checks and writes.
  -- Taken FIRST so every read below is inside the critical section.
  PERFORM pg_advisory_xact_lock(hashtext('promote_awards_version'));

  -- (2) TARGET MUST EXIST. A pointer at an empty version takes every page down
  -- at once — the exact failure this table exists to prevent.
  SELECT count(*) INTO v_pages
  FROM awards_serving_pages
  WHERE data_version = p_version;

  IF v_pages = 0 THEN
    RAISE EXCEPTION 'refusing to promote %: no rows for that data_version', p_version;
  END IF;

  -- (8) REJECT MIXED LIFECYCLE WITHIN ONE GENERATION. A half-labelled generation
  -- means a previous write was interrupted; promoting it would bake in the mess.
  SELECT count(DISTINCT lifecycle) INTO v_mixed
  FROM awards_serving_pages WHERE data_version = p_version;

  IF v_mixed > 1 THEN
    RAISE EXCEPTION
      'refusing to promote %: generation holds % distinct lifecycle values; reconcile before promoting',
      p_version, v_mixed;
  END IF;

  -- Lock the pointer row itself, so a concurrent reader of the pointer inside
  -- another transaction blocks rather than reading a value about to change.
  SELECT a.active_version INTO v_prev
  FROM awards_active_version a WHERE a.id = 1 FOR UPDATE;

  -- (7) STALE-WORKER GUARD. A worker that began 4 minutes ago must not clobber a
  -- promotion that landed while it was building. Caller passes the pointer value
  -- it observed at claim time; if it moved, refuse.
  IF p_expected_previous IS NOT NULL AND v_prev IS DISTINCT FROM p_expected_previous THEN
    RAISE EXCEPTION
      'refusing to promote %: pointer moved to % since this build began (expected %). Stale worker.',
      p_version, coalesce(v_prev, '<null>'), p_expected_previous;
  END IF;

  -- Idempotent: re-promoting the version already active is a no-op, not an error.
  IF v_prev IS NOT DISTINCT FROM p_version THEN
    RETURN QUERY SELECT p_version, v_prev, v_pages, 0, 0;
    RETURN;
  END IF;

  -- (3)(4) RELABEL, then (5) MOVE THE POINTER — all in this one transaction.
  -- (6) Any failure raises, and the whole thing rolls back: no partial state.
  IF p_reconcile THEN
    UPDATE awards_serving_pages
       SET lifecycle = 'retired'
     WHERE data_version <> p_version AND lifecycle = 'live';
    GET DIAGNOSTICS v_retired = ROW_COUNT;

    UPDATE awards_serving_pages
       SET lifecycle = 'live'
     WHERE data_version = p_version AND lifecycle IS DISTINCT FROM 'live';
    GET DIAGNOSTICS v_live = ROW_COUNT;
  END IF;

  INSERT INTO awards_active_version (id, active_version, previous_version, source_as_of, promoted_at, promoted_by)
  VALUES (1, p_version, v_prev, p_source_as_of, now(), p_promoted_by)
  ON CONFLICT (id) DO UPDATE
    SET previous_version = awards_active_version.active_version,
        active_version   = EXCLUDED.active_version,
        source_as_of     = EXCLUDED.source_as_of,
        promoted_at      = now(),
        promoted_by      = EXCLUDED.promoted_by;

  -- (9) PROVE EXACTLY ONE POINTER-ACTIVE GENERATION BEFORE COMMITTING.
  -- Asserted, not assumed. A violation rolls the whole transaction back.
  IF p_reconcile THEN
    SELECT count(DISTINCT data_version) INTO v_count
    FROM awards_serving_pages WHERE lifecycle = 'live';

    IF v_count <> 1 THEN
      RAISE EXCEPTION
        'post-promotion invariant violated: % generations labelled live, expected exactly 1', v_count;
    END IF;

    PERFORM 1 FROM awards_serving_pages
     WHERE lifecycle = 'live' AND data_version <> p_version LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'post-promotion invariant violated: a live generation other than % remains', p_version;
    END IF;
  END IF;

  RETURN QUERY SELECT p_version, v_prev, v_pages, v_live, v_retired;
END;
$function$;

COMMENT ON FUNCTION public.promote_awards_version IS
  'Atomically promotes one awards generation. The pointer (awards_active_version) '
  'is the sole authority for what production serves; lifecycle is auditable metadata '
  'maintained in the same transaction. Serialized by a transaction-scoped advisory '
  'lock. Pass p_expected_previous to reject a stale worker whose pointer moved.';

-- ── GRANTS: least privilege, reasserted on every run ────────────────────────
-- A SECURITY DEFINER function that moves the serving pointer must not be callable
-- by `authenticated` — in Supabase that is any signed-in user. Postgres grants
-- EXECUTE to PUBLIC by default on CREATE FUNCTION, so the revoke is required, not
-- decorative, and PUBLIC must go first: a surviving PUBLIC grant makes every
-- role-level revoke cosmetic.
REVOKE ALL ON FUNCTION public.promote_awards_version(text, date, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_awards_version(text, date, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.promote_awards_version(text, date, text, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.promote_awards_version(text, date, text, text, boolean) TO service_role;

-- The trigger function is invoked BY the trigger, never called directly.
REVOKE ALL ON FUNCTION public.refuse_delete_pointer_target() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refuse_delete_pointer_target() FROM anon;
REVOKE ALL ON FUNCTION public.refuse_delete_pointer_target() FROM authenticated;

-- ── RECONCILE THE CURRENT DIVERGENT STATE ───────────────────────────────────
-- Brings lifecycle into agreement with the pointer as part of the SAME
-- transaction that installs the function and trigger, so the labels and the
-- ledger become correct together. Idempotent: a rerun updates zero rows.
--
-- This is auditability only. It changes NO query plan (see the INDEX NOTE above)
-- and deletion safety does not depend on it — the trigger is label-independent.
DO $reconcile$
DECLARE
  v_ptr     text;
  v_live    int;
  v_retired int;
  v_check   int;
BEGIN
  SELECT active_version INTO v_ptr FROM awards_active_version WHERE id = 1;
  IF v_ptr IS NULL THEN
    RAISE NOTICE 'no active pointer; nothing to reconcile';
    RETURN;
  END IF;

  UPDATE awards_serving_pages SET lifecycle = 'retired'
   WHERE data_version <> v_ptr AND lifecycle = 'live';
  GET DIAGNOSTICS v_retired = ROW_COUNT;

  UPDATE awards_serving_pages SET lifecycle = 'live'
   WHERE data_version = v_ptr AND lifecycle IS DISTINCT FROM 'live';
  GET DIAGNOSTICS v_live = ROW_COUNT;

  -- Assert the invariant before committing. A violation rolls back the entire
  -- migration, ledger row included, rather than leaving a half-labelled table.
  SELECT count(DISTINCT data_version) INTO v_check
    FROM awards_serving_pages WHERE lifecycle = 'live';
  IF v_check <> 1 THEN
    RAISE EXCEPTION 'reconcile invariant violated: % live generations, expected 1', v_check;
  END IF;

  PERFORM 1 FROM awards_serving_pages WHERE lifecycle = 'live' AND data_version <> v_ptr LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'reconcile invariant violated: a live generation other than % remains', v_ptr;
  END IF;

  RAISE NOTICE 'reconciled: % rows -> live, % rows -> retired (pointer %)', v_live, v_retired, v_ptr;
END
$reconcile$;
