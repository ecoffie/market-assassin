# R0 auth observability — production proof and T0 (2026-09-27)

**Scope:** R0 (#1722) only. It is behavior-neutral observation. **R1 is not merged or deployed**; it is blocked on R0 evidence.

## Result

| Item | Evidence |
|---|---|
| **Merge** | #1722 merged via GitHub (merge commit) · **`074f789be4e3df56f316d8c73bb79ddfd61bf1af`** · 2026-09-27 04:01:37Z. Pre-merge: MERGEABLE/CLEAN against main `c36ed7df` (its own base); `verify` ✓; Vercel preview ✓ |
| **Production serving** | GitHub Production deployment `6687801736` = success. **The served build stamp on getmindy.ai/opportunity-map = `maps-account-build:074f789be4e3…`** (curl of the live page) |
| **Migration applied** | Only `20260926_auth_observation.sql`, via `npm run migrate -- --go --only 20260926_auth_observation.sql`. The file is byte-identical to the merged commit (sha256 `751b898e…`). **`20260924_saved_search_forecast_watermark.sql` was left pending** (the runner reported it as held back, and it has no ledger row) |
| **Ledger** | `schema_migrations`: `20260926_auth_observation.sql`, checksum `751b898e2883112b` (= the file's sha256 prefix), applied 2026-09-27T04:06:12.588Z, `baselined=false` (really executed) |
| **Schema as intended** | `auth_observation_daily`: day, probe, route, method, verified_identity_present, claimed_matches_identity, count, first_seen, last_seen. `auth_observation_emails`: day, probe, route, method, email, count, first_seen, last_seen. RLS on for both, **no policies**, **no anon/authenticated table grants**. `record_auth_observation(p_day,p_probe,p_route,p_method,p_verified,p_matches,p_email,p_email_cap)` is executable **only by postgres + service_role** |
| **PostgREST** | Both tables return 200 with `count=0` after apply (a real empty table, not the 204/null missing-relation signature). **Anon read and anon RPC are both denied** ("permission denied") |
| **Runtime writing** | Aggregates were written within a minute of apply (below) |
| **T0** | **2026-09-27T04:06:56.49Z**: the first production observation row |

## Behavior parity (production, 25 probes: status + top-level response shape)

**Probe identities** (legitimate sessions only; GETs plus one gate-first POST):
- logged out
- a synthetic Free session
- the internal Team account (`eric@`)

The set covers access/check, incumbent, federal-contacts, pipeline, teaming, target-list GET and POST, saved-searches, `opportunities/save` (weak-auth route), pricing-intel with no identity, teaming/suggest with no identity, and the MCP catalog.

| Run | Result |
|---|---|
| Before merge (baseline) | reference |
| **After deploy, before migration: the sink ABSENT, so every observation write failed** | **25/25 identical.** Proves a logging failure cannot affect customer requests, in production |
| After migration (sink live) | 24/25 identical. One diff: the logged-out `incumbent` response gained a `cached` key. That route is **not instrumented by R0**; the cache was warmed by the earlier Free probe (the baseline's Free probe already returned `cached`). This is cache state, not behavior |

**Kill switch:**
- `AUTH_OBSERVE` is read on every call (`observeEnabled()`, `src/lib/auth-observability.ts:170`). `off` / `0` / `false` disables every write.
- Covered by the unit test "AUTH_OBSERVE=off writes nothing and still returns the same result".
- **Not flipped in production**, which would stop the observation window. Operational use: `printf 'off' | vercel env add AUTH_OBSERVE production`, then redeploy. The env var binds only on a new build.
- **Not currently set in production**, so observation is ON.

## First observations (all from the verification probes: classified **test/automation**)

| probe | route | method | verified | match | n |
|---|---|---|---|---|---|
| federal_contacts_usage | /api/app/federal-contacts | listing | yes | yes | 1 |
| verify_user_owns_email | /api/opportunities/save | mi_session | yes | yes | 2 |
| pro_gate | /api/app/pricing-intel | none | no | n/a | 1 |
| pro_gate | /api/teaming/suggest | none | no | n/a | 1 |

Email rows: one row (`federal_contacts_usage`, the synthetic `entitlement-audit+free-…@getmindy.ai` test identity).

**Classification rule for the readout:** customer / staff-internal / test-automation.
- **Staff/internal:** internal domains plus `INTERNAL_TEAM_EMAILS`.
- **Test/automation:** `entitlement-audit+*`, `*+prod-smoke*`, `demo@getmindy.ai` (reviewer), acceptance/canary addresses.
- **Customer:** everyone else.
- **Unauthenticated `pro_gate` calls have no established identity.** Their claimed email is reported as a *claim*, never as the identity.

## Seven-day observation (T0 → 2026-10-04T04:07Z)

Readout queries are in the #1722 PR body. Collect, by the classes above:
1. Plaintext-cookie authentication (`method='cookie'`): who, which routes.
2. Claimed-staff-email authentication (`method='staff_claim'`): who, which routes.
3. Unauthenticated calls to the 7 Pro routes (`probe='pro_gate'`, `verified='no'`): volume and claimed emails.
4. `teaming/suggest` calls without identity.
5. Contacts usage classes per user (listing / facet / browse / roster / bulk) for E6.
6. Cap check (days with ≥5,000 email rows mean the readout is a floor).

**Decision:**
- Weak-auth usage is only staff/test/internal → R1 proceeds through normal acceptance.
- Any legitimate customer depends on the cookie or staff-claim path → identify those accounts and build the transition path first (see `tasks/auth-r1-migration-note-2026-09-26.md`). **No legitimate customer may silently fall from paid to Free.**

## Separate finding — migration integrity: `20260915_paywall_funnel_stages.sql`

| Field | Value |
|---|---|
| Applied fingerprint (ledger) | `d5a4dfae1cda160f` (sha256 prefix), applied **2026-09-15T09:47:24Z** by postgres, `baselined=false` |
| Current fingerprint (on disk / main) | `96bdd06b95cf9d55` (full `96bdd06b95cf9d5521c6f31d47009218ac8359013cdcb24f117d0c09dd2aeacc`) |
| Exact diff | **Not recoverable.** The runner stores only a 16-hex checksum, not the SQL text. The file's only commit (`e9f26f5b`, #1536) landed **2026-09-15T10:17:57Z, about 30 minutes after the apply**. Every ref in git (all branches) holds only the current blob. No unreachable git object matches. **The applied text was a pre-commit working copy that was edited before commit.** |
| Did executable SQL change? | **Cannot be proven from text.** **Effect check (live DB):** every object the current file's executable statements produce exists and matches: the column rename `checkout_started_at → offer_page_opened_at`; `checkout_clicked_at`, `stripe_session_at`, `payment_confirmed_at`, `credits_applied_at` (timestamptz, nullable) and `stripe_session_id` (text); all five COMMENTs (matching text); the partial index `idx_paywall_paid_uncredited` (exact definition). The additional live `checkout_started_at` column is explained by a **separate** migration, `20260915_paywall_dual_write_compat.sql` (a deprecated dual-write column, mirrored by trigger). **Nothing in the live schema contradicts the current file.** So the edit was either comments-only, or it changed nothing that survives in the schema |
| Recommendation | 1. **Do not modify the migration file or the ledger** (per instruction). The current file correctly describes the live objects. 2. Record this as a known checksum drift in `docs/REPAIR-LEDGER.md` (applied from a working copy, 30 min pre-commit, effect-verified). 3. **Process fix (separate PR):** have the runner store the applied SQL text (or a git blob SHA plus a dirty-tree flag) in `schema_migrations`, and **refuse `--go` from a dirty or uncommitted migration file**. That turns this class from unrecoverable into diffable. 4. Until then, the "edited on disk" warning for this file is expected and benign |

## R1

Branch `fix/auth-identity-hardening` @ `b9b9de05`. The R0 commit is in main, so the draft PR is based on **main** (R0's branch was auto-deleted on merge); its diff is R1 only (16 files). **Draft, blocked on R0 evidence; not merged or deployed.**

**Push status (2026-09-27 ~04:15Z): NOT pushed.**
- The pre-push gate's unit step blocked it. The suite itself is green: **710 files, 8,295 tests passed, 0 failed.**
- The block comes from **2 unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"` errors.**
- **A control run on the R0 worktree (main content, without R1) reproduces the same 2 errors** (709 files, 8,270 tests passed, 2 errors). So it is **pre-existing on main**, load-sensitive (load average about 40), and not caused by R1.
- The errors coincide with real-network `[noticedesc] network/timeout` output. Suspect: `src/lib/sam/noticedesc-429-failover.unit.test.ts` (or code it exercises) hitting the network instead of a stub.
- `--no-verify` was not used.
- **Next:** retry the push when the machine is quiet. Separately, file the flake so that main's own gate stops failing under load.

## Early evidence — readout #1 (2026-09-28 ~10:10Z, about 30h after T0)

**Readout:** `npx tsx .claude/auth-r0/readout.mts` from the repo root. The script is untracked because it prints emails.

**Denominator:** 4,107 `verifyUserOwnsEmail` calls:
- `mi_session` 3,007
- `none` 776
- `signed_link` 305
- `supabase` 11
- **`cookie` 4**
- **`staff_claim` 4**

**Plaintext cookie:** 4 calls from **1 claimed email**, on `/api/alerts/preferences` and `/api/briefings/latest`.
- Read-only entitlement check: **a paying, active Pro customer** (KV `briefings:` present; `access_briefings=true`, no expiry; 171 engagement events since 2026-09-01).
- Classified **customer (entitlement-confirmed; identity still a claim)**.
- **This is the case R1 must not break silently.** It's the legacy `/briefings` path that authenticates by cookie.

**Claimed staff email:** 4 calls from 1 address on `INTERNAL_TEAM_EMAILS` (a gmail), on `/api/app/me`. Classified **staff/internal**.

**Pro routes without verified identity:**
- `market-overview`: 4 calls, 4 claimed gmail emails. **Unknown**, reported as claims only. Under R1 these degrade to the Free result, not 401.
- `pricing-intel`: 1 call.
- `teaming/suggest`: 1 call.
- Verified calls: `market-narrative` 3, `target-market-research` 4, `generate-all` 1.

**Contacts (E6):** 149 calls, all `listing` class; 22 distinct users (19 customer, 1 staff, 2 test).

**Cap:** email rows per day are 22 and 10, far below the 5,000 cap.

**Early answer (directional; the window continues to size the cohort):** yes. **At least one legitimate paying customer currently relies on plaintext-cookie authentication** (legacy `/briefings` + alert preferences). **R1 cannot merge as it is.** The transition path in `tasks/auth-r1-migration-note-2026-09-26.md` (a signed httpOnly session for the legacy cookie flows, or moving `/briefings` to the MI session) must ship first. The observation window stays open to count the cohort and routes. The staff-claim usage seen so far is internal only.

## Readout #2 (2026-09-28 ~14:20Z, about 34h after T0; includes about 10h of Monday traffic)

**Denominator:** 5,178 `verifyUserOwnsEmail` calls:
- `mi_session` 4,054
- `none` 796
- `signed_link` 308
- `supabase` 11
- **`cookie` 4 (unchanged)**
- **`staff_claim` 5**

New route in the denominator: `/api/alerts/save-profile` (`none` 6, `mi_session` 3). The unauthenticated calls are consistent with `generate-all`'s internal call, which R1 removes.

**Cookie cohort:** unchanged. **1 paying, active Pro customer** (`kem…@gmail.com`; last cookie use 2026-09-28T02:52Z) on `/api/alerts/preferences` and `/api/briefings/latest`.

**Staff claim:** 1 internal address (on `INTERNAL_TEAM_EMAILS`), `/api/app/me`, 5 calls. Staff/internal.

**Pro routes without identity:**
- `market-overview`: 4 claimants. **Read-only entitlement check: all 4 are Free/none** (no KV entitlement, no `access_*`). R1's degrade-to-Free therefore changes nothing for them. Their claims are still reported only as claims.
- `pricing-intel`: 1. `teaming/suggest`: 1.
- Verified calls: `market-narrative` 6, `target-market-research` 8, `generate-all` 2.

**Contacts (E6):** 186 calls, all `listing` class. Users: 22 customer, 2 staff, 11 test.

**Cap:** 22 and 24 email rows per day. Far below the cap.

**Status:**
- The directional answer from readout #1 is unchanged: **one paying customer depends on cookie auth, so R1 needs the transition path first.**
- The cohort is stable across the weekend and early Monday.
- Not yet representative of a full weekday cycle. **Recorded, not reported.** The next readout is 2026-09-29.

## Readout #3 (2026-09-29 ~14:17Z, about 58h after T0; includes the full Monday 2026-09-28)

**Denominator:** 9,449 `verifyUserOwnsEmail` calls:
- `mi_session` 7,977
- `none` 1,078
- `signed_link` 358
- `supabase` 20
- **`cookie` 7**
- **`staff_claim` 9**

About 32 routes are observed. Weak methods appear on only 3 of them: `/api/alerts/preferences`, `/api/briefings/latest`, `/api/app/me`.

**Cookie cohort: stable at 1.** The same paying, active Pro customer (`kem…@gmail.com`), now with 7 calls. Routes: `/api/briefings/latest` (3), `/api/alerts/preferences` (3), **plus `/api/app/me` (1), which is new**. Last seen 2026-09-28T19:09Z.

**Staff claim: stable at 1.** The internal address, `/api/app/me`, 9 calls. Staff/internal.

**Pro routes without identity:**
- `market-overview`: 6 claimants (2 new). **Read-only check: all 6 are Free/none.** The degrade-to-Free path costs them nothing. Their claims are still reported only as claims.
- `pricing-intel`: 1. `teaming/suggest`: 1 (no new calls).

**Contacts (E6):** 249 calls, all `listing` class. Users: 38 customer, 2 staff, 11 test. There is still no roster, bulk or browse usage.

**Cap:** 22 / 35 / 10 email rows per day. Far below the cap.

**Status:**
- The cohort is stable across the weekend and a full weekday (weak-auth users: 1 customer + 1 internal).
- The evidence is converging on the same answer: **R1 needs a transition path for the one cookie customer** (legacy `/briefings` + alert preferences + `/api/app/me`) before merge.
- The 3 affected routes are now known. That is enough to *design* the transition. The window continues to 2026-10-04 to confirm no additional customers appear on lower-frequency flows.
- **Recorded, not reported.**

## Readout #4 (2026-09-30 ~14:17Z, about 82h after T0; Sat + Sun + Mon + Tue + part of Wed) — REPORTED (anomaly)

**Denominator:** 13,356 `verifyUserOwnsEmail` calls:
- `mi_session` 11,528
- `none` 1,344
- `signed_link` 420
- `supabase` 32
- **`cookie` 19** (was 7)
- **`staff_claim` 13**

Weak methods still appear on only 3 routes:

| Route | Weak-method calls |
|---|---|
| `/api/alerts/preferences` | cookie 9 |
| `/api/briefings/latest` | cookie 9 |
| `/api/app/me` | cookie 1, staff_claim 13 |

**Cookie cohort: 1 → 3 claimed emails, NOT stable.** Read-only entitlement check: **all 3 are paying, active Pro customers** (KV `briefings:` + `access_briefings=true`, no expiry):

| Masked email | Cookie calls | Routes | Last seen | Events since 9/1 |
|---|---|---|---|---|
| `kem…@gmail.com` | 7 | briefings/latest, alerts/preferences, app/me | 09-28T19:09Z | 176 |
| `its…@gmail.com` (new) | 6 | alerts/preferences, briefings/latest | 09-30T00:00Z | 158 |
| `ant…@enprofits.com` (new) | 6 | alerts/preferences, briefings/latest | 09-30T14:07Z | 236 |

**Pattern:** paid briefings subscribers using the legacy `/briefings` dashboard, where the page authenticates `briefings/latest` + `alerts/preferences` by the `ma_access_email` cookie. The cohort is likely "paid briefings subscribers who open `/briefings` in the window". It grows as weekly-cadence users return, so **a 7-day window will under-count monthly-cadence users.**

**Staff claim:** 1 internal address, 13 calls, `/api/app/me`. Staff/internal.

**Pro routes without identity:** `market-overview` 10 claimants. **All 10 are Free/none** (read-only), so the degrade-to-Free path costs them nothing. `pricing-intel` 1 unverified plus 1 verified; `teaming/suggest` 1.

**Contacts (E6):** 364 listing, **11 bulk, 6 facet, 1 roster_index** (the first non-listing usage). Non-listing users: 2, **both paid** (`kei…@eganrose.com`: bulk 10, facet 5, roster_index 1; `mad…@outlook.com`: bulk 1, facet 1). Users by class: 51 customer, 3 staff, 11 test.

**Cap:** 22 / 35 / 27 / 19 email rows per day.

**Conclusion (reported to Eric):**
- R1 cannot remove the cookie method until **every paid `/briefings` cookie user** has a verified-session path.
- Because the cohort isn't closed, the transition must be **mechanism-based, not account-list-based**: migrate the legacy `/briefings` page and those 3 routes to the MI session (or a signed httpOnly session cookie issued at sign-in / email-link), then confirm cookie calls drop to 0 in R0 before R1 merges.

## Readout #5 (2026-10-01 ~14:17Z, about 106h after T0)

**Denominator:** 16,170 `verifyUserOwnsEmail` calls:
- `mi_session` 13,992
- `none` 1,627
- `signed_link` 452
- `supabase` 43
- **`cookie` 35**
- **`staff_claim` 21**

Weak methods still appear on the same 3 routes:

| Route | Weak-method calls |
|---|---|
| `/api/alerts/preferences` | cookie 18 |
| `/api/briefings/latest` | cookie 14 |
| `/api/app/me` | cookie 3, staff_claim 21 |

**Cookie cohort: 3 → 4, all PAID** (read-only check).

| Masked email | Cookie calls | Note |
|---|---|---|
| `isa…@gmail.com` | 14 | **new**, last seen 09-30T17:47Z |
| `its…@gmail.com` | 8 | |
| `kem…@gmail.com` | 7 | |
| `ant…@enprofits.com` | 6 | |

The cohort is still growing by roughly one paying subscriber per day. This is consistent with readout #4's mechanism conclusion: every paid `/briefings` user is in scope. **No account-list transition will be complete.**

**Staff claim:** 1 internal address, 21 calls, `/api/app/me`. Staff/internal.

**Pro routes without identity:** `market-overview` 14 claimants (4 new). **All 14 are Free/none**, so degrade-to-Free costs them nothing. `pricing-intel`: 1 unverified. `teaming/suggest`: 1. Verified calls: `market-narrative` 16, `target-market-research` 46, `generate-all` 6.

**Contacts (E6):** 439 listing, 14 bulk, 7 facet, 1 roster_index. Users: 65 customer, 3 staff, 11 test.

**Cap:** at most 35 email rows per day.

**Status:** no new decision beyond readout #4 (already reported). The growth confirms the mechanism-based transition. **Recorded, not re-reported.**

## Readout #6 (2026-10-02 ~14:17Z, about 130h after T0)

**Denominator:** 17,478 `verifyUserOwnsEmail` calls:
- `mi_session` 15,014
- `none` 1,864
- `signed_link` 492
- `supabase` 50
- **`cookie` 35 (unchanged since readout #5)**
- **`staff_claim` 23**

Weak methods still appear only on these routes:

| Route | Weak-method calls |
|---|---|
| `/api/alerts/preferences` | cookie 18 |
| `/api/briefings/latest` | cookie 14 |
| `/api/app/me` | cookie 3, staff_claim 23 |

**Cookie cohort:**
- **Stable at 4 paying Pro customers.** No new cookie calls since 2026-10-01T09:51Z.
- All 4 still use only the legacy `/briefings` flow.

**Staff claim:** 1 internal address, 23 calls. Staff/internal.

**Pro routes without identity:**
- `market-overview`: 16 claimants (2 new). **All 16 are Free/none** (read-only check).
- `pricing-intel`: 1. `teaming/suggest`: 1.
- Verified calls: `market-narrative` 21, `target-market-research` 58, `generate-all` 9.

**Contacts (E6):**
- Calls: 482 listing, 14 bulk, 7 facet, 1 roster_index.
- Users: 72 customer, 3 staff, 11 test.

**Cap:** at most 35 email rows per day.

**Status:**
- Readout #4's conclusion is unchanged: a mechanism-based `/briefings` transition is needed before R1.
- The cohort has held at 4 for about 29h. Final readout: 2026-10-04.
- **Recorded, not reported.**

## Readout #7 (2026-10-03 ~14:17Z, about 154h after T0; 7 calendar days of data)

**Denominator:** 19,716 `verifyUserOwnsEmail` calls:
- `mi_session` 16,937
- `none` 2,124
- `signed_link` 532
- `supabase` 57
- **`cookie` 37**
- **`staff_claim` 29**

Weak methods still appear only on these routes:

| Route | Weak-method calls |
|---|---|
| `/api/alerts/preferences` | cookie 19 |
| `/api/briefings/latest` | cookie 15 |
| `/api/app/me` | cookie 3, staff_claim 29 |

**Cookie cohort: 4 → 5, all PAID** (read-only check).
- **New: `kei…@eganrose.com`.** 2 calls on `/briefings/latest` + `/alerts/preferences`, last seen 2026-10-02T20:25Z.
- This is the same paid account seen using contacts bulk/facet in readout #4.
- The cohort keeps growing with weekly-cadence `/briefings` users, which confirms readout #4: **mechanism-based transition, not an account list.**

**Staff claim:** 1 internal address, 29 calls. Staff/internal.

**Pro routes without identity:**
- `market-overview`: 17 claimants. **All Free/none.**
- `pricing-intel`: 1. `teaming/suggest`: 1.
- Verified calls: `market-narrative` 23, `target-market-research` 73, `generate-all` 12.

**Contacts (E6):** 548 listing, 14 bulk, 7 facet, 1 roster_index. Users: 75 customer, 3 staff, 20 test.

**Cap:** at most 35 email rows per day.

**Status:** no new decision. The final readout after 2026-10-04T04:07Z closes the window. **Recorded, not reported.**

## Transition shipped — #1801 legacy `/briefings` verified session (2026-10-03)

**What changed:**
- `/api/briefings/latest` now accepts only a strong identity: a Mindy session, a Supabase session, or a signed link.
- The legacy `/briefings` page now sends the Mindy session on every call.
- A remembered, typed or `?email=` address now only pre-fills a one-time secure sign-in link.
- Consuming that link (15-minute TTL, atomic `GETDEL`) mints a signed Mindy session for the **link's** email and returns the reader to `/briefings`.
- No entitlement, pricing or briefing-capability change.

**Ship:**
- Reconciled with main twice.
- Deterministic pre-push gate passed on candidate `41225aab`.
- GitHub `verify` passed on the exact candidate `41225aab` (run 37155907704, `pull_request`).
- Merged via GitHub, `--match-head-commit`, merge commit **`024fdbb5`**.
- **Production served `maps-account-build:024fdbb5` from 2026-10-03T21:47:37Z.** The new gate copy ("we now confirm it’s you") appears in the served `/briefings` chunk.

**Production acceptance: 25/25.** Synthetic accounts `eric+r1801-*`. Pro = a KV `briefings:` fixture; Team = a synthetic auth user + `access_team`; each paid account got a fixture `briefing_log` row so a 200 could be proven to return only its own data.

| Case | Result |
|---|---|
| forged plaintext cookie · another customer's cookie (signed in as Free) · claimed staff address (paid, govcongiants.com, no session) · typed `?email=` alone · tampered session · expired session (31 days) · session for A naming B | **401**, no data |
| Free verified account | **403** |
| Mindy-session Pro · Supabase-path Team | **200**, own briefings only |
| Legacy cookie Pro | Cookie alone → 401. Link request → 200, exactly one link bound to that mailbox (TTL 896s ≤ 15 min). One `access_link` send, to that address only. **Two simultaneous consumes → 200 + 404.** A body email cannot replace the link identity (the response and the session both name the link email). `redirectTo=/briefings`. Third use → 404. Briefings load for that identity. The same session naming another customer → 401 |
| Free link request | 403, no link minted |
| KV (`briefings/ma/dbaccess/contentgen/recompete/ospro`) + `user_profiles` access flags | unchanged by every flow |
| Cleanup | 0 synthetic rows, keys, links or auth users left |

## R0 tracking after #1801 — definitions

R0 classifies a **refused** call as `none`. It does not record which cookie was presented. So, on `/api/briefings/latest`:

- **Successful cookie-authenticated access** = `method='cookie'` rows. **Must be 0 from 21:47:37Z.** Production no longer accepts the cookie on this route.
- **Legacy cookie attempts** = new `method='none'` rows. Before #1801 this route had **zero** `none` calls ever: every call was `mi_session` or `cookie`. These may persist while returning customers meet the secure-link migration.
- **Successful migration** = for a cookie-era customer (`auth_observation_emails`, `method='cookie'`): an `access_link` send (`email_provider_sends`), followed by session-authenticated `/briefings` activity (`user_engagement`, `event_source='market_intelligence'`, which requires a verified session since #1719).

**Before-baseline:**
- `/api/briefings/latest`: cookie 15 (9/28 3 · 9/29 3 · 9/30 7 · 10/1 1 · 10/2 1), none 0, mi_session 122.
- `/api/alerts/preferences`: cookie 19.
- `/api/app/me`: cookie 3, staff_claim 29.
- Cookie-era cohort: 5 paying customers.

**Reconciliation #1 (2026-10-03, ~10 min after serving):**
- **0 successful cookie-authenticated briefing reads.**
- Post-deploy rows on the route are the acceptance probes: 9 `none` (the refused cases), 8 `mi_session`, 1 `supabase`.
- None of the 5 cohort customers has returned yet (0 link sends, 0 verified `/briefings` events). Expected.

**Query:** `node scripts/r0-briefings-migration-reconcile.mjs 2026-10-03T21:47:37Z` (read-only), run with the deploy time as its argument. It reports the route/method rows active since the deploy, the successful cookie reads, and per-cohort-customer link sends and verified `/briefings` events.

**Final R0 report:** due when the window closes, 2026-10-04T04:07Z. Append it here as the **before-baseline of record**.

## R1 — next steps (after R0 closeout; do NOT merge old #1750)

1. Diff R1's intended invariants against current main.
2. Identify what later security PRs already implemented: SEC-3 #1738, SEC-4 #1748, SEC-5 #1747, SEC-5d #1787, #1801.
3. Identify the remaining weak-auth consumers.
4. Produce the smallest remaining R1 patch.
5. Run the current security regression suite.
6. Review for merge.

**Keep visible in the R1 audit:**
- **`/api/app/me` residual cookie calls** (3 in the window). These come from the Map account menu for users with no session. Not fixed in #1801, by decision.
- **`/api/alerts/preferences` cookie calls** from callers other than `/briefings`.

**Stale / broken integration:** `/briefings/lindy-setup` documents `GET /api/briefings/latest?email=YOUR_EMAIL` for Lindy, Zapier, Make and n8n. That never worked without the plaintext cookie, and since #1801 it cannot. R0 shows no email-only callers. **Do not restore email-only authorization.** Any future machine integration needs a real authenticated mechanism, such as a per-user API key or signed token.
