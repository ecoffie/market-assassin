-- ============================================================================
-- db_health_stats() — optional early-warning RPC for the db-health-watch cron
-- (2026-07-05)
--
-- WHY: Probe 3 of /api/cron/db-health-watch wants real connection/pressure
-- signals — the numbers that climb BEFORE an outage (connection saturation,
-- long-running queries, table bloat). PostgREST can't read pg_stat_activity
-- directly, so we expose a tiny SECURITY DEFINER function that returns a JSON
-- summary. The cron treats this as best-effort: if the function doesn't exist,
-- Probe 3 is simply skipped and health is still judged on probes 1 & 2. So this
-- migration is OPTIONAL — install it to get richer alerts, skip it with no loss
-- of the core reachability/latency detection.
--
-- SAFETY: read-only, returns aggregates only (no row data). SECURITY DEFINER so
-- the service role can read pg_stat_activity. Grant EXECUTE to service_role only.
-- ============================================================================

create or replace function public.db_health_stats()
returns json
language sql
security definer
set search_path = public, pg_catalog
as $$
  select json_build_object(
    'total_connections',    (select count(*) from pg_stat_activity),
    'active_connections',   (select count(*) from pg_stat_activity where state = 'active'),
    'idle_in_txn',          (select count(*) from pg_stat_activity where state = 'idle in transaction'),
    'max_connections',      (select setting::int from pg_settings where name = 'max_connections'),
    'longest_query_secs',   (select coalesce(round(extract(epoch from (now() - min(query_start)))), 0)
                               from pg_stat_activity
                               where state = 'active' and query not ilike '%pg_stat_activity%'),
    'db_size_mb',           (select round(pg_database_size(current_database()) / 1024.0 / 1024.0))
  );
$$;

-- Restrict: only the service role (used by the cron) may call it.
revoke all on function public.db_health_stats() from public;
grant execute on function public.db_health_stats() to service_role;

-- Verify:
--   select public.db_health_stats();
