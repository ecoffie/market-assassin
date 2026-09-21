# Mindy Data Core Census — Phase 0D

**Status: AUDIT ONLY — no fixes, no production data changed, no cache cleared,
no ingest run, no TTL changed, no monitor added.**
**Date: 2026-09-12 · Scope: BigQuery corpora + cache/fallback layers**
**Taxonomy: Phase 0A frozen taxonomy, applied unchanged.**

> A cache can keep a product available while hiding a dead source.
> Availability is not freshness, and job success is not data advancement.

---

## Executive Summary

| Metric | Count |
|---|---|
| BigQuery tables enumerated (authoritative) | **12** |
| — found by code scan alone | 6 (see method note) |
| Material BigQuery datasets | 12 |
| Cache/fallback paths enumerated | **10** |
| Material cache paths (customer-visible number/name) | 8 |
| — 🟢 GREEN | 6 |
| — 🟡 YELLOW | 5 |
| — 🔴 RED | 0 |
| — ⚪ GREY | 9 |
| BQ datasets with freshness monitoring | **1 of 12** (`awards`) |
| BQ datasets in any of the 3 registries | 1 of 12 (`bq_awards`) |
| New failure classes | **0** (no Phase 0D dataset demonstrated one) |
| **Fixes applied** | **0** |

### Headline

**Phase 0D found no RED.** This is the first phase with none, and the reason is
specific and worth stating plainly: **the cache/fallback layer already enforces
the integrity principle this phase was written to test.**

`src/lib/bigquery/cache.ts` distinguishes *failed* from *empty* via a
`markDegraded` side-channel, **never writes a failed result to KV**, clears the
degraded mark only on success, and is pinned by tests asserting a CO-facing page
renders **UNAVAILABLE, not NOT MET**. `target-market-research` refuses to cache a
partial result. `market-scanner` refuses to snapshot a degraded scan.

**The "degraded overwrites last-good" defect this phase hunted for was real, is
documented in code comments, and has already been fixed.** The census's job here
is to record that the control exists and holds — not to manufacture a finding.

**BigQuery is healthy and advancing:** `awards` max `action_date` **2026-09-04**,
**9 days behind** — inside the documented 21-day budget, independently confirming
the `data_sources.bq_awards` clock rather than trusting it.

---

## ⚠️ Method note — the code scan was insufficient

A literal scan for backticked `project.dataset.table` found **6** BQ tables. The
authoritative inventory is **12**. The gap: `src/lib/bigquery/client.ts` builds
every table id from a template (`` `${PROJECT_ID}.${DATASET}.awards` ``), so
six tables — `recipient_executives`, `naics_summary`, `agency_summary`,
`agency_top_recipients`, `agency_top_naics`, `agency_office_summary`,
`top_contractors_by_dimension`, `piid_lookup`, `award_detail_lookup` — are
**invisible to any grep for a literal table name**.

**This is amendment A3's failure mode in a new costume.** A3 said "resolve
imports, don't substring-match." Phase 0D shows the dual: **a template-built
identifier cannot be found by searching for the string it evaluates to.** The
inventory had to come from the `BQ_TABLES` map plus the BigQuery dataset itself.

**Proposed amendment A4 (Phase 0E):** *when identifiers are constructed at
runtime, enumerate from the constructor (the map/constant) and the live system,
never from a scan of call sites.*

---

## BigQuery Census

