# Supabase support ticket — read replica (2 defects)

Project ref: `krpyelfrbicmvsmwovti` (Market Assassin) · Replica ID: `lxlqk`
Filed: 2026-07-16

Two independent defects on the same replica, both dating to its 06 Jul 2026
creation. Filed together because they share a likely cause: the replica was
provisioned inconsistently with the primary.

---

## Paste-ready ticket body

**Subject:** Read replica: (1) rejects every HTTP HEAD with 400, (2) ICU version differs from primary — both since provisioning

Project ref: `krpyelfrbicmvsmwovti`
Replica ID: `lxlqk` (West US Oregon, us-west-2, t4g.medium, created 06 Jul 2026)
Primary: West US Oregon, us-west-2, t4g.medium — **same region, same instance class**

We have two distinct problems with this read replica. **Issue 1 is the urgent one**
— it has been silently corrupting our data for ten days.

---

# ISSUE 1 — the replica endpoint rejects EVERY HTTP HEAD request with a 400

**This looks unambiguously like a bug on your side.** The replica's PostgREST
endpoint 400s every HEAD request, regardless of headers, while the identical GET
succeeds. Reproduced against `krpyelfrbicmvsmwovti-rr-us-west-2-lxlqk.supabase.co`
with the service-role key, same key and path on both hosts:

| request | primary | replica |
|---|---|---|
| `HEAD /rest/v1/agency_forecasts?select=id&limit=1` + `Prefer: count=exact` | 206 | **400** |
| `HEAD` same, no `Prefer` | 200 | **400** |
| `HEAD` same + `Prefer: count=planned` | 206 | **400** |
| `HEAD` same + `Prefer: count=estimated` | 206 | **400** |
| `GET` same + `Prefer: count=exact` | 206 | 206 |
| `GET` same, no `Prefer` | 200 | 200 |

It is the **verb**, not the count, and not the table — every table we tried
(`federal_contacts`, `sam_opportunities`, `recompete_opportunities`,
`agency_forecasts`, `mindy_rag_documents`, `mindy_rag_chunks`, `sam_events`,
`agency_intelligence`, `dodaac_directory`) returns 400 on HEAD and 200/206 on GET.
The HEAD response carries no body, so there is no PostgREST error code to quote.

**Why this is severe:** `supabase-js` issues a **HEAD** for the documented
count idiom `.select('id', { count: 'exact', head: true })`. So on a read replica,
the standard supabase-js way to count rows **cannot work at all**. Any application
that follows your own documentation and points a count at a replica gets a 400.

**What it cost us:** the failure is zero-shaped. A caller doing
`const { count } = await ...; value = count ?? 0` — again, the documented idiom —
turns the 400 into a confident `0`. Our nightly metrics cron recorded
`setup_emails_sent = 0` for **nine consecutive days** (2026-07-07 → 07-15) when the
true values were 92, 5, 6, 2, 3, 3, 2, 76, 1 — **190 records erased from our
history**. Several admin pages rendered every count as 0 or null. Nothing errored,
nothing alerted; the numbers just looked real. We only found it by reproducing
HEAD vs GET against both hosts by hand.

**Ask for issue 1**
1. Please fix HEAD on read-replica endpoints, or state that HEAD is unsupported
   there — in which case `supabase-js`'s `head: true` should be documented as
   incompatible with read replicas, because right now it fails silently.
2. Please confirm whether this affects all read replicas or just this one — that
   determines whether anyone using `head: true` against a replica is silently
   recording zeros.
3. If there is a date when this began, we'd like it: our data is wrong from 06 Jul
   2026 (replica creation) and we need to know the true blast radius.

We have worked around it by routing all head-counts to the primary. We'd rather
not keep that workaround forever.

---

# ISSUE 2 — the replica's ICU version differs from the primary's

**Problem**

Every connection to the read replica emits:

```
WARNING: database "postgres" has a collation version mismatch
DETAIL:  The database was created using collation version 153.120,
         but the operating system provides version 153.121.
```

SQLSTATE `01000`, COMMAND `startup`, USER `supabase_admin`, CONNECTION FROM `::1`.
Roughly 142/hour (~10,900/day) — your own local agent reconnecting once a minute
is enough to generate all of it. It is the single largest source of Postgres log
volume on this project.

**Root cause (verified from both nodes)**

The primary and the replica report DIFFERENT ICU versions for the same database:

Run on the **primary** (`pg_is_in_recovery() = false`):
```
datname  | datcollate  | datlocprovider | recorded | actual
postgres | en_US.UTF-8 | i              | 153.120  | 153.120   <- match, no warning
```

Run on the **replica** (`pg_is_in_recovery() = true`):
```
db       | is_replica | recorded_version | actual_version
postgres | true       | 153.120          | 153.121   <- MISMATCH
```

The replica shares the primary's data files, so `datcollversion` is necessarily
`153.120`. But the replica's host provides ICU `153.121`. Both nodes are the same
region and instance class — the replica (created 06 Jul 2026) appears to have been
provisioned on a newer host image than the primary.

**Why we cannot fix this ourselves**

* The replica is read-only — `ALTER DATABASE postgres REFRESH COLLATION VERSION`
  cannot run there.
* Running it on the primary is a no-op: the primary computes actual = `153.120`,
  which is already what's recorded. It would not change the replica's view.
* `REINDEX` on the primary doesn't help — the primary isn't the node reporting a
  mismatch.

**Why this matters beyond log noise**

We route production read traffic to this replica (`SUPABASE_REPLICA_URL`, plus the
API Load Balancer distributing across both databases). The replica serves reads
using btree indexes on text columns that were built under ICU `153.120` while its
own ICU is `153.121`. If the collation ordering changed between those versions,
index scans on the replica can return incorrect results (missed rows) — which is
precisely what the warning is designed to flag. We are not asserting the ordering
did change at a patch bump; we are saying we cannot verify it and cannot remediate
it from our side.

