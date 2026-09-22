# Parked producers — DARPA & NSF SBIR (Workstream B, batch 2)

**Date:** 2026-09-21 · Disposition: **PARK / DISABLE**, approved 2026-09-20.
**No historical row is deleted. No SBIR expansion. No source recovery attempted.**

## Why

30-day run outcomes, measured on **both** `status` and `http_status`:

| Job | Runs | Outcome | Data written |
|---|---:|---|---|
| `snapshot-multisite-darpa` | 30 | **30 × `success` / HTTP 200** | **nothing since 2026-04-05 (168d)** |
| `snapshot-multisite-nsf` | 30 | **30 × `success` / HTTP 200** | **never, not once** |

Sixty consecutive green checkmarks over two sources that produce nothing.
Running them unchanged does not merely fail to help — it **manufactures evidence
that the corpus is healthy**.

## What changed

| | DARPA | NSF SBIR |
|---|---|---|
| Cron | **disabled** | **disabled** |
| `source_state` | **`unreachable`** — it once worked and has not advanced in 168 days | **`unmeasured`** — never observed |
| `intervention_state` | `blocked` | `blocked` |
| `manual_action_type` | `upstream_investigation` | `upstream_investigation` |
| Historical rows | **6, preserved** | 0 (never had any) |
| Registration | **preserved** | **preserved** — absence stays visible |

**NSF is `unmeasured`, deliberately not `content_stale`.** Stale implies it once
worked. It never did.

**DARPA is `unreachable`, deliberately not `content_stale`.** Stale implies
routine lag. 168 days is not lag.

Neither is called `CLOSED` or `current`.

New `research_producer_status()` reports schedule state **beside** advancement:
`running_advancing` · `running_not_advancing` · `running_never_advanced` ·
`parked_historical` · `parked_never_advanced`. The two `running_*` non-advancing
states are the false-green condition — a job still scheduled while its source
produces nothing.

## Why NIH was NOT touched

**Classified by DATA MOVEMENT, not job status:** 100 rows scraped in the last 7
days, 451 in 30. It is advancing.

Its permanent `dispatched` / `http_status=NULL` is a **reporting** artifact
(Workstream C), not a failed source — and NIH is the **only current SBIR feed**.
Confusing the two would have shut down the one research source that works.

DIBBS (1d behind) and Grants (0d) are advancing and are untouched.

## Exact-DDL validation

The migration file itself was executed against the production database inside a
transaction and rolled back. Verified in-transaction:

- `snapshot-multisite-darpa` → `enabled=false`; `snapshot-multisite-nsf` → `enabled=false`; **`snapshot-multisite-nih` → `enabled=true`**
- `research_darpa_baa` → `unreachable` / `blocked` / `upstream_investigation`
- `research_nsf_sbir` → `unmeasured` / `blocked` / `upstream_investigation`
- `research_producer_status()` → darpa `parked_historical` (6 rows) · nsf `parked_never_advanced` (0 rows) · **nih `running_advancing` (1,416 rows)**

## Post-merge

1. `npm run migrate` (dry-run) → `npm run migrate -- --go`
2. `select * from research_producer_status() order by rows_held desc;`
   → nih `running_advancing` · darpa `parked_historical` · nsf `parked_never_advanced`
3. `npm run db -- cron_jobs --select job_name,enabled --like job_name=snapshot-multisite-%`
   → darpa `false`, nsf `false`, **nih `true`**
4. `select count(*) from aggregated_opportunities where source='darpa_baa';` → still **6**
5. `select * from research_expected_sources();` → `nsf_sbir` still listed, `ever_advanced=false`

**Rollback:** re-enable the two `cron_jobs` rows, restore the two
`data_source_instances` states, `DROP FUNCTION research_producer_status`.
No data is destroyed, so rollback is complete.

## Deliberately NOT done

- No DARPA upstream investigation or repair.
- No NSF wiring.
- **No SBIR coverage expansion** — still 1 of ~11 agencies, still a product decision.
- The dormant `grants_gov` research slice (161d) is untouched: it has **no
  dedicated producer**, so it is not a false-green job — it is simply dormant.

## Follow-up this does NOT resolve

Parking removes the misleading signal; it does not restore the sources. Both
remain `blocked` pending an upstream decision: repair, or retire permanently.