| Dataset | Rows | Customer-visible use | Source | Producer | Latest load | Source freshness | Completeness | Monitoring | Status |
|---|---|---|---|---|---|---|---|---|---|
| `awards` | **~63M** (3,554,980 in FY2026) | `/awards`, contractor pages, Past Awards, map | USASpending | `scripts/ingest-usaspending-awards.ts` (`npm run ingest:awards:apply`) | `data_sources.bq_awards` 2026-09-06 | **`max(action_date)` = 2026-09-04, 9 days behind** | FY-partitioned; FY2026 populated | ✅ `verify:oracles --only freshness` (21d budget) + `check-data-freshness` | 🟢 GREEN |
| `recipients_rollup_merged` | **296,445** | `/contractors`, contractor DB, MCP `search_contractors`, global lookup | derived from `awards` via `build-derived.sql` | `build-derived.sql` (rollup → name-collapse) | not independently measured | inherits `awards` | one row per company; `child_ueis[]` | ❌ none | 🟡 YELLOW |
| `recipients` | not measured | pre-rollup raw | `awards` | `build-derived.sql` | not measured | inherits | — | ❌ | ⚪ GREY |
| `recipient_executives` | not measured | executive disclosures on contractor pages | USASpending | derived build | not measured | inherits | — | ❌ | ⚪ GREY |
| `naics_summary` | not measured | NAICS rollups | `awards` | monthly derived build | not measured | inherits | pre-agg | ❌ | ⚪ GREY |
| `agency_summary` | not measured | agency rollups | `awards` | monthly derived build | not measured | inherits | pre-agg | ❌ | ⚪ GREY |
| `agency_top_recipients` | not measured | agency drill-down | `awards` | `scripts/bq-build-agency-rollups.sql` (monthly) | not measured | inherits | top-N per agency | ❌ | ⚪ GREY |
| `agency_top_naics` | not measured | agency drill-down | `awards` | same monthly build | not measured | inherits | top-N | ❌ | ⚪ GREY |
| `agency_office_summary` | not measured | Decision Makers office drill-down | `awards.awarding_office` | same monthly build | not measured | inherits | **top 100 offices/agency — a documented cap** | ❌ | 🟡 YELLOW |
| `top_contractors_by_dimension` | not measured | `/top/[slug]` listicles | `awards` | same monthly build | not measured | inherits | top-N by dimension | ❌ | 🟡 YELLOW |
| `piid_lookup` | not measured | `/contracts/[piid]` | `awards` | `build-derived.sql` | not measured | inherits | clustered lookup | ❌ | ⚪ GREY |
| `award_detail_lookup` | not measured | `/awards/[id]` | `awards` | `build-derived.sql` | not measured | inherits | clustered lookup | ❌ | ⚪ GREY |

**Monitoring coverage: 1 of 12.** Only `awards` has a freshness control. The 11
derived tables inherit `awards`' freshness *in principle*, but **nothing verifies
that a derived build actually ran after an `awards` load** — a stale
`recipients_rollup_merged` beside a fresh `awards` would be invisible. Evidence
needed for a meaningful monitor: a per-table `last_modified` from
`INFORMATION_SCHEMA.PARTITIONS`/table metadata compared against `awards`' load
time. **Not built in this phase.**

---

## Cache / Fallback Census

| Consumer | Primary | Fallback/cache | Trigger | TTL | Last write | Source age visible? | Can degraded overwrite good? | Status |
|---|---|---|---|---|---|---|---|---|
| Contractor/BQ reads (14 callers) | BigQuery | **Vercel KV** via `queryCached` | BQ error or `cacheOnly` | per-call `ttl` | — | ❌ write-time only | **NO — failure path returns `[]` and does NOT `kv.set`** | 🟢 GREEN |
| Market Research (TMR) stat cards | USASpending | `agency_target_data_cache` (621 rows) | 24h age | `CACHE_TTL_MS` 24h, **enforced on read** (`age < CACHE_TTL_MS`) | 2026-09-12 | ❌ `generated_at` only | **NO — `spendingIsPartial` skips the write** | 🟡 YELLOW |
| FPDS leaderboards | USASpending | `fpds_top_n_cache` (204) | miss | code-side | 2026-09-12 | ❌ `generated_at` only | not traced | ⚪ GREY |
| MCP external tools | EDGAR/CALC/Fed Register | `mcp_external_cache` (92,811) | miss | `expires_at` (1h–24h) | 2026-09-13 | ✅ `fetched_at` + `expires_at` | not traced | 🟡 YELLOW |
| SAM entity/opps lookups | SAM.gov | `sam_api_cache` (19,523 at re-verify; 19,504 at first read — live table) | miss | `expires_at`; **5,427 rows past expiry retained** | 2026-09-13 | ✅ `fetched_at` + `expires_at` | not traced | 🟡 YELLOW |
| Market narrative | LLM/market query | `market_narrative_cache` (30) | miss | code-side | **2026-08-15 (28 days)** | ❌ `generated_at` only | not traced | 🟡 YELLOW |
| Grants search | Grants.gov | `grants_cache` (2,126) | miss | `synced_at`/`scraped_at` | not measured | ✅ has `synced_at` | not traced | ⚪ GREY |
| Market scanner | 6 live sources | last-good snapshot | degraded scan | — | — | ✅ "as of {time}" banner | **NO — explicitly refuses to snapshot degraded** (`route.ts:811`) | 🟢 GREEN |
| Discover panel | — | `discover_panel_cache` (**2 rows**) | — | — | — | — | **0 resolved consumers** | ⚪ GREY (likely dead) |
| Web intelligence | — | `web_intelligence_cache` (**0 rows**) | — | — | — | — | empty | ⚪ GREY (likely dead) |

