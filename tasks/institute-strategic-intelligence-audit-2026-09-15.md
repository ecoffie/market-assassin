# Institute / Strategic Intelligence — source audit (READ ONLY)

**Snapshot T0 = 2026-09-15T22:50:57Z · audit end 22:53:20Z.** Nothing mutated, ingested or created.

## ⚠️ The prior inventory counted the wrong tables

The "~159K strategic/intelligence rows" figure came from table NAMES, not content. Re-measured:

| table | rows | what it actually is |
|---|---|---|
| `intelligence_log` | **161,442** | **Daily-alert EMAIL DELIVERY records** — `user_email`, `delivered_at`, `opened_at`, `clicked_at`. 160,991 sent + 442 failed + 9 briefing, 2,235 users. **Daily Alerts domain, not Institute.** |
| `intelligence_metrics` | **166** | **Daily-alerts CRON metrics** — emails attempted/sent/failed, `circuit_breaker_tripped`. **Daily Alerts domain, not Institute.** |

**Removing those two leaves 640 DB rows of actual Institute/Strategic evidence, not 160K.** The
real bulk of this domain is a **static file**, not a table (§5).

## 1–2. Source topology

| # | source family | store | rows | authority | producer | mode | state |
|---|---|---|---|---|---|---|---|
| A | **GAO reports (RSS)** | `institute_sources` | **36** | GAO | `institute-gao-sync` cron | automated | **live, current** |
| B | **GAO-derived pain points** | `agency_pain_points_db` | **21** | derived from A | `strategic-intel/derive.ts` | automated | live |
| C | **change ledger** | `intelligence_changes` | **21** | derived from A | `institute-gao-sync` + derive | automated | live |
| D | **GAO high-risk (GovInfo)** | `agency_intelligence` | **445** | GovInfo API | `agency-intelligence/index.ts` | manual | **FROZEN** |
| E | **contract patterns** | `agency_intelligence` | **111** | USASpending API | same | manual | **FROZEN** |
| F | **static pain points/priorities** | `src/data/agency-pain-points.json` | **5,701 assertions** | **NONE** | build script | manual | **FROZEN** |
| G | **intended-source registry** | `intelligence_sources` | 6 | — | **no writer exists** | — | **never synced** |

`agency_priorities_db`, `web_intelligence_cache`, `budget_intel_sync_runs` are **empty (0 rows)**.

## 3. Control-plane coverage

**One instance exists for the whole domain:**

| source_key | dataset | mode | state | held | clocks |
|---|---|---|---|---|---|
| `institute_gao` | `strategic_intelligence` | automated | **current** | 36 | all populated, `last_source_advance` 2026-09-15 |

| | source families | rows |
|---|---|---|
| **controlled** | 1 of 7 (A) | **36** |
| **uncontrolled** | 6 of 7 (B–G) | **604 DB rows + 5,701 static assertions** |

⚠️ **A clock discrepancy worth noting:** the instance's `last_poll` reads 20:56:48 but
`cron_job_runs` shows the only runs at 12:20 (today), 12:20 (14th) and 13:18 (13th). Something
advanced the clock outside the scheduled producer, so **`last_poll` alone is not proof the cron
ran** — same class as the `dispatched`-vs-`success` trap. Read `cron_job_runs`.

## 4. GAO source — CURRENT, CONTROLLED, AUTOMATED (verified)

| measure | value |
|---|---|
| held entries | **36** |
| distinct `document_number` | **36** (0 duplicates, **0 null**) |
| publication range | 2026-07-22 → **2026-09-15 (today)** |
| `source_watermark` | `2026-09-15` |
| resolved agency | **25** (`exact_name` / high confidence) |
| **unresolved agency** | **11 (30.6%)** |
| derived pain points | 21, across 12 agencies, **100% carry `source_url`** |
| change ledger | 21 `created` events, **21/21 linked to a source row** |
| schedule | `20 12 * * *`, enabled, last status **success** |

**Nothing has drifted.** The one weakness is agency resolution: **11 of 36 documents are
unresolved**, so roughly a third of the live GAO corpus cannot be attributed to an agency.

## 5. The historical corpus — the real finding

The largest part of this domain is **not in the database**:

`src/data/agency-pain-points.json` — **307 agencies · 3,043 pain points · 2,658 priorities =
5,701 assertions.**

