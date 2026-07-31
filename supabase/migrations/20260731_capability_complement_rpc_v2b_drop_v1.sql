-- Drop the v1 complement RPC overload (Eric 2026-07-31).
--
-- v2 (20260731_capability_complement_rpc_v2.sql) added a candidate_pool param, so its signature
-- DIFFERS from v1 → CREATE OR REPLACE made a SECOND function instead of replacing v1. A call that
-- omits candidate_pool then matches BOTH overloads → "Could not choose the best candidate function".
-- Drop v1 (the 5-arg version); v2 (6-arg, candidate_pool has a default) is the keeper.
--
-- Hand-run in the Supabase SQL editor. Idempotent.

DROP FUNCTION IF EXISTS public.capability_complement_search(text, int, double precision, double precision, text);

-- Verify only ONE remains (a single row, 6 args incl. candidate_pool):
--   SELECT oid::regprocedure FROM pg_proc WHERE proname = 'capability_complement_search';