---

## Registry Reconciliation Matrix

| Dataset | Supabase `data_sources` | Docs registry | TS `registry.ts` | Agree? | Evidence |
|---|---|---|---|---|---|
| `awards` (BQ) | ✅ `bq_awards`, `last_built` 2026-09-06 + embedded clocks | ✅ | ❌ | ✅ **YES** | `sourceActionMax` "2026-09-04" == measured `max(action_date)` 2026-09-04 |
| `recipients_rollup_merged` | ❌ | mention (292,848 in `marketing-stats.ts`) | ❌ | ⚠️ **stale-but-conservative** | live **296,445** vs documented 292,848 |
| 10 other BQ tables | ❌ | ❌ | ❌ | n/a | absent from all three |
| All 10 cache stores | ❌ | partial mentions | ❌ | n/a | absent from all three |

**`bq_awards` is the only dataset in the entire census whose registry metadata
was mechanically confirmed against the live source.** Its `notes` carry a
machine-readable clock block (`[awards-ingest-clocks:v1]`) whose `sourceActionMax`
exactly equals the measured value. **This is the model the rest of the Data Core
lacks** — a stamp derived from the source rather than asserted.

**Note (not a Rule 9 violation):** `marketing-stats.ts` documents 292,848 while
live is **296,445**. The published figure is *lower* than reality, which is the
required direction. Recorded as drift, not as an overclaim.

---

## Monitoring Coverage

| Layer | Monitored? | What is monitored | What is NOT |
|---|---|---|---|
| BQ `awards` | ✅ | `max(action_date)` vs 21-day budget — **dataset advancement, not job execution** | — |
| 11 derived BQ tables | ❌ | nothing | whether a derived build ran after an `awards` load |
| KV/BQ cache | ⚠️ partial | degradation is *signalled* in-process (`bqDegraded`) | no persistent record; a degraded day leaves no durable trace |
| Supabase caches | ❌ | nothing | cache age vs source cadence; expired-row accumulation |

**The `awards` monitor is the one control in the whole census that satisfies the
brief's standard** — it checks that the *data advanced*, not that a job ran.
Everything else either checks nothing or checks execution.

---

## Deep Traces

### §1 — `usaspending.awards` 🟢 GREEN

```
USASpending bulk source
  → scripts/ingest-usaspending-awards.ts (npm run ingest:awards:apply, weekly)
  → BQ market-assasin.usaspending.awards (~63M, FY-partitioned, clustered)
  → build-derived.sql / bq-build-agency-rollups.sql → 11 derived tables
  → queryCached (KV) → contractor pages, /awards, map, MCP
  → customer-visible award $ and names
```
**Measured:** `max(action_date)` = **2026-09-04**, **9 days behind**;
FY2026 rows **3,554,980**; scan cost 0.053 GB.
**Registry agreement:** `data_sources.bq_awards.notes` `sourceActionMax` =
"2026-09-04" — **matches measurement exactly**.
**Status GREEN:** producer known and repeatable, advancement independently
verified, freshness monitored by advancement, registry stamp derived not asserted.

### §2 — The cache write gate 🟢 GREEN (control verified, not assumed)

`src/lib/bigquery/cache.ts` failure path (lines ~255–290):
1. BQ throws → log,
2. serve an existing stale KV copy if present (**availability preserved**),
3. otherwise `markDegraded(key, msg)` and `return []`,
4. **`kv.set` is reached only on the success path** — a failed query cannot
   become last-good,
