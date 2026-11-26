# PR #1339 Triage

**Status: READ-ONLY RECONCILIATION. Not merged, not closed, not edited. No
production data changed, no page changed, no sync run, no registry touched.**
**Date: 2026-09-13 · Against main `843b00aa` (the completed 11-PR Data Core train)**

> Does PR #1339 still belong in the architecture we just merged?

---

## Original claims (2026-08-25)

| Claim | As stated |
|---|---|
| `dibbs_rfqs` | 28,214 records, **missing entirely** from Data Core |
| `grants_cache` | 1,972 records, wrongly described as **passthrough / count: null** |
| `aggregated_opportunities` | 1,134 records, **missing entirely** |
| Guard | added so mirrored datasets cannot silently disappear |
| DIBBS ingest | "already known stale/broken separately" |

---

## Current-main comparison

| #1339 change | Already on main? | Still correct? | Evidence | Disposition |
|---|---|---|---|---|
| Add `dibbs_rfqs` headCount + `dibbs` dataset row | ❌ **no** | ✅ yes — corpus real and customer-facing | `grep dibbs_rfqs` on main's `data-inventory/route.ts` → **0 hits**; 6 resolved `.from()` refs, 6 customer-facing | **KEEP** (count stale) |
| Flip `grants` passthrough → curated, real count | ❌ no | ✅ yes — it IS mirrored | main still reads `provenance: 'passthrough', count: null, 'queried live per search'`; `sync-grants` cron enabled, last_status **success** 2026-09-12 | **KEEP** (count stale) |
| Add `aggregated_opportunities` row | ❌ no | ✅ yes | 0 hits on main; 5 customer-facing consumers | **KEEP** (count stale; label needs review) |
| Guard test (`inventory-coverage.unit.test.ts`) | ❌ no | ⚠️ **partially** | hand-maintained `MIRRORED_TABLES` array | **REWORK** — see Guard analysis |
| Premise: "DIBBS ingest stale/broken" | n/a | ❌ **NO LONGER TRUE** | `sync-dibbs` enabled, `last_status: success`, `last_run 2026-09-12`; `max(synced_at) = 2026-09-12` | **DISCARD the premise** |

**Nothing in #1339 has landed on main.** The omission it identifies is still live:
main's Data Core counts **none** of the three tables.

---

## Corpora re-measurement

| Corpus | #1339 count | **Current count** | Δ | Producer | Latest advance | Customer use | Data Core representation |
|---|---|---|---|---|---|---|---|
| `dibbs_rfqs` | 28,214 | **48,385** | **+20,171 (+71.5%)** | `cron/sync-dibbs` (`0 8 * * *`, enabled, **success**) | `synced_at` **2026-09-12** | 6 refs incl. `/api/app/dibbs`, opportunity-detail, **opportunity-map** | **ABSENT** |
| `grants_cache` | 1,972 | **2,126** | +154 (+7.8%) | `cron/sync-grants` (`0 9 * * *`, enabled, **success**) | `synced_at` **2026-09-12** | 3 refs incl. `grants-map`, `map-data` | **WRONG** (passthrough, null) |
| `aggregated_opportunities` | 1,134 | **1,385** | +251 (+22.1%) | `snapshot-multisite-{nih,darpa,nsf}` (enabled, success/dispatched) | `scraped_at` **2026-09-08** | 5 refs incl. `market-scan`, `sbir`, briefings | **ABSENT** |

**Total understatement today: 51,896 records** — not the 31,320 in the PR title.
The title figure is stale by **66%**. Do not preserve 28,214 / 1,972 / 1,134.

---

## Logical dataset vs source determination

The page models **logical DATASETS** (13) with underlying **`sources[]`** (34).
A physical table must not become a "dataset" merely because it exists.

| Corpus | Determination | Reasoning |
|---|---|---|
| **DIBBS** | ✅ **separate logical dataset** | Answers a question no other dataset can: *"what does DLA buy below the SAM.gov posting threshold?"* FSC/NSN-coded, no SAM equivalent. Distinct product surface (`/api/app/dibbs`). Not a cache of anything Mindy already holds. |
| **Grants** | ✅ **existing dataset, WRONG provenance** | Already a listed dataset (`key: 'grants'`). The defect is not absence but **mis-description**: it is mirrored nightly, not passthrough. Fix the row; do not add one. |
| **Aggregated opportunities** | ⚠️ **needs a naming decision** | Genuinely distinct sources (NIH/DARPA/NSF/DOE) with no SAM posting. BUT `/api/sbir` and `src/lib/sbir/search.ts` read it, and the page **already lists `sbir` as a separate passthrough dataset**. Adding it as "Research & lab opportunities" risks **double-counting the same corpus under two dataset keys**. |

**This is the one substantive architectural finding, and it is proven, not suspected:**

```
src/lib/sbir/search.ts:107     .from('aggregated_opportunities')
src/app/api/sbir/route.ts:94   .from('aggregated_opportunities')
src/app/api/sbir/route.ts:219  .from('aggregated_opportunities')
```

while main's page says:

```
{ key: 'sbir', ..., provenance: 'passthrough', count: null, note: 'queried live per search' }
```

**SBIR is mis-described in exactly the same way grants is** — a mirrored corpus
reported as holding nothing — and **#1339 never noticed**, because it was looking
for *missing* datasets, not *mis-classified* ones. It adds `aggregated` as a new
row while leaving the `sbir` row that reads the same table untouched.