Every pain point is a **plain string**:

```json
["Cybersecurity modernization and zero-trust architecture implementation",
 "Cloud migration and DevSecOps adoption"]
```

| provenance field | present |
|---|---|
| source URL | **0** |
| source document | **0** |
| publication date | **0** |
| source authority | **0** |
| agency attribution beyond the map key | **0** |

**These are Mindy-derived assertions with zero provenance, and they are customer-facing.**
Contrast the 21 GAO-derived pain points in the DB, which carry `source_url` on 100% of rows.

`agency_intelligence` (D+E) has better structure but is frozen and stale:

- **445 `gao_high_risk` rows with publication dates 1993-10-06 → 2000-09-27** — **26 to 33 years
  old.** GAO refreshes its High Risk List every two years; the current edition is 2025. Nothing
  labels these as historical.
- 111 `contract_pattern` rows have **0% publication date**.
- **`verified` is false on all 556 rows**, despite `verified` / `verified_at` /
  `verification_source` columns existing.
- Both ingested 2026-04-19 and never since.

## 6. Source vs derived

| field family | classification |
|---|---|
| `institute_sources.document_number` / `source_url` / `publication_date` / `title` / `raw` | **SOURCE_NATIVE** |
| `institute_sources.canonical_agency` / `toptier_code` / `resolution_method` | **NORMALIZED** (Mindy resolution, confidence recorded — good practice) |
| `agency_intelligence.source_url` / `publication_date` / `source_name` | **SOURCE_NATIVE** |
| `agency_intelligence.keywords` | **MINDY_DERIVED** |
| `agency_pain_points_db.pain_point` / `category` / `urgency` / `estimated_resolution_fy` | **MINDY_DERIVED** (from a cited GAO source) |
| `agency-pain-points.json` painPoints + priorities | **MINDY_DERIVED, UNKNOWN origin** |

The GAO chain models this correctly — source row → derived pain point → change ledger, with the
source id retained. The static file does not: it presents derived assertions with no marker.

## 7. Producer map

| producer | writes | class |
|---|---|---|
| `api/cron/institute-gao-sync` | `institute_sources`, `intelligence_changes` | **ACTIVE_CANONICAL** (daily, success) |
| `lib/strategic-intel/derive.ts` | `agency_pain_points_db`, `intelligence_changes` | **ACTIVE_CANONICAL** (derivation) |
| `lib/agency-intelligence/index.ts` | `agency_intelligence` | **HISTORICAL_ONLY** (frozen since 2026-04-19) |
| `scripts/import-budget-intel.js` | `agency_pain_points_db` | **LEGACY** (manual, unscheduled) |
| `api/admin/build-pain-points` | the static JSON | **MANUAL_CONTROLLED** |
| — | `intelligence_sources` | **no writer exists** — registry is inert |

## 8. Currentness

| family | oracle | verdict |
|---|---|---|
| A GAO RSS | `publication_date` + `source_watermark` | **MEASURABLE — current** |
| B/C derived | inherits A | measurable |
| D GAO high-risk | `publication_date` exists but upstream not polled | **UNMEASURED** (held is 1993–2000) |
| E contract patterns | **no publication date at all** | **UNMEASURED** |
| F static JSON | **nothing** | **UNMEASURED** |
| G registry | `last_sync_at` NULL on all 6 | **never ran** |

## 9. Identity / duplication

GAO: 36 rows / 36 document numbers / 0 null → **clean source-native identity.**
`agency_intelligence`: no source-native ID column at all — identity is the Mindy UUID.
Cross-family overlap: GAO RSS (2026) and GAO high-risk (1993–2000) are **different editions of
the same authority** and could present the same programme twice with a 30-year gap between them.

## 10. Agency attribution

| family | resolved | unresolved |
|---|---|---|
| A GAO RSS | 25 | **11 (30.6%)** |
| D GAO high-risk | 28 agencies across 445 rows | not resolution-tracked |
| E contract patterns | 111 agencies / 111 rows | 1:1 |
| F static JSON | 307 keys, **no canonical resolution at all** | n/a |

Only the live GAO source records `resolution_method` and `resolution_confidence`. That is the
right pattern and exists nowhere else in the domain.

## 11–12. Provenance and user surfaces

