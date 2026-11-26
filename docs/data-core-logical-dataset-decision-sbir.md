# SBIR / `aggregated_opportunities` logical dataset decision

**Status: DECISION TRACE ONLY. Nothing changed — `/admin/data-inventory`
untouched, #1339 not edited/merged/closed, no counts changed, no sync run, no
dataset added or removed, no guard altered.**
**Date: 2026-09-13 · main `843b00aa` · Follows the PR #1339 triage (PR #1456)**

> The Data Core should describe the products/data domains Mindy actually has —
> not mirror the names of database tables.

---

## Current contradiction

`/admin/data-inventory` on main says:

```
{ key: 'sbir', label: 'SBIR / STTR', source: 'NIH RePORTER + SBIR Multisite (live)',
  provenance: 'passthrough', count: null, note: 'queried live per search' }
```

but the SBIR product path reads a **mirrored Supabase table**:

```
src/lib/sbir/search.ts:107     .from('aggregated_opportunities').eq('opportunity_type','sbir_sttr')
src/app/api/sbir/route.ts:94   .from('aggregated_opportunities').eq('opportunity_type','sbir_sttr')
src/app/api/sbir/route.ts:219  .from('aggregated_opportunities').eq('opportunity_type','sbir_sttr')
```

**This is a product-description contradiction** — the same class as the grants
row #1339 identified: a mirrored corpus described as live passthrough holding
nothing. It is on main today, independent of #1339.

---

## Physical store evidence

**Schema:** a *generic opportunity* shape — `source`, `external_id`, `title`,
`agency`, `naics_code`, `psc_code`, `set_aside`, `opportunity_type`,
`posted_date`, `close_date`, `estimated_value`, place-of-performance,
contact fields, `status`, `raw_data`. **No SBIR-specific columns.** The table was
not built as an SBIR store.

**Row count:** **1,385** (live).

### ⚠️ Population breakdown — this overturns the premise on BOTH sides

| `opportunity_type` | rows | share |
|---|---:|---:|
| **`grant`** | **1,331** | **96.1%** |
| `sbir_sttr` | **42** | **3.0%** |
| `baa` | 12 | 0.9% |

| `source` | rows | newest `scraped_at` |
|---|---:|---|
| `nih_reporter` | 1,316 | 2026-09-08 |
| `grants_gov` | 63 | 2026-04-12 |
| `darpa_baa` | 6 | 2026-04-05 |

All 1,385 rows are `status: 'active'`.

**The table is 96% grants, and only 3% is SBIR/STTR.** Calling it "the physical
store behind SBIR" would describe 3% of it. Calling the whole thing "SBIR"
would overstate that dataset by **33×**.

**Producers:** `snapshot-multisite-nih` (`0 4 * * *`), `snapshot-multisite-darpa`
(`0 5 * * *`), `snapshot-multisite-nsf` (`0 6 * * *`) — all enabled, last runs
2026-09-13, statuses success/dispatched. A **proven** producer path (C4
`producer_proven` shape).

---

## Consumer evidence

| Consumer | Scope read | Customer-facing? |
|---|---|---|
| `src/lib/sbir/search.ts:107` | `.eq('opportunity_type','sbir_sttr')` → **42 rows** | ✅ yes |
| `src/app/api/sbir/route.ts:94` | same filter (count only) | ✅ yes |
| `src/app/api/sbir/route.ts:219` | same filter | ✅ yes |
| `src/app/api/market-scan/route.ts:714` | `.eq('status','active').in('source',['nih_reporter','nsf_sbir','sbir_gov'])` | ✅ yes |
| `src/lib/briefings/pipelines/multisite.ts` | whole table, `status='active'` only | ❌ **no importers — dead code** |
| `cron/snapshot-multisite` | writes | producer |

**No live consumer treats it as a generic "aggregated opportunities" corpus.**
The only code that reads the whole table without a type/source narrowing is
`multisite.ts`, which **nothing imports**. Every *live* consumer reads an
R&D-flavoured slice: SBIR by `opportunity_type`, market-scan by R&D `source`.

---

## Population analysis

Two facts decide this, and they point in opposite directions from the two
obvious answers:

1. **SBIR is not the dataset.** 42 of 1,385 rows (3.0%). A logical "SBIR" dataset backed by this table would report 1,385 for a population of 42.
2. **"Aggregated Opportunities" is not a product domain either.** The name is *internal and historical*. No live surface offers "aggregated opportunities" to a customer; the table is a **multi-source research/lab funding mirror** (NIH RePORTER + DARPA BAA + a stale Grants.gov slice).

The honest product domain is what the census called it in Phase 0C —
**research & lab funding opportunities that never post to SAM.gov** — of which
SBIR/STTR is one *view*.

---

## Options

### Option A — SBIR is the logical dataset, `aggregated_opportunities` is its store
**REJECTED on evidence.** The store is 96% grants. A single SBIR row backed by
this table would either report **1,385 for a 42-row population** (a 33× overstatement,
census class 13) or report 42 and leave 1,343 customer-serving rows uncounted —
the exact omission #1339 exists to fix.

### Option B — "Aggregated Opportunities" is the logical dataset, SBIR is a view
**Directionally right, wrong name.** The evidence supports one corpus with SBIR as
a filtered view (`opportunity_type='sbir_sttr'`). But "Aggregated Opportunities"
is a **table name, not a product domain** — adopting it would violate the very
principle this decision is applying.

