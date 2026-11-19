# Scorecard credential

**Owner:** Agent 5, the release coordinator, does the one-time setup below and break-glass only. Eric does not apply the migration, set a password, or run the workflow.

This repository is public. Do not put a password, a connection string, or a signing secret in this file, a commit, a log, or a chat.

The weekday job holds no database password and no GitHub admin token. It requests a GitHub OIDC token (`id-token: write`). `POST https://getmindy.ai/api/scorecard/credential` checks the issuer, audience `scorecard-reader`, repository `ecoffie/market-assassin`, workflow `.github/workflows/daily-acquisition-scorecard.yml`, ref `refs/heads/main`, and event `schedule` or `workflow_dispatch`. The route then calls `scorecard_rotate_reader_password`, which sets a random `scorecard_reader` password with `VALID UNTIL` 30 minutes out and writes an audit row (run id, actor, expiry, never the password). The password is returned once over TLS.

`actions: write` remains on that job only so the successful run can upload the scorecard artifact. It is not permission to change secrets or administration.

## Why this design

A JWT signing secret in GitHub can mint `service_role`. A GitHub token that can write secrets can replace any Actions secret. Both are larger than this design. The workflow's only credential is a short-lived OIDC token that the route accepts solely for this workflow on `main`. The server holds `SCORECARD_ROTATOR_URL`. That login can execute only `scorecard_rotate_reader_password`. The function owner is the migration role, which created `scorecard_reader` and can alter that one role. On Supabase that is feasible: the migration runs as `postgres`, and a `SECURITY DEFINER` function owned by `postgres` may `ALTER ROLE` a role `postgres` created. The function `search_path` is `pg_catalog`. It hardcodes the role name and refuses a reused `jti` or more than six rotations in an hour.

The route's attack surface is one POST. A stolen OIDC token can be replayed until its `jti` is stored or it expires (GitHub tokens last a few minutes). A stolen rotator URL can ask for a 30-minute reader password, which can read the granted columns and cannot read `institute_sources.raw` or write. It cannot mint a service-role JWT and cannot change GitHub secrets.

`scorecard_reader` is not granted to `authenticator`. The scorecard connects with `pg` through the Supabase transaction pooler, port 6543, `sslmode=verify-full`. PostgREST is not on this path.

## One-time setup

Do these in order. After each step, do the check named there. Stop if the check fails.

1. **Confirm the target.** From the production checkout, confirm `npm run migrate` is aimed at the production database and that a backup exists. Check: the migrate dry run names this file and no other pending file you intend to apply.
2. **Apply only this migration.** `npm run migrate -- --go --only 20261119_scorecard_reader.sql`. Check: `\du scorecard_reader` shows LOGIN, connection limit 3, and no superuser, CREATEROLE, or BYPASSRLS. `\du scorecard_rotator` shows LOGIN and connection limit 2. Neither role has a password yet, so a password login fails.
3. **Set the rotator password once.** Generate it locally. Do not echo it. In a SQL session as the migration role: `ALTER ROLE scorecard_rotator PASSWORD '...'`. Do not set `VALID UNTIL`. Check: a connection as `scorecard_rotator` can `SELECT 1 FROM scorecard_rotate_reader_password(...)` only when you choose to test it, and `SELECT * FROM institute_sources` fails.
4. **Store the rotator URL on the server only.** In the production host env, set `SCORECARD_ROTATOR_URL` to the pooler URL for `scorecard_rotator.<project-ref>` on port 6543 with `sslmode=verify-full`. Set `SCORECARD_READER_HOST` to that pooler host and `SCORECARD_READER_USER` to `scorecard_reader.<project-ref>`. Do not create a GitHub secret for either. Check: GitHub Actions secrets do not list `SCORECARD_ROTATOR_URL`, `SCORECARD_DATABASE_URL`, `SCORECARD_JWT_SECRET`, or `SCORECARD_READONLY_JWT`.
5. **Remove the unused signing secret.** If `SCORECARD_JWT_SECRET` or `SCORECARD_READONLY_JWT` exists in GitHub or the server env, delete it. Check: both names are absent.
6. **Deploy the route** only when Eric has approved this release. The route is `POST /api/scorecard/credential`. Check: a request with no token returns 401 and no password.
7. **One dispatch.** Agent 5 runs the workflow with `workflow_dispatch` on `main`. Check: the job is green, the summary has counts or an unknown that is not a zero, and `scorecard_credential_audit` has one new row with the run id and an expiry about 30 minutes out. The row has no password column.

## Break-glass

If the rotator password is exposed, Agent 5 generates a new one, runs `ALTER ROLE scorecard_rotator PASSWORD`, and updates `SCORECARD_ROTATOR_URL`. That is not a calendar task. Reader passwords continue to expire every run.

## Audit

The table `scorecard_credential_audit` records `jti`, `run_id`, `actor`, `event_name`, `repository`, `workflow_ref`, `expires_at`, and `created_at`. It has no password column. Agent 5 also notes in the private status file: who ran setup, when, the rotator secret's updated timestamp, and that the reader password is not stored. Never record the value.

## Revocation

Remove `SCORECARD_ROTATOR_URL` from the server. Then, as the migration role, run the rollback comments at the bottom of `supabase/migrations/20261119_scorecard_reader.sql`.

## Agent 4

Without production, the pull-request job `Scorecard privileges` applies the migration to a local Postgres and checks the grants, a hidden `raw` column, a refused write, rotation, replay, and expiry.

After production setup, run this as a role that can read `pg_roles` and then as `scorecard_reader`:

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolconnlimit
FROM pg_roles
WHERE rolname IN ('scorecard_reader', 'scorecard_rotator');

SELECT current_user, current_setting('default_transaction_read_only'),
       current_setting('transaction_read_only'),
       has_column_privilege(current_user, 'public.institute_sources', 'raw', 'SELECT') AS raw_select,
       has_table_privilege(current_user, 'public.institute_sources', 'INSERT') AS can_insert;
```

`scorecard_reader` must not be superuser, BYPASSRLS, or CREATEROLE. Its connection limit is 3. The session is read-only. `raw_select` and `can_insert` are false. A second call with the same `jti` does not change the password.