23 files consume this domain. Customer-facing paths include `/institute`, `/research`,
`/api/agency-sources`, `/api/budget-intel`, `/api/lindy/match`, `MyTargetListPanel`,
`proposal/agency-context.ts`, `briefings/market-assassin/data-aggregator.ts` and
`agency-hierarchy/pain-points-linker.ts`.

**A customer-facing strategic claim can be traced to source only for the GAO chain (78 rows: 36
source + 21 pain points + 21 changes).** For the static corpus feeding agency pages, proposal
context and briefings there is **no authority, no document, no date and no URL** — the claim
cannot be traced at all.

⚠️ **Historical evidence can be mistaken for current**: nothing on the 445 GAO high-risk rows
(1993–2000) marks them as historical.

## 13–14. Research / Observatory lineage

`/institute` and `/research` publish **research CONCEPTS** explicitly labelled *"Awaiting
OBS-008 / OBS-004 / OBS-009"*, plus one publication (RES-003).

**Their factual metrics do NOT depend on the uncontrolled internal corpus.** They cite external,
named sources — the Raleigh Disparity Study (with its 3% response-rate caveat stated), the
DOT/NBER highway-procurement study, published DemandStar/SOVRA pricing. OBS-009 is computed live
from USASpending per-award detail and is labelled **Beta** on its own surface.

**Publication safety: RES-003 = YES** (reproducible from cited external sources + live OBS
computation). The concepts correctly decline to publish until their OBS standard exists. This is
the healthiest part of the domain, and it is healthy because it does **not** draw on the static
corpus.

## 15. Reconciliation

| category | count |
|---|---|
| tables initially in scope | 13 |
| **misclassified (Daily Alerts, not Institute)** | **2 tables / 161,608 rows** |
| empty tables | 3 |
| **actual Institute/Strategic DB rows** | **640** |
| static-file assertions | **5,701** |
| source-native evidence rows | **481** (36 GAO RSS + 445 GAO high-risk) |
| derived intelligence rows | **159 DB** (21 pain points + 21 changes + 111 patterns) + 5,701 static |
| controlled rows | **36** |
| uncontrolled rows | **604 DB + 5,701 static** |
| full provenance (authority + doc + date + URL) | **78** (GAO chain) |
| partial provenance (URL but stale/undated) | **556** (`agency_intelligence`) |
| **no defensible provenance** | **5,701** (static corpus) |

## 16. Classification

| family | classification |
|---|---|
| A GAO RSS | **CLOSED** |
| B/C GAO-derived | **CONTROLLED_PARTIAL** (no instance of their own; inherit A) |
| D GAO high-risk | **HISTORICAL_ONLY** — and not labelled as such |
| E contract patterns | **PHASE_II_REQUIRED** (frozen, undated, uncontrolled) |
| F static corpus | **PHASE_II_REQUIRED** (largest, customer-facing, zero provenance) |
| G registry | **UNKNOWN / inert** (no writer) |

**Domain overall: PHASE_II_REQUIRED.** GAO being healthy covers **36 of 6,341** assertions —
0.6%. The domain is not complete because one source in it is.

## 17. Recommended finish order

1. **Label the static corpus** (5,701 assertions) — largest customer-facing provenance risk. Not
   an ingest problem: it needs an honest marker that these are derived, undated assertions, on
   every surface that renders them. Cheapest change, biggest truth gain.
2. **Mark the 445 GAO high-risk rows as historical (1993–2000)** — a live surface presenting
   30-year-old findings without a date is the most likely to mislead a real decision.
3. **Resolve the 11 unresolved GAO agencies** — a live, controlled, healthy source where a third
   of documents cannot be attributed.
4. **Register B/C/D/E instances** — active producers with no clocks.
5. **Decide `intelligence_sources`' fate** — a registry claiming 6 enabled sources that has never
   synced is a standing false claim about coverage.

Deliberately NOT ranked by row count: `intelligence_log`'s 161K rows leave this domain entirely.

## 18. Decision Makers drain at audit end

**140,000 / 207,067 notices (67.6%)**, cursor `2026-07-25T13:01:00Z`, `last_error` NULL,
government_buyer 205,517 · vendor_entity_poc 82,017 · unclassified 0. Untouched by this audit.

---

**READ ONLY — STOPPED FOR REVIEW.**
