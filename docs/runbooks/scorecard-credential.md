# Scorecard credential — Agent 5 procedure

**Owner:** Agent 5, the release coordinator, on a local session. Eric does not mint the token and does not run the migration until he approves this change.

This repository is public. This file never contains a token, a password, a signing secret, or recommendation text. The audit entry goes in the coordinator's private status file, not here.

## Not applied

Do not run `20261119_scorecard_reader.sql`. Do not run `npm run migrate` against it. The file says `NOT APPLIED` until Eric approves an apply, and then only as:

```bash
npm run migrate -- --go --only 20261119_scorecard_reader.sql
```

## Raw access

`scorecard_reader` does not get `SELECT` on `institute_sources.raw`.

The customer reader `getAgencySourcedIntelligence` selects `raw` because it copies recommendation text, plus `resolution_status` and `resolution_flag`, out of `raw.acquisition`. The scorecard job does not call that reader. Its own reads use `id`, `source_type`, `document_number`, `source_url`, `publication_date`, `title`, `canonical_agency`, and `discovered_at`.

The resolution flag is `scorecard_institute_resolution(uuid[])`. The function owner reads `raw`. The caller receives only `id`, `discovered_at`, `resolution_status`, and `resolution_flag`. Recommendation text is not a return column. `EXECUTE` is granted to `scorecard_reader` and revoked from `PUBLIC`, `anon`, and `authenticated`.

## Rotation options

None of these put the JWT signing secret in GitHub.

1. **Supabase-side scheduled JWT rotation.** A scheduled function holds the project signing secret and a GitHub token that can update one Actions secret. It mints a `scorecard_reader` JWT and writes `SCORECARD_READONLY_JWT`. The signing secret can mint every role, including the service role. Keeping that secret beside a GitHub token is a wide blast radius. After the one-time vault setup, nobody mints by hand.

2. **A dedicated LOGIN role whose password an audited job rotates.** GitHub would hold that password, not the signing secret. A leaked password reads only the granted columns. PostgREST does not accept a database password, so the scorecard client would have to move to a Postgres connection. The rotation job still needs a GitHub token stored in Supabase.

3. **The read moves behind a server route that already has production access.** The GitHub job calls that route with a random bearer. The bearer is not a database credential and not a JWT. The route returns the public aggregate only. The server's existing service role can read `raw`; the limit is the route, unless the route is later switched to `scorecard_reader` after the migration is applied. A bug in the route can over-read. The GitHub secret cannot. There is no 30-day mint.

## Recommendation

Use option 3 when Eric approves a new production route. It removes the 30-day mint. A database-password job (option 2) has a smaller blast radius, but it replaces the PostgREST client. A scheduled minter (option 1) keeps the signing secret next to a GitHub token.

The path already on main, and kept by this rebase, is the weekday job minting a 2-hour `scorecard_reader` JWT from the Actions secret `SCORECARD_JWT_SECRET` (`scripts/scorecard-mint-jwt.mjs`). That secret is not a file in this repository. Agent 5 sets it once. Do not also mint a 30-day token on a laptop. A missing, expired, or rejected credential, or a credential that can write, still exits non-zero, writes no artifact, and the step summary says the numbers are unknown.

## One-time setup

Do this only after Eric approves the server route. Do not apply the migration as part of that approval unless he says so in the same instruction.

1. Generate a bearer locally. Do not write it into this repo, a log, or a chat.
2. Store it as the server env `SCORECARD_ENDPOINT_TOKEN` and as the Actions secret of the same name. Set `SCORECARD_ENDPOINT_TOKEN_EXPIRES` to the date Agent 5 will rotate it.
3. Write the audit entry in the private status file.
4. Ask Agent 4 to run the checklist below.

If Eric instead approves applying the migration and one JWT:

1. Apply the migration with the `--only` command above. Confirm the runner applied that file and no other.
2. Mint one `scorecard_reader` JWT. The signing secret stays in Supabase. Do not copy it into GitHub, this repo, or the audit file.
3. Store only the token as the Actions secret `SCORECARD_READONLY_JWT`.
4. The job fail-closes when `exp` passes. Do not adopt a 30-day hand mint as the steady process. The follow-up is still option 3.

## Rotation

For the recommended bearer: generate a new value, update the server env and the Actions secret, set the new expiry, remove the old value, then write the audit entry. No JWT signing secret is involved.

The weekday job already mints a 2-hour token from `SCORECARD_JWT_SECRET`. Rotate that secret when the project signing secret changes. Do not also mint a 30-day token on a laptop.

## Audit log entry

Private status file only. Record the date, the actor (Agent 5), the action (`setup`, `rotate`, or `revoke`), the secret name, the expiry date, and the verification result. Do not record the secret value, the signing secret, or any row text.

## Revocation

Remove the Actions secret and the server env value. If the migration was applied, run the rollback block at the bottom of `supabase/migrations/20261119_scorecard_reader.sql`. That block drops the function and the role. Write the audit entry.

## Agent 4 checklist

- The migration still says `NOT APPLIED`, unless the private audit entry says Eric approved `npm run migrate -- --go --only 20261119_scorecard_reader.sql` and names that file.
- The applied SQL has no `GRANT SELECT` that includes `institute_sources.raw`.
- `scorecard_institute_resolution` returns only `id`, `discovered_at`, `resolution_status`, and `resolution_flag`.
- A missing credential exits non-zero, writes no artifact, and the step summary says the numbers are unknown.
- An expired token does the same, and the token is not printed.
- A token whose role is not `scorecard_reader` is rejected before a request.
- The write probe treats any HTTP 2xx as write permission and fails the job. HTTP 401 or 403 with `42501` is the only pass. The response body is not printed.
- The log, the step summary, and the artifact do not contain `raw`, a recommendation sentence, a JWT, or the service-role key.
- The workflow masks `SCORECARD_READONLY_JWT` and does not echo a secret.
- The JWT signing secret is not in the repository. On the installed mint path it exists only as the Actions secret `SCORECARD_JWT_SECRET`.
