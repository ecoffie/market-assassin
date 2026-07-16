# Supabase support ticket — read replica ICU mismatch

Project ref: `krpyelfrbicmvsmwovti` (Market Assassin) · Replica ID: `lxlqk`
Filed: 2026-07-16

---

## Paste-ready ticket body

**Subject:** Read replica provisioned with a different ICU version than the primary — collation version mismatch warning on every connection

Project ref: `krpyelfrbicmvsmwovti`
Replica ID: `lxlqk` (West US Oregon, us-west-2, t4g.medium, created 06 Jul 2026)
Primary: West US Oregon, us-west-2, t4g.medium

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

**Ask**

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

## Internal notes (not part of the ticket)

**Evidence chain**
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
