# #2188 budget migration — one local apply

Eric runs this once, from his Mac, against production Supabase project `krpyelfrbicmvsmwovti`. The runner is `npm run migrate`. It reads `DATABASE_URL`, and if that is unset, `SUPABASE_DB_URL`, including from gitignored `.env.local`. Never print that value, never paste it into chat, GitHub, or this file.

The file `supabase/migrations/20261118_budget_intel_usaspending_acquire.sql` inserts `sync-budget-intel` with `enabled = false`. `ON CONFLICT` updates route, schedule, timeout, and notes, and does not change `enabled`. The enable statement is separate and comes only after the checks below pass.

A second `npm run migrate` does not re-run an applied file. Pasting this file again does not flip `enabled`. Running the enable statement again changes zero rows once the row is already enabled.

## Before any command

1. In the Supabase dashboard, open the project and confirm the ref is `krpyelfrbicmvsmwovti` and the API host is `https://krpyelfrbicmvsmwovti.supabase.co` (region us-west-2). Stop if it is any other project. `tnfqhnnipljhatmtkdsw` is a different project.
2. Open Database → Backups for that same project. Confirm a recoverable backup or point-in-time recovery point exists. Write down its timestamp before continuing. Stop if you cannot name that timestamp.
3. Check out the `main` commit named in the release note for this runbook. Confirm:

```bash
git rev-parse HEAD
grep -n "55000, false" supabase/migrations/20261118_budget_intel_usaspending_acquire.sql
grep -n "enabled = EXCLUDED.enabled" supabase/migrations/20261118_budget_intel_usaspending_acquire.sql && echo 'STOP: conflict clause still sets enabled'
```

The first grep must match. The second must print nothing.

4. From that checkout, confirm the variable the runner will use points at production. This prints the host, port, database name, and project ref. It does not print the password.

```bash
node -e '
require("dotenv").config({ path: ".env.local" });
const which = process.env.DATABASE_URL ? "DATABASE_URL" : process.env.SUPABASE_DB_URL ? "SUPABASE_DB_URL" : "missing";
const raw = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "";
if (!raw) { console.log(JSON.stringify({ which, ref_matches_production: false })); process.exit(1); }
let u; try { u = new URL(raw); } catch { console.log(JSON.stringify({ which, parseable: false, ref_matches_production: false })); process.exit(1); }
const user = decodeURIComponent(u.username);
const refFromUser = user.startsWith("postgres.") ? user.slice(9) : null;
const parts = u.hostname.split(".");
const refFromHost = u.hostname.endsWith(".supabase.co") && parts[0] === "db" ? parts[1] : null;
const ref = refFromUser || refFromHost;
console.log(JSON.stringify({ which, host: u.hostname, port: u.port, database: u.pathname, ref, ref_matches_production: ref === "krpyelfrbicmvsmwovti" }));
'
```

Stop unless `ref_matches_production` is true. Prefer port `5432` (session pooler). Port `6543` works and skips the runner's advisory lock; do not start a second migrate while one is running.

5. Confirm the file has no `DELETE`, `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE`. The only `DROP` is `DROP POLICY IF EXISTS budget_intel_links_service` on the new `budget_intel_links` table, recreated in the next statement.

```bash
grep -nE 'DELETE|DROP TABLE|DROP COLUMN|TRUNCATE' supabase/migrations/20261118_budget_intel_usaspending_acquire.sql || echo 'none'
grep -n 'DROP POLICY' supabase/migrations/20261118_budget_intel_usaspending_acquire.sql
```

## Apply

Dry run first. It must name only this file as what would run. Other pending files, including `20261118_park_false_green_freshness.sql`, must stay pending. Never use a bare `npm run migrate -- --go`.

```bash
npm run migrate -- --only 20261118_budget_intel_usaspending_acquire.sql
npm run migrate -- --go --only 20261118_budget_intel_usaspending_acquire.sql
```

The runner wraps the file in one transaction. A failure leaves the schema unchanged.

## Read-only checks

Paste these in the Supabase SQL editor for project `krpyelfrbicmvsmwovti`. Do not run the enable statement in this step.

Ledger row, actually executed (not baselined):

```sql
SELECT version, baselined, applied_at
FROM public.schema_migrations
WHERE version = '20261118_budget_intel_usaspending_acquire.sql';
```

Expect one row, `baselined` false.

Money columns widened, new columns present:

```sql
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'agency_budget_authority' AND column_name IN (
      'budget_authority', 'obligated', 'outlays', 'prior_year_authority', 'change_amount', 'change_percent',
      'source_url', 'fetched_at', 'source_key'))
    OR (table_name = 'budget_programs' AND column_name IN (
      'requested_amount', 'enacted_amount', 'prior_year_amount',
      'source_url', 'fetched_at', 'source_key',
      'obligated_amount', 'gross_outlay_amount', 'prior_year_obligated', 'amount_basis'))
    OR (table_name = 'agency_priorities_db' AND column_name IN ('fetched_at', 'source_key'))
  )
ORDER BY table_name, column_name;
```

