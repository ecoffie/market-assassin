-- Least privilege for two SECURITY DEFINER functions in public (2026-11-15).
-- Application callers use the service role. Idempotent; aborts if a function is missing.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.readonly_select(text, integer)', 'public.db_health_stats()'] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      RAISE EXCEPTION 'function % not found - aborting', fn;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