5. `DEGRADED.delete(key)` on success, so the mark cannot stick.

Side-channel readers: `bqDegraded`, `bqDegradedReason`, `bqResultState`,
`bqUnavailable`. Pinned by `degraded-not-zero.unit.test.ts`, which asserts
consumers "never coerce unknown into 'not met'", the MCP tool "passes null
through instead of `?? false`", and "the CO-facing page shows UNAVAILABLE, not
NOT MET."

**The historical defect is documented in the code's own comment** — market-scanner
once "persisted an all-zero payload as its LAST-GOOD snapshot, later served under
an 'as of {time}' banner." **Verified fixed:** `market-scanner/route.ts:811`
now logs "scan degraded — snapshot skipped, last-good preserved", and
`target-market-research/route.ts:1455` skips the cache write when
`spendingIsPartial`.

**Unresolved:** stale-KV serving (step 2) has **no age disclosure** — a caller
receiving a stale copy cannot tell how old it is, because KV carries write time
only. Availability is preserved; freshness is not communicated. Recorded, not fixed.

---

## Observed Failure Classes

**No new class is added. No Phase 0D dataset demonstrated one.**

The brief listed nine candidate shapes. Tested, with outcomes:

| Candidate shape | Outcome |
|---|---|
| Load job succeeded but table did not advance | ❌ not observed — `awards` advanced (2026-09-04) |
| Cache timestamp newer than source data | ⚠️ **structurally possible** in 3 caches with `generated_at` only, but no instance proven |
| Stale cache masks dead ingest | ❌ not observed — ingest is live |
| Degraded result overwrites last-good | ❌ **prevented by existing controls** (§2) |
| BQ verification blocked but product serves cache | ⚠️ **by design** — `cacheOnly` default true; documented, and `bqUnavailable` exists to render it honestly |
| Fallback differs materially from primary | ❌ not observed in BQ layer |
| Cache TTL exceeds defensible window | ⚠️ `market_narrative_cache` last write **2026-08-15 (28 days)** — TTL not traced, so unproven |
| Source timestamp absent, only write-time | ✅ **observed** (3 caches) — but this is class 9 (freshness asserted without source evidence), already catalogued |
| Monitor checks job execution not advancement | ❌ **inverted** — the one BQ monitor checks advancement |

Carried forward and reconfirmed: **class 16** (monitoring coverage narrower than
the served Data Core) — 1 of 12 BQ tables, 0 of 10 caches.

---

## Phase 0D Conclusion

### Is the BigQuery layer healthy?
**Yes, for the one table that can be proven.** `awards` is 9 days behind against a
21-day budget, with a registry stamp that matches measurement. The 11 derived
tables are **Grey/Yellow — not unhealthy, unproven**: their build recency was not
independently measured.

### Can its freshness/completeness be proven?
**For `awards`, yes** — and it is the strongest evidence chain in the entire
census (source clock → registry note → oracle check → measurement agreement).
**For the derived tables, no** — nothing verifies a derived build followed an
`awards` load.

### Are cache/fallback layers hiding source failures?
**No instance found, and the primary gates actively prevent it.** Three separate
controls (`cache.ts` write gate, market-scanner snapshot refusal, TMR partial-write
refusal) enforce *degraded must never become last-good*. The residual weakness is
**disclosure**: stale KV copies carry no age, and 3 Supabase caches record only
write time.

### Are monitors checking advancement or execution?
**The one BQ monitor checks advancement** — `max(action_date)` vs a day budget.
That is the correct shape and should be the template for any future control.

### Does the metadata/provenance pattern persist?
**No — it breaks here.** 0A: frozen artifacts behind wrong claims. 0B: unregistered
artifacts and hardcoded coverage. 0C: healthy data, near-absent monitoring. **0D:
healthy data AND working integrity controls, with thin coverage.** The trajectory
is real: the closer to the live engineering core, the better the discipline.

