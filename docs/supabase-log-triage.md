# Supabase log triage — errors & warnings

Paste these into **Supabase Dashboard → Logs → Logs Explorer** (they are BigQuery
SQL over Logflare, NOT the Postgres SQL editor). The dashboard chart only gives
counts; these give the *messages* behind the counts, ranked by volume — which is
the only way to know what to actually fix.

Baseline captured 2026-07-16 (last 24h): API Gateway 153,474 req / 12,652 warn /
2 err · Postgres 12,304 / 10,939 warn / 104 err · Auth 1,231 / 0 / 0.

## 1. Postgres — what are the 10,939 warnings and 104 errors?

Groups by message so the top offender is obvious (one storm usually explains 90%+).

```sql
select
  parsed.error_severity as severity,
  event_message,
  count(*) as c
from postgres_logs
cross join unnest(metadata) as m
cross join unnest(m.parsed) as parsed
where parsed.error_severity in ('ERROR', 'WARNING', 'FATAL')
group by severity, event_message
order by c desc
limit 25;
```

Known prior storm: **42P10** `no unique or exclusion constraint matching the ON
CONFLICT specification` from `alert_log` upserts — was ~3k errors/day. Fixed by
`supabase/migrations/20260715_alert_log_conflict_constraint.sql`. If 42P10 still
shows here, that migration has NOT been applied yet — run it.

## 2. API Gateway — what are the 12,652 warnings?

Gateway "warnings" are **4xx responses**. Ranked by path + status:

```sql
select
  req.path,
  resp.status_code,
  count(*) as c
from edge_logs
cross join unnest(metadata) as m
cross join unnest(m.request) as req
cross join unnest(m.response) as resp
where resp.status_code >= 400 and resp.status_code < 500
group by req.path, resp.status_code
order by c desc
limit 25;
```

Expect PostgREST `406`/`404` from `.single()` on a no-rows read (PGRST116) —
noisy but usually harmless. A `401` storm means a key/JWT problem and IS real.

## 3. Confirm the alert_log constraint actually landed

This one runs in the **SQL editor** (real Postgres), not Logs Explorer:

```sql
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.alert_log'::regclass and contype = 'u';
```

Want: `alert_log_user_date_type_key UNIQUE (user_email, alert_date, alert_type)`.
If only the 2-col `(user_email, alert_date)` exists, the 42P10 storm is still
live and `20260715_alert_log_conflict_constraint.sql` needs to be pasted.
