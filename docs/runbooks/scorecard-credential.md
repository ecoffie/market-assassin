# Scorecard credential

**Owner:** Agent 5, the release coordinator, does the one-time setup below and break-glass only. Eric does not apply the migration, set a password, or run the workflow.

This repository is public. Do not put a password, a connection string, or a signing secret in this file, a commit, a log, or a chat.

The weekday job holds no database password and no GitHub admin token. A second slot at 21:45 UTC publishes only when the scorecard job has not already succeeded that Eastern day. A failed credential exchange prints the route reason (`rotator is not configured`, `oidc audience rejected`, and the other fixed codes) plus the HTTP status. It does not print the token or any claim value. It requests a GitHub OIDC token (`id-token: write`). `POST https://getmindy.ai/api/scorecard/credential` checks the issuer, audience `scorecard-reader`, repository `ecoffie/market-assassin`, workflow `.github/workflows/daily-acquisition-scorecard.yml`, ref `refs/heads/main`, and event `schedule` or `workflow_dispatch`. The route then calls `scorecard_rotate_reader_password`, which sets a random `scorecard_reader` password with `VALID UNTIL` 30 minutes out and writes an audit row (run id, actor, expiry, never the password). The password is returned once over TLS.

`actions: write` remains on that job only so the successful run can upload the scorecard artifact. It is not permission to change secrets or administration.

## Why this design

A JWT signing secret in GitHub can mint `service_role`. A GitHub token that can write secrets can replace any Actions secret. Both are larger than this design. The workflow's only credential is a short-lived OIDC token that the route accepts solely for this workflow on `main`. The server holds `SCORECARD_ROTATOR_URL`. That login can execute only `scorecard_rotate_reader_password`. The function owner is the migration role, which created `scorecard_reader` and can alter that one role. On Supabase that is feasible: the migration runs as `postgres`, and a `SECURITY DEFINER` function owned by `postgres` may `ALTER ROLE` a role `postgres` created. The function `search_path` is `pg_catalog`. It hardcodes the role name and refuses a reused `jti` or more than six rotations in an hour.

The route's attack surface is one POST. A stolen OIDC token can be replayed until its `jti` is stored or it expires (GitHub tokens last a few minutes). A stolen rotator URL can ask for a 30-minute reader password, which can read the granted columns and cannot read `institute_sources.raw` or write. It cannot mint a service-role JWT and cannot change GitHub secrets.

`scorecard_rotator` can do nothing except `EXECUTE scorecard_rotate_reader_password`. It is not a superuser, has no BYPASSRLS or CREATEROLE, has no table privileges, and cannot execute `scorecard_institute_resolution`. The privilege job checks that.

A compromised Next.js process is wider than the rotator login. This route runs inside the production app, so that process can read the deployment's other environment variables. The route as written does not return them. The rotator login cannot.

`scorecard_reader` is not granted to `authenticator`. The scorecard connects with `pg` through the Supabase transaction pooler, port 6543, `sslmode=verify-full`. PostgREST is not on this path.

## What run 44613974057 showed

The Nov 19 schedule started at 20:58 UTC, about eight hours after 12:45 UTC. The log line was `scorecard numbers are unknown: credential is rejected`. That string was written for every failed token request and every non-2xx from the route; the JSON reason was discarded. A POST with no token still returns 401 `credential is missing`, so the route from #2201 is what answered. The rotator URL, reader host, and reader user were not set, and the migration was not applied. The next run will print the specific reason, including `rotator is not configured` when that env is absent.

## Production setup still required

Do not apply this migration, create these roles, set the rotator credential, deploy the route, or set any secret until Eric's written authorization for this release package. No production step comes before that authorization. Names only. Never write a value into this file.

1. Confirm `npm run migrate` targets production and a backup exists. Dry-run must name only `20261119_scorecard_reader.sql`.
2. Apply `npm run migrate -- --go --only 20261119_scorecard_reader.sql`. Check `\du scorecard_reader` and `\du scorecard_rotator` are LOGIN, not superuser, not CREATEROLE, not BYPASSRLS, limits 3 and 2.
3. Generate a rotator password locally and `ALTER ROLE scorecard_rotator PASSWORD` as the migration role. Do not echo it. Do not set `VALID UNTIL` on the rotator.
4. Set server env `SCORECARD_ROTATOR_URL` (pooler, port 6543, `sslmode=verify-full`, user `scorecard_rotator.<project-ref>`). Set `SCORECARD_READER_HOST` to the pooler host and `SCORECARD_READER_USER` to `scorecard_reader.<project-ref>`. Do not put these in GitHub. Check that GitHub Actions secrets do not list `SCORECARD_ROTATOR_URL`, `SCORECARD_DATABASE_URL`, `SCORECARD_JWT_SECRET`, or `SCORECARD_READONLY_JWT`.
5. Delete GitHub or server secrets named `SCORECARD_JWT_SECRET` and `SCORECARD_READONLY_JWT` if they exist.
6. Deploy the app that contains `POST /api/scorecard/credential` under the same authorization. Check: no token returns 401 `credential is missing`.
7. `workflow_dispatch` on `main`. Check: the log names a reason if it fails, or the summary contains the scorecard and is not a zero. `scorecard_credential_audit` gains one row with the run id and an expiry about 30 minutes out, and no password.

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