**Ask for issue 2**

1. Please align the replica's ICU with the primary's — either rebuild the replica
   on a host image matching the primary, or move the primary to the newer image so
   both run `153.121` and the recorded version can be refreshed once, on the
   primary, and replicated.
2. Please confirm whether reads served by this replica between 06 Jul 2026 and
   resolution could have returned incorrect results for collation-sensitive
   queries (btree text range/order scans), so we can judge the blast radius.
3. If a rebuild will land on the same newer image and reproduce this, say so — we
   don't want to cycle the replica pointlessly.

---

# Both issues together

Both defects date to the replica's creation on **06 Jul 2026**, and both are
differences between the replica and a primary in the **same region and instance
class**. That points at one underlying cause: this replica was provisioned from a
host image that doesn't match the primary's. If that's right, one fix likely
resolves both — and it would be useful to know whether other replicas created in
that window are affected.

We're a paying Pro project and we want to keep using read replicas — the offload is
the reason we bought in. But we've now found two ways this one silently returns
wrong answers rather than failing loudly, and we found both ourselves. If there's a
way to detect provisioning skew like this from our side, we'd like to know it.

---

## Internal notes (not part of the ticket)

**Issue 1 (HEAD 400) — status: worked around, PR #264**
* `getCountClient()` in `src/lib/supabase/server-clients.ts` routes all head-counts
  to the primary. Row reads stay on the replica (the offload the PRD wanted).
* 3 unit tests lock it to the primary even when `SUPABASE_REPLICA_URL` is set — if
  someone "optimizes" it back to `getReadClient()`, the silent zeros return.
* Backfill (`scripts/backfill-setup-emails-snapshots.mjs`) already run + verified:
  9 days restored (92/5/6/2/3/3/2/76/1 = 190 emails).
* If Supabase fixes HEAD, `getCountClient()` collapses to `return getReadClient()`.
* **Reproduce any time** (verified 2026-07-16 — this exact block prints 400/200/200/200):

  ```bash
  vercel env pull .env.prod --environment=production
  # NOTE: the service-role key round-trips with a TRAILING NEWLINE, which vercel
  # env pull escapes to a literal \n. Strip it or every request 401s and you will
  # think the repro is broken (it isn't — that bit us for 10 minutes).
  REPLICA=$(grep '^SUPABASE_REPLICA_URL'      .env.prod | cut -d'"' -f2 | sed 's/\\n$//')
  PRIMARY=$(grep '^NEXT_PUBLIC_SUPABASE_URL'  .env.prod | cut -d'"' -f2 | sed 's/\\n$//')
  KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY'     .env.prod | cut -d'"' -f2 | sed 's/\\n$//')
  Q='/rest/v1/agency_forecasts?select=id&limit=1'
  H=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY")
  curl -so /dev/null -w 'replica HEAD -> %{http_code}\n' -I "$REPLICA$Q" "${H[@]}"   # 400
  curl -so /dev/null -w 'primary HEAD -> %{http_code}\n' -I "$PRIMARY$Q" "${H[@]}"   # 200
  curl -so /dev/null -w 'replica GET  -> %{http_code}\n'    "$REPLICA$Q" "${H[@]}"   # 200
  curl -so /dev/null -w 'primary GET  -> %{http_code}\n'    "$PRIMARY$Q" "${H[@]}"   # 200
  ```

**Unrelated but noticed:** `SUPABASE_SERVICE_ROLE_KEY` in Vercel Production ends
with a newline (see above). Production works today, so nothing is broken — but it
is exactly the `echo`-vs-`printf` trap, and it will silently 401 any script that
doesn't strip it. Worth re-setting with `printf '%s' | vercel env add` at some point.

**Issue 2 (ICU) — status: not fixable by us, waiting on Supabase**

**Evidence chain (issue 2)**
1. Dashboard: Postgres warnings ~10.9k/24h dominating the log chart.
2. Unified logs, `Status = 01000`: `database "postgres" has a collation version
   mismatch`, once per minute at :58s.
3. Log DETAIL names both versions: `153.120` recorded, `153.121` provided.
4. Primary query says recorded == actual == `153.120` (no mismatch) — the
   contradiction that pointed at a second node.
5. `Source -> Read Replica (Oregon - lxlqk)` + `pg_is_in_recovery() = true`
   reproduces `153.120 / 153.121`. Confirmed.

**What NOT to do**
* Don't REINDEX the primary — the primary is not mismatched. (An earlier draft of
  `docs/collation-mismatch-runbook.md` assumed a primary-side glibc change; that
  premise was wrong. `datlocprovider = 'i'` — these are ICU collations, which do
  not shift with the host glibc. Keep the runbook only as a reference for a REAL
  primary-side mismatch.)
* Don't run `REFRESH COLLATION VERSION` on the primary "just to try" — it records
  what the *running session* computes (`153.120`), i.e. a no-op that changes
  nothing and proves nothing.

**Interim risk posture**
* Exposure is READ-path only, on the replica. Writes and the primary's indexes are
  untouched.
* Unaffected: `pg_trgm` GIN (trigram matching isn't sort-order dependent), FTS
  tsvector, and non-text indexes.
* Potentially affected: btree indexes on text/varchar used for range/ORDER BY
  scans on replica-served reads.
* Fallback if Supabase can't resolve quickly: unset `SUPABASE_REPLICA_URL` in
  Vercel Production. Per `docs/PRD-read-replica.md` the factory falls back to the
  primary transparently, so every read path returns to a node with no mismatch.
  Cost: the primary reabsorbs the bulk read load the replica was added to offload.
