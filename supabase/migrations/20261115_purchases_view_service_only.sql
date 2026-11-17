-- Least privilege for the purchases_canonical view: service role only (2026-11-15).
-- All application readers use the service role. Idempotent; aborts if the view is missing.
DO $$
BEGIN
  IF to_regclass('public.purchases_canonical') IS NULL THEN
    RAISE EXCEPTION 'purchases_canonical not found - aborting';
  END IF;
  REVOKE ALL ON TABLE public.purchases_canonical FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON TABLE public.purchases_canonical TO service_role;
  ALTER VIEW public.purchases_canonical SET (security_invoker = true);
END $$;
