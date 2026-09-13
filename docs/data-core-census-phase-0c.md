# Mindy Data Core Census — Phase 0C

**Status: AUDIT ONLY — no fixes, no production data changed, no freshness stamps.**
**Date: 2026-09-12 · Scope: customer-facing Supabase-backed Data Core**
**Taxonomy: Phase 0A frozen taxonomy, applied unchanged.**

> The census is itself a claims-producing artifact. If a claim cannot be
> mechanically defended, it is marked Grey rather than made to look complete.

**Method (amendment A3, from Phase 0B):** every consumer count below is a
**resolved `.from('<table>')` query reference** in `src/app|lib|components|mcp`,
with comments stripped. No substring matching. `customer-facing` excludes
`/api/admin/`.

---

## Executive Summary

| Metric | Count |
|---|---|
| Supabase objects enumerated | **197** (191 tables, 6 views) |
| Material datasets censused (Pass 1) | 16 |
| — 🟢 GREEN | 4 |
| — 🟡 YELLOW | 5 |
| — 🔴 RED | 2 |
| — ⚪ GREY | 5 |
| In Supabase `data_sources` as live-monitored | **0 of 16** |
| In `registry.ts` | **1 of 16** (`agency_forecasts`) |
| Tables monitored by `LIVE_SYNC_CHECKS` | **1 of 197** (`federal_contacts`) |
| Hardcoded numeric literals in `registry.ts` | **32** |
| — matching live measurement | 18 |
| — contradicted by measurement | 5 |
| — untestable / not live-backed | 9 |
| New failure classes | 1 (class 16) |
| **Fixes applied** | **0** |

### Headline

**The live Supabase Data Core is materially healthier than the curated layer.**
Every high-volume customer-facing pipeline measured is *current*
(`sam_opportunities` posted through 2026-09-12, `recompete_opportunities` synced
2026-09-13, `alert_log`/`briefing_log`/`user_engagement` all writing today). This
is the opposite of Phases 0A/0B, where curated artifacts were frozen for months.

**But the monitoring is nearly absent.** `LIVE_SYNC_CHECKS` watches **one table
out of 197**. The freshness system's blind spot is not that it monitors the wrong
store — it is that it monitors **almost no store at all**. That the pipelines are
healthy today is therefore *unevidenced by any control*; it was established here
by direct measurement, and nothing would have raised an alarm had it been false.

---

## Dataset Census (Pass 1)

Consumers = resolved `.from()` refs (total / customer-facing).

| Dataset | Rows | Consumers | Customer-visible use | Producer | Freshness evidence | Coverage | Registry | Status |
|---|---|---|---|---|---|---|---|---|
| `sam_opportunities` | **206,064** (35,743 active) | 83 / 66 | opportunity search, alerts, map, MCP | `cron/sync-sam-opportunities` | `max(posted_date)` **2026-09-12**; `max(synced_at)` 2026-09-12 | naics 96.0%; **description 57.3%**; **pop_state 34.3%**; sow_text 15.2% | docs only | 🟡 YELLOW |
| `federal_contacts` | **247,030** | 6 / 6 | buying-office POC rosters | daily SAM sync | `max(updated_at)` **2026-09-12** | — | docs + **only** `LIVE_SYNC_CHECKS` entry | 🟢 GREEN |
| `recompete_opportunities` | **171,729** (140,079 real) | 22 / 21 | Recompetes panel, MCP expiring contracts | `cron/sync-recompete-contracts` | `max(last_synced_at)` **2026-09-13** | 31,650 rows flagged `grouped_synthetic`, excluded by `query.ts` | docs only | 🟢 GREEN |
| `alert_log` | **166,181** | 19 / 12 | alert dedup + delivery history | `cron/daily-alerts` | `max(created_at)` **2026-09-12** | — | docs only | 🟢 GREEN |
| `briefing_log` | **60,597** | 31 / 19 | briefing dedup/delivery | briefing crons | `max(created_at)` **2026-09-12** | — | docs only | 🟢 GREEN |
| `user_notification_settings` | **10,810** | **127 / 88** | alert frequency, NAICS targeting | app writes | live | — | docs only | 🟡 YELLOW |
| `user_pipeline` | **8,017** | 35 / 24 | pursuit tracking | app writes | live | — | docs only | 🟡 YELLOW |
| `sam_events` | **4,945** | 8 / 7 | federal events, MCP | event sync | `max(extracted_at)` **2026-09-12** | — | docs only | 🟡 YELLOW |
| `agency_forecasts` | **33,687** | 18 / 15 | `/forecasts`, MCP | `import-forecasts.js` + variants | rows to 2026-09-12 | 20+ agencies | all three — **and they disagree** | 🔴 RED (Phase 0A) |
| `agency_intelligence` | **557** | 2 / 1 | pain points | `merge-agency-intelligence.js` | `max(created_at)` **2026-04-19** | `verified` 0/557 | docs + `data_sources` | 🔴 RED (Phase 0A) |
| `sam_entities` | **910,126** | 3 / 3 | entity/UEI lookup | SAM entity extract | not measured | not measured | docs mention only | ⚪ GREY |
| `aggregated_opportunities` | not measured | 6 / 5 | multisite opportunities | multisite scrapers | not measured | not measured | docs only | ⚪ GREY |
| `dibbs_rfqs` | not measured | 6 / 6 | DIBBS RFQs | `cron/sync-dibbs` (**known paused**) | not measured | not measured | docs only | ⚪ GREY |
| `recipient_certifications` | **24,899** | 1 / 1 | UEI→certifications | backfill | not measured | not measured | none | ⚪ GREY |
| `sba_goaling` | not measured | 3 / 3 | MCP `get_sba_goaling_share` | import | not measured | not measured | **none of the three** | ⚪ GREY |
| `naics_vocabulary` | **25,252** | 1 / 1 | alerts, onboarding, chips | `build-naics-vocabulary.ts` | `refreshed_at` 2026-07-11 | 1,013 codes | docs only | 🟢 GREEN (Phase 0A) |