### Option C — Two distinct logical datasets
**REJECTED.** Requires non-overlapping populations. SBIR's 42 rows are a strict
`WHERE` subset of the same table. That is one population viewed two ways —
precisely the "one physical table represented twice" the option bars.

---

## Recommendation

# Option B, with a product-domain name

**ONE logical dataset**, named for the domain rather than the table:

```
label:      Research & lab funding opportunities
store:      aggregated_opportunities (physical, not surfaced by name)
count:      live row count (currently 1,385)
provenance: curated / mirrored   (NOT passthrough)
sources:    ['NIH RePORTER', 'DARPA BAA', 'NSF', 'Grants.gov (research slice)']
note:       research/lab funding that never posts to SAM.gov; SBIR/STTR is a view over it
```

**and the existing `sbir` row is CORRECTED, not deleted** — SBIR/STTR remains a
real product surface, but it is a **view**, not a separate corpus. It must stop
claiming `passthrough / count: null` while reading a mirrored table.

Two defensible shapes for the SBIR row; **the choice is yours**:
- **(i)** keep `sbir` as a dataset row with its **own measured count** (`WHERE opportunity_type='sbir_sttr'` → 42) and a note naming it a view over the research corpus; or
- **(ii)** drop the standalone `sbir` row and name SBIR/STTR inside the research dataset's note.

**(i) is the safer default** — it preserves a real product surface on the page and
carries an honest, separately-measured 42 rather than an inherited 1,385.

---

## DIBBS / Grants consistency check

Applying the same rule — *a logical dataset is a product domain with its own
question, not a table*:

### DIBBS — ✅ **own logical dataset**
Answers a question no other dataset answers: *"what does DLA buy below the
SAM.gov posting threshold?"* FSC/NSN-coded, no SAM equivalent, its own product
surface (`/api/app/dibbs`), and it feeds the opportunity map. 48,385 rows, proven
producer (`sync-dibbs`, success 2026-09-12). **Not a slice of anything Mindy
already lists.**

### Grants — ✅ **already a logical dataset; only its CLASSIFICATION is wrong**
`key: 'grants'` already exists. Do **not** add a row. Correct
`passthrough → curated` with the real `grants_cache` count (2,126). Same defect
class as SBIR, which is why both should be fixed in one pass.

⚠️ **Watch the overlap:** `aggregated_opportunities` holds 63 `grants_gov` rows,
and `grants_cache` holds 2,126. These are **different stores** (different
producers: `snapshot-multisite-*` vs `sync-grants`). The research dataset's note
should say its Grants.gov slice is a research subset, so the two rows are not read
as double-counting.

---

## Exact rework implication for PR #1339

| # | Action | Detail |
|---|---|---|
| 1 | **ADD** one dataset row | `Research & lab funding opportunities` — count from `headCount('aggregated_opportunities')`, `provenance: 'curated'`, sources NIH/DARPA/NSF/Grants.gov-research |
| 2 | **CORRECT** the `grants` row | `passthrough → curated`, real `grants_cache` count. **Do not add a row** — it exists |
| 3 | **CORRECT** the `sbir` row | stop claiming `passthrough / count: null`; either measure `WHERE opportunity_type='sbir_sttr'` (option i) or fold into the research row (option ii). **#1339 does not do this at all** |
| 4 | **ADD** the DIBBS row | as #1339 proposed; count from `headCount('dibbs_rfqs')` (currently 48,385, not 28,214) |
| 5 | **`aggregated_opportunities` must NOT appear by name** | it is a store. #1339's label "Research & lab opportunities" was close; the *key* `aggregated` should not echo the table |
| 6 | **Rewrite every stale number** | 28,214→48,385, 1,972→2,126, 1,134→1,385; "31,320 records" → **51,896**; drop the "DIBBS ingest is stale/broken" premise (`sync-dibbs` succeeded 2026-09-12) |
| 7 | **Check the hardcoded page literals** | `distinctSources: 34` and the dataset count are C2-class literals; adding datasets without updating them creates a new contradiction |

### Guard: what survives, what must change
**Survives — the intent.** No control in C1–C5 catches *"a corpus got a sync cron
and nobody added it to the inventory."* C3 covers the three registries, not this.

**Must change — the implementation.** Three defects:
1. **Hand-maintained `MIRRORED_TABLES` array** → enumerate from **`cron_jobs`**, the canonical producer list. As written it is a fourth hand-maintained inventory.
2. **Table-level assertion** → the guard asserts a *table name* appears in the route source, which is exactly the "a table is a dataset" conflation this decision rejects. `aggregated_opportunities` should be present as a **store**, never as a dataset key.
3. **Source-text matching cannot see mis-classification** → it would have passed the `sbir` row unchanged, because `sbir` *is* mentioned. The grants/SBIR defect is a wrong `provenance`, not a missing string. The guard must assert **classification**, not presence.

---

## Compliance

`/admin/data-inventory` unchanged · #1339 not edited, merged or closed · no counts
changed · no producers changed · no syncs run · no guards altered · no registry
entries · no production data modified. All measurements `SELECT`-only through the
read-only client.
