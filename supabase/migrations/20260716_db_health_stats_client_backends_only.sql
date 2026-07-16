-- ============================================================================
-- db_health_stats(): count CLIENT backends only  (2026-07-16)
--
-- WHY: The probe filtered `state = 'active'` but never filtered `backend_type`,
-- so it swept in Postgres background workers. Postgres reports a walsender as
-- state='active' for its entire lifetime (it is idle, parked on
-- wait_event='WalSenderMain', waiting for WAL — not running a query).
--
-- Observed on prod 2026-07-16:
--   pid 2473 | backend_type=walsender | usename=supabase_replication_admin
--            | state=active | wait_event=WalSenderMain
-- …which is Supabase's own replication connection, up as long as the project is.
--
-- Effect of the bug:
--   * longest_query_secs reported 787,163s (9.1 DAYS) and climbed 1:1 with
--     wall-clock, forever. Cross-checked against the metric that would actually
--     show harm — max(age(backend_xmin)) — which was 0: nothing pinned, vacuum
--     unblocked, nothing blocked. So the 9 days was pure artifact.
--   * active_connections was permanently inflated by the walsender(s).
--
-- Scope of the impact (checked, not assumed): Probe 3 in /api/cron/db-health-watch
-- does NOT threshold on these values — it stringifies them into `detail` and always
-- reports ok:true; overall status comes only from probes 1 & 2. So this bug never
-- fired a false alert. What it did do is make the recorded diagnostic worthless:
-- the RPC exists (per its own header) to surface "the numbers that climb BEFORE an
-- outage", and a longest_query_secs pinned at 9 days and rising can never climb —
-- it can't distinguish a healthy DB from one with a genuinely stuck query. The
-- number was noise in every health record we've written since 2026-07-05.
--
-- FIX: restrict the query-duration and active-connection signals to
-- backend_type = 'client backend' — actual app queries, the only thing this
-- probe is meant to watch.
--
-- Kept deliberately: total_connections still counts EVERYTHING, because
-- saturation vs max_connections is about all backends, not just clients.
--
-- SAFETY: CREATE OR REPLACE of a read-only SECURITY DEFINER function returning
-- aggregates. No data change, no schema change. Idempotent. Reversible by
-- re-applying 20260705_db_health_stats_rpc.sql.
-- ============================================================================

create or replace function public.db_health_stats()
returns json
language sql
security definer
set search_path = public, pg_catalog
as $$
  select json_build_object(
    -- ALL backends — saturation vs max_connections counts every connection.
    'total_connections',    (select count(*) from pg_stat_activity),
    -- Client backends only: a walsender is permanently 'active' while idle.
    'active_connections',   (select count(*) from pg_stat_activity
                              where state = 'active'
                                and backend_type = 'client backend'),
    'idle_in_txn',          (select count(*) from pg_stat_activity
                              where state = 'idle in transaction'
                                and backend_type = 'client backend'),
    'max_connections',      (select setting::int from pg_settings where name = 'max_connections'),
    -- The signal this probe exists for: how long has a REAL app query been running.
    -- Without the backend_type filter this pinned at 9 days (the walsender) forever.
    'longest_query_secs',   (select coalesce(round(extract(epoch from (now() - min(query_start)))), 0)
                               from pg_stat_activity
                               where state = 'active'
                                 and backend_type = 'client backend'
                                 and query not ilike '%pg_stat_activity%'),
    -- Real early warning for a stuck transaction: how far back the oldest snapshot
    -- pins the vacuum horizon. This is what actually causes bloat/outage, and it is
    -- immune to the walsender artifact (a walsender holds no xmin). 0 = healthy.
    'oldest_xmin_age',      (select coalesce(max(age(backend_xmin)), 0)
                               from pg_stat_activity where backend_xmin is not null),
    'db_size_mb',           (select round(pg_database_size(current_database()) / 1024.0 / 1024.0))
  );
$$;

-- Restrict: only the service role (used by the cron) may call it.
revoke all on function public.db_health_stats() from public;
grant execute on function public.db_health_stats() to service_role;

-- Verify (longest_query_secs should now be small/0, not ~787000):
--   select public.db_health_stats();