**Dead tables found (0 rows, 0 consumers):** `agency_pain_points_db`,
`agency_priorities_db` — the pain-points data serves from JSON (3,045 points);
these DB tables were created and never populated or read. Not a serving risk;
recorded for Phase 0D disposition. **Not deleted.**

---

## Registry Reconciliation Matrix

| Dataset | Supabase `data_sources` | Docs registry | TS `registry.ts` | Agree? | Evidence |
|---|---|---|---|---|---|
| `sam_opportunities` | ❌ (only as `live_api` source, not the table) | ✅ | ❌ | n/a — absent from 2 of 3 | grep: docs=3 hits, ts=0 |
| `recompete_opportunities` | ❌ | ✅ | ❌ | n/a | docs=2, ts=0 |
| `alert_log` | ❌ | ✅ | ❌ | n/a | docs=1, ts=0 |
| `briefing_log` | ❌ | ✅ | ❌ | n/a | docs=1, ts=0 |
| `user_notification_settings` | ❌ | ✅ | ❌ | n/a | docs=1, ts=0 |
| `user_pipeline` | ❌ | ✅ | ❌ | n/a | docs=1, ts=0 |
| `federal_contacts` | ✅ (as `federal_contacts_sync` live check) | ✅ | ❌ | partial | the sole `LIVE_SYNC_CHECKS` entry |
| `sam_events` | ❌ | ✅ | ❌ | n/a | docs=1, ts=0 |
| `agency_forecasts` | ✅ (`last_built` **NULL**) | ✅ (**9,973**) | ✅ (per-source counts) | ❌ **NO** | live=**33,687**; docs=9,973; `data_sources.last_built`=NULL |
| `agency_intelligence` | ✅ (`last_built` 2026-08-01) | ✅ | ❌ | ❌ **NO** | live `max(created_at)`=**2026-04-19** |
| `naics_vocabulary` | ❌ | ✅ | ❌ | n/a | Phase 0A finding: Green but unmonitorable |
| `dodaac_directory` | ✅ | ✅ | ❌ | — | docs=3, ts=0 |
| `sam_entities` | ❌ | mention only | ❌ | n/a | 910,126 rows in no registry |
| `aggregated_opportunities` | ❌ | ✅ | ❌ | n/a | docs=3, ts=0 |
| `dibbs_rfqs` | ❌ | ✅ | ❌ | n/a | docs=1, ts=0 |
| `sba_goaling` | ❌ | ❌ | ❌ | n/a | **in none of the three registries** |