Merging as-is would therefore put **one physical corpus on the page twice**: once
as "Research & lab opportunities" with a real count, and once as "SBIR / STTR"
claiming it holds nothing. That is worse than the current single omission.

---

## Guard analysis

```js
const MIRRORED_TABLES = ['sam_opportunities', ..., 'dibbs_rfqs', ...];  // hand-maintained
```

| Question | Answer |
|---|---|
| Understands logical dataset vs physical source? | ❌ **No.** It asserts every mirrored *table* appears in the route source — the exact "a table is a dataset" conflation Step 3 warns against. |
| Duplicates C3? | ⚠️ **Functionally no, structurally yes.** C3 reconciles `data_sources` / docs / TS registry and does **not** cover these three tables (grep: 0 hits). So it is not redundant *today* — but it is a **fourth** hand-maintained inventory beside those three. |
| Conflicts with census/control architecture? | ⚠️ It is a source-text assertion (`SRC.includes`), not a measurement — closer to a lint than a control. It cannot detect a table that is listed but **wrongly classified**, which is the actual grants defect it was written for. |
| Enumerates from a canonical source? | ❌ **No** — a literal array. A new corpus with a sync cron is invisible until a human edits the array, which is the same failure mode it exists to prevent, moved one level up. |
| Would an existing control catch it? | ❌ **Not today.** No control enumerates "tables with a sync cron" and compares to the inventory. `cron_jobs` is the canonical list and nothing reads it for this purpose. |

**Verdict:** the guard's *intent* is sound and uncovered by C1–C5. Its
*implementation* creates a fourth hand-maintained registry. It should be reworked
to enumerate from **`cron_jobs`** (the canonical producer list) rather than an
array — then it becomes a real control instead of a literal.

---

## Interaction with C1–C5

| Control | Interaction |
|---|---|
| **C1** Advancement | **Complementary and needed.** All three corpora advance (DIBBS 1d, grants 1d, aggregated 5d) but **none has a C1 oracle**. Inventory presence ≠ freshness monitoring. |
| **C2** Claim/literal | The Data Core page's `distinctSources: 34` and `datasets` count are **hardcoded literals** describing corpora. Adding datasets without updating them would create a class-15 contradiction. **#1339 does not touch them.** |
| **C3** Registry reconciliation | Does not cover these tables. #1339's guard is adjacent, not duplicative. |
| **C4** Producer/lineage | All three have **proven producers** (`sync-dibbs`, `sync-grants`, `snapshot-multisite-*`) — they would classify `producer_proven`, unlike `contractors.json`. |
| **C5** Coverage | `grants` mislabelled `passthrough` with `count: null` is precisely C5's **population-vs-passthrough** confusion: a mirrored corpus reported as holding nothing. |

---

## Final recommendation

# REWORK

### What survives (the core finding is still true and still unfixed)
1. **DIBBS must be added** as a separate logical dataset — real, customer-facing, absent from main.
2. **Grants must flip** `passthrough → curated` with a real count — it is mirrored nightly; main still says "queried live per search."
3. **The aggregated corpus must be represented** — 1,385 records serving 5 customer surfaces, currently invisible.
4. **The guard's intent survives** — nothing in C1–C5 catches "a corpus got a sync cron and nobody added it to the inventory."

### What must be discarded or changed
1. **All three counts** — 28,214 / 1,972 / 1,134 are stale by +71.5% / +7.8% / +22.1%. Counts come from `headCount()` at request time, so the stale numbers live only in the PR's comments and guard docstring — **those must be rewritten, not preserved.**
2. **The "31,320 records" framing** — the real figure today is **51,896**. The PR title is wrong.
3. **The "DIBBS ingest is stale/broken" premise** — `sync-dibbs` is enabled and succeeded 2026-09-12. Per Step 5, inventory presence and freshness are separate claims: DIBBS belongs in the inventory **and** is currently fresh.
4. **The hand-maintained `MIRRORED_TABLES` array** — rework to enumerate from `cron_jobs`, or it becomes a fourth registry.
5. **The `aggregated` vs `sbir` overlap** — must be resolved *before* merge, or the page double-counts one corpus under two dataset keys (proven above: 3 resolved `.from('aggregated_opportunities')` refs inside the SBIR path).

### A defect #1339 MISSED, found by this triage
**`sbir` is mis-classified on main right now** — `provenance: 'passthrough', count: null`
while `/api/sbir` and `src/lib/sbir/search.ts` read `aggregated_opportunities`.
This is the *same* class as the grants defect #1339 did find. Any rework should
fix both rows, or the page keeps one mirrored corpus described as passthrough.

### Blocked on a product decision (not a control question)
**Is `aggregated_opportunities` its own dataset, or the store behind the existing
`sbir` dataset?** A control cannot decide this. It is the same
"canonical population vs overlay" question the P0 decisions answered for
contractors, and it needs the same treatment.

---

## Compliance

**#1339 not merged, not closed, not edited.** `/admin/data-inventory` unchanged ·
no dataset counts changed · DIBBS not refreshed · grants sync not run · aggregated
not rebuilt · no registry rows · no new controls · no production data modified.
All measurements were `SELECT`-only through the read-only client.