Expect `numeric` precision 20 scale 2 on every money column listed above, including `obligated_amount`, `gross_outlay_amount`, and `prior_year_obligated`. Expect `change_percent` precision 12 scale 4. Expect `source_url` and `source_key` as `text`, and `fetched_at` as `timestamp with time zone`.

Unique constraints:

```sql
SELECT conrelid::regclass AS table_name, conname
FROM pg_constraint
WHERE conname IN (
  'agency_budget_authority_source_key_key',
  'budget_programs_source_key_key',
  'agency_priorities_db_source_key_key'
)
ORDER BY conname;
```

Expect three rows.

`budget_intel_links` exists, RLS is on, the policy is `service_role` only, and `anon` / `authenticated` have no grants:

```sql
SELECT c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'budget_intel_links';

SELECT pol.polname, r.rolname
FROM pg_policy pol
JOIN pg_roles r ON r.oid = ANY (pol.polroles)
WHERE pol.polrelid = 'public.budget_intel_links'::regclass;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'budget_intel_links'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY grantee, privilege_type;
```

Expect `rls_enabled` true, policy `budget_intel_links_service` for `service_role`, and no rows in the grants query.

Cron row present and disabled:

```sql
SELECT job_name, route, cron_expr, timeout_ms, enabled
FROM public.cron_jobs
WHERE job_name = 'sync-budget-intel';
```

Expect one row: route `/api/cron/sync-budget-intel`, cron `17 */2 * * *`, timeout `55000`, `enabled` false.

If `enabled` is true, stop. Set it back off and do not continue:

```sql
UPDATE public.cron_jobs
SET enabled = false
WHERE job_name = 'sync-budget-intel'
  AND enabled = true;
```

Re-read the row. Leave it disabled until you know which statement turned it on.

## Enable

Run this only after every check above matches. It enables this one row and no other.

```sql
UPDATE public.cron_jobs
SET enabled = true
WHERE job_name = 'sync-budget-intel'
  AND route = '/api/cron/sync-budget-intel'
  AND cron_expr = '17 */2 * * *'
  AND enabled = false;
```

Expect `UPDATE 1`. A later run of the same statement updates zero rows.

## After the next even-hour :17 UTC

The schedule is minute 17 of every even UTC hour (00:17, 02:17, 04:17, …). The first run takes the first roster agency, Department of Defense, toptier `097`: the two latest fiscal years of budgetary resources, and at most 10 federal-account rows.

```sql
SELECT agency, toptier_code, fiscal_year, source_url, fetched_at, source_key
FROM public.agency_budget_authority
WHERE toptier_code = '097'
ORDER BY fiscal_year;

SELECT agency, fiscal_year, program_code, amount_basis, source_url, fetched_at
FROM public.budget_programs
WHERE agency = 'Department of Defense'
ORDER BY program_code;

SELECT toptier_code, count(*) AS rows
FROM public.agency_budget_authority
WHERE toptier_code = '036'
GROUP BY toptier_code;

SELECT job_name, started_at, status, http_status, left(error, 200) AS error
FROM public.cron_job_runs
WHERE job_name = 'sync-budget-intel'
ORDER BY started_at DESC
LIMIT 5;
```

Defense authority `source_url` values contain `/agency/097/budgetary_resources/`. Program rows, when present, have `amount_basis` `obligations`. Those program amounts are federal-account obligations. Veterans Affairs (toptier `036`) has no new authority rows from this first run.

Ask Mindy or MCP `get_agency_budget_trends` for the Department of Defense should show `usaspending_live` and the summary `USASpending budgetary resources`. The same tool for the Department of Veterans Affairs should show `static_file` with the file as-of date. VA is not newly verified.

## Stop, and how to recover

Stop, and do not run the enable statement, if the dashboard project is not `krpyelfrbicmvsmwovti`, the ref check is not true, the backup timestamp was not written down, the dry run would execute any other file, any read-only check disagrees with this list, or `sync-budget-intel` is not disabled after the apply.

Do not apply `20261118_park_false_green_freshness.sql`.

Once any acquired number is stored, narrowing `numeric(20,2)` or `numeric(12,4)` back to the old types is not a recovery plan. Those values can exceed the old precision, and the cast can fail. Recovery is the backup or point-in-time recovery point whose timestamp you wrote down before the apply: restore that point for project `krpyelfrbicmvsmwovti`. Leave `sync-budget-intel` disabled until that restore is confirmed.