**Result: 0 of 16 material tables are registered as live-monitored datasets in
Supabase `data_sources`.** One (`agency_forecasts`) appears in all three and the
three disagree.

---

## Coverage Claim Audit

`src/lib/data-sources/registry.ts` carries **32 hardcoded numeric literals**
(`recordCount` / `coveragePercent`). Tested against live measurement:

### ✅ Matching (18) — forecast per-source `recordCount`

navy 8821 · doi 6164 · usda 5028 · hhs 3643 · usace 2908 · va 1390 · doe 1301 ·
dot 897 · gsa 514 · doj 500 · nasa 225 · treasury 200 · dol 166 · nrc 89 ·
ssa 60 · epa 50 · onr 48 · nrl 12 — **all exactly equal to
`select count(*) from agency_forecasts group by source_agency`.**

*This is the Phase 0C surprise: most of the hardcoded numbers are correct.* They
were maintained carefully. That does not make them safe — they are literals with
no mechanism to stay correct — but the audit must report that they are, today,
right.

### ❌ Contradicted (5)

| Literal | Claim | Measured | Delta |
|---|---|---|---|
| `registry.ts:203` Contractors `coveragePercent` | **95** | contact fields **1.2–2.6%** | Phase 0B class 15 |
| `registry.ts:111` pain-points `recordCount` | **2765** ("250 agencies") | **3,045** points / **307** agencies | understated |
| `registry.ts:124` `sba-prime` `recordCount` | **3500** | `contractors.json` **2,768** | overstated 26% |
| `registry.ts` dhs forecast `recordCount` | **1015** | **1,634** | 61% understated |
| `registry.ts` nsf forecast `recordCount` | **33** | **37** | drifted |
| `registry.ts:114` agency-aliases | 450 | 454 | within rounding, noted |

### Untestable (9)
`coveragePercent` values 60/80/70/90/85/0 for Agencies/Opportunities/Market
Scan/etc. have **no defined denominator** — there is no stated population against
which "80% coverage" could be checked. **Grey: unfalsifiable by construction.**

---

## Unregistered Material Supabase Datasets

**All 16 material datasets are absent from Supabase `data_sources` as monitored
live stores.** Highest-consequence:

| Dataset | Rows | Why it matters |
|---|---|---|
| `sam_entities` | **910,126** | largest table found; entity/UEI lookups; in no registry |
| `sam_opportunities` | 206,064 | the core customer surface; 66 customer-facing consumers |
| `federal_contacts` | 247,030 | the ONLY live-monitored table |
| `recompete_opportunities` | 171,729 | Pro feature; moat |
| `alert_log` | 166,181 | delivery history / dedup |
| `sba_goaling` | — | MCP tool; **in none of the three registries** |

**No registry rows were added.** All remain **UNREGISTERED / UNRECONCILED**.

---

## Observed Failure Classes

Phase 0A/0B classes carried forward. **One new class:**

| # | Class | Phase 0C instance |
|---|---|---|
| 3 | Registry build date contradicts artifact | `agency_intelligence` stamp 2026-08-01 vs data 2026-04-19 (carried) |
| 5 | Duplicate stores | pain points: JSON (3,045) vs `agency_pain_points_db` (**0 rows**) |
| 6 | Sparse field used as if complete | `sam_opportunities.pop_state` 34.3% — **honestly documented**, so Yellow not Red |
| 9 | Freshness asserted without evidence | `agency_forecasts.last_built` NULL while table demonstrably advancing |
| 10 | Served dataset absent from registry | 16/16 material tables |
| 15 | Hardcoded coverage claim in code | `coveragePercent: 95` (carried from 0B); 5 contradicted literals |
| **16** | **Monitoring coverage far narrower than the served Data Core** | **`LIVE_SYNC_CHECKS` watches 1 table of 197.** Every other live store can fail silently; health is unobserved rather than observed-good |

Class 16 is new and distinct from class 10. Class 10 is *"this dataset is not in
a registry."* Class 16 is *"the monitoring system's scope is a rounding error
against the thing it is supposed to monitor"* — a property of the **control**,
not of any one dataset. It is why Phase 0C's good news is unverifiable by the
system itself.

---

## Phase 0C Conclusion

### Does the metadata/provenance pattern persist in live DB-backed data?