### What remains uncensused after 0D?
- **11 derived BQ tables** — build recency and row counts unmeasured.
- **5 cache stores** — TTL/fallback paths not traced (`fpds_top_n_cache`, `grants_cache`, `market_narrative_cache`, `analyst_bid_no_bid_cache`, `compliance_matrix_cache`).
- **~180 non-material Supabase tables** (0C) — disposition pass.
- **The 6 Supabase views** — whether any masks a stale base.
- **Vercel KV itself** — key inventory never enumerated.

### Is Phase 0E necessary?
**Not for discovery — for closure.** Four phases have established the pattern and
its boundaries; a fifth *census* would hit diminishing returns. What remains is
(a) a narrow measurement pass on the 11 derived tables and 5 untraced caches, and
(b) **the taxonomy/controls step the sequence has been building toward.**

**Recommendation: the census has reached useful coverage.** The next step is
TAXONOMY → CONTROLS, using `bq_awards` as the template for what a defensible
data-freshness control looks like.

### What I proved
- 12 BQ tables enumerated authoritatively (code scan found only 6 — see A4).
- `awards` advancing: `max(action_date)` 2026-09-04, 9 days behind, FY2026 = 3,554,980 rows.
- `recipients_rollup_merged` = **296,445** (documented 292,848 — stale, conservative).
- The cache write gate cannot promote a failure to last-good (read from source, lines 255–290).
- Two previously-documented defects verified **fixed** (market-scanner snapshot; TMR partial write).
- 10 cache stores enumerated with row counts and write recency.

### What remains unknown
- Build recency of all 11 derived BQ tables (**the largest Phase 0E gap**).
- TTLs for 5 cache stores.
- Whether `discover_panel_cache` (2 rows, 0 consumers) and `web_intelligence_cache` (0 rows) are dead.
- Whether any of the 6 Supabase views masks a stale base.

### What surprised me
1. **No RED.** Four phases produced 6 REDs; this one produced none — because the controls the phase was written to test already exist and hold.
2. **The code scan found half the tables.** Template-built identifiers are invisible to grep — A3's dual, now amendment A4.
3. **`bq_awards` is the only registry entry in the whole census whose stamp matches a measured source value.** It should be the model, and it already exists in-repo.
4. **The cache comment documents its own historical bug in detail** — that is how the fix was verifiable at all. Comments as a provenance record turned out to be an asset here, having been a trap in 0B.

### What changed from Phase 0C assumptions
- 0C predicted caches were "the class most likely to hide an ingest failure." **Falsified** — they are the best-controlled layer found.
- 0C's class 16 **confirmed and extended** to BQ (1/12) and caches (0/10).
- 0C assumed BQ freshness would be hard to verify. **It was the easiest**, because the ingest writes a machine-readable clock.

---

## Re-Verification Log (pre-commit)

| Claim | First pass | Re-verified | Result |
|---|---|---|---|
| `awards` max `action_date` | 2026-09-04 (9d) | 2026-09-04 (9d) | ✅ |
| `awards` FY2026 rows | 3,554,980 | 3,554,980 | ✅ |
| `recipients_rollup_merged` | 296,445 | 296,445 | ✅ |
| `agency_target_data_cache` | 621 (620 past TTL) | 621 (620) | ✅ |
| `mcp_external_cache` | 92,811 | 92,811 | ✅ |
| `sam_api_cache` | 19,504 | **19,523** | ⚠️ **CHANGED (+19)** — the table is actively writing between reads. Reported, not preserved. Expired-row count 5,427 unchanged. |
| `fpds_top_n_cache` / `market_narrative_cache` / `grants_cache` | 204 / 30 / 2,126 | identical | ✅ |
| `discover_panel_cache` / `web_intelligence_cache` | 2 / 0 | identical | ✅ |
| BQ tables enumerated | 12 | 12 | ✅ |

A live counter moving between two reads is **expected behaviour, not drift** —
recorded because the contract requires reporting any number that changes.

---

## Compliance

**No fixes. No production data changed. No cache cleared or rebuilt. No ingest
run or restarted. No TTL, cron, registry, or `last_built` modified. No monitors
added.** BigQuery reads were `SELECT`-only through the cost-capped read-only
client (total scanned: 0.053 GB, est. $0.00032). Supabase reads were `SELECT`-only.
The only write is this file.

Phase 0A, 0B, and 0C documents were **not modified**.