**Partly — and it inverts.** The live tables are *fresh and healthy*; the failure
has moved from the data to the **controls**. Phases 0A/0B found claims that
contradicted artifacts. Phase 0C finds claims that are largely **correct but
unverifiable**, guarded by monitoring that covers 1 table in 197.

### Are freshness checks observing the correct served stores?

**No — they observe almost none.** `LIVE_SYNC_CHECKS` = 1 entry
(`federal_contacts`). `sam_opportunities` (206K rows, 66 consumers),
`recompete_opportunities`, `alert_log`, `briefing_log` and `sam_entities` (910K)
have **no freshness monitoring at all**. Their health today was established by
this census, not by any control.

### Are hardcoded claims contradicting live measurements?

**5 of 32 are contradicted**; 18 match exactly; 9 are unfalsifiable (no
denominator). The worst remains `coveragePercent: 95` vs 1.2–2.6%.

### Greatest decision risk

1. **`coveragePercent: 95`** (Contractors) — a quality claim in code, 40× off.
2. **`agency_intelligence`** — 4-month-stale data behind a fresh stamp.
3. **Class 16 generally** — 196 of 197 stores can degrade silently.
4. **`sam_entities`** (910K) — largest table, unregistered, unmeasured here.

### What I proved
- 197 objects enumerated independently; 16 material by resolved-consumer evidence.
- Live freshness measured directly: sam 2026-09-12, recompete 2026-09-13, alert/briefing/engagement 2026-09-12.
- Field coverage measured on the core surface (naics 96.0%, description 57.3%, pop_state 34.3%, sow 15.2%).
- 32 registry literals tested: 18 exact, 5 contradicted, 9 unfalsifiable.
- `LIVE_SYNC_CHECKS` = 1 of 197, read from source.

### What remains unknown (explicit Grey evidence gaps)
- `sam_entities` (910K): producer, cadence, coverage — **unmeasured**.
- `aggregated_opportunities`, `dibbs_rfqs`, `recipient_certifications`, `sba_goaling`: row counts and freshness **unmeasured**.
- Whether `dibbs_rfqs` is still paused (CLAUDE.md says blocked on an Apify token).
- Fallback/cache behavior of `agency_target_data_cache`, `fpds_top_n_cache`, `discover_panel_cache` — **not traced**.
- Whether the 6 views mask stale bases.

### What surprised me
1. **The live layer is healthy.** After two phases of frozen artifacts, every high-volume pipeline is current. The census must report good news as readily as bad.
2. **Most hardcoded literals are right.** 18/20 forecast counts match live exactly — the opposite of the Phase 0B expectation that literals rot.
3. **Monitoring covers 1 table in 197.** The largest finding is an absence, not a contradiction.
4. **Two pain-points DB tables exist with 0 rows and 0 consumers** while the JSON serves — a store created, never filled, never read, never noticed.

### What changed from Phase 0A/0B assumptions
- "Hardcoded literals drift" — **partially falsified**; most are accurate.
- "The pattern is bad metadata" — **refined**: in the live layer it is *missing controls*, not wrong claims.
- Phase 0B's 253→9 correction held: Phase 0C used resolved `.from()` refs from the outset and produced counts consistent with manual inspection.

### Is the method still holding?

**Yes.** Amendment A3 applied from the start. Two measurement errors were caught
and corrected mid-pass before classification (a missing `is_active` column, a
missing `created_at` on `federal_contacts`) — in both cases the probe was wrong,
not the data, and the fix was to read the schema first. No claim in this document
rests on an unverified column.

### Is Phase 0D warranted?

**Yes.** Remaining outside 0A–0C coverage:
- **BigQuery** (`recipients_rollup_merged` 292,848, `usaspending.awards` ~63M) — the largest corpora, entirely uncensused.
- **Cache/fallback tables** (`agency_target_data_cache`, `fpds_top_n_cache`, `discover_panel_cache`, `mcp_external_cache`, `sam_api_cache`) — the class most likely to hide an ingest failure.
- **The 5 Grey tables** above.
- **The 6 views** and the ~180 non-material tables, for a disposition pass.

---

## Compliance

**No fixes applied. No production data changed. No freshness state changed. No
registry rows added. No cron schedules touched. No hardcoded claims edited.** All
reads were `SELECT`-only through a read-only client. The only write is this file.

Phase 0A and Phase 0B documents were **not modified**.
