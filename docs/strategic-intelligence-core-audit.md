# Mindy Strategic Intelligence Core — Architecture & Freshness Audit

**Date:** 2026-09-13 · **Scope:** the *why* layer (pain points, priorities, agency
intelligence, budget authority, forecasts, Event Radar, decision makers), plus the
upstream policy signals that should feed them.
**Status:** evidence-first audit. **No repairs performed.** All figures below were
measured live against production Supabase / BigQuery / the repo on 2026-09-13.

> **Headline answer.** The strategic intelligence layer is a **high-quality curated
> corpus with a manual refresh ritual — not a continuously updating intelligence
> system.** The procurement layer beneath it (SAM, recompetes, forecasts, events) *is*
> living and advances daily. The interpretive layer on top (pain points, priorities,
> budget) advances only when a human re-runs a script; it has done so **twice in five
> months**. Nothing is broken. It simply is not yet a feed.

---

## 1. Current architecture

| Domain | Physical store | Rows (measured) | Producer | Last **data** advance | Cadence (actual) |
|---|---|---:|---|---|---|
| Agency pain points | `src/data/agency-pain-points.json` (**static file in the bundle**) | **3,045** across **307** agency keys | `scripts/merge-agency-intelligence.js`, hand-run | **2026-08-01** (git commit `eb87ba69`) | manual, ~quarterly |
| Agency spending priorities | same JSON file | **2,658** | same merge script | **2026-08-01** (+47 priorities) | manual, ~quarterly |
| Agency intelligence | Supabase `agency_intelligence` | **557** (446 `gao_high_risk`, 111 `contract_pattern`) | `POST /api/admin/sync-agency-intel` (**admin route, no cron**) | **2026-08-01** (450 rows upserted) | manual, episodic |
| Budget authority | `src/data/agency-budget-data.json` (static) | **47 agencies** | `/api/admin/build-budget-data`, hand-run | **2026-02-18** (`lastUpdated` in file) | **~7 months stale** |
| Forecasts / upcoming buys | Supabase `agency_forecasts` | **33,687** | cron `sync-forecasts` `0 13 * * *` | **2026-09-12** | **daily, automated** |
| Event Radar | Supabase `sam_events` | **4,945** (only **508 upcoming**) | cron `extract-sam-events` `0 7 * * *` | **2026-09-13** | **daily, automated** |
| Decision makers | Supabase `federal_contacts` | **247,030** | `cron/sync-gov-buyer-data` | rolling | automated |
| Buying offices | Supabase `dodaac_directory` | **4,826** | cron `refresh-dodaac-directory` (monthly) | 2026-09-06 | monthly |

⚠️ **Two Supabase tables named for this data are EMPTY:** `agency_pain_points_db`
(**0 rows**) and `agency_priorities_db` (**0 rows**). Nothing reads or writes them.
The live data is the **JSON file compiled into the build** — which means *a pain-point
update requires a code deploy*, not a data write. This is the single most important
structural fact in this audit.

### The central question
> *If an important government document is published tomorrow, when does it become part
> of Mindy's intelligence?*

**Answer: it does not, until a human notices and re-runs a script.** There is no
subscription, poller, or webhook on any policy source. The only automated actor is
`cron/check-data-freshness` (`5 13 * * *`), which — by deliberate design — **emails a
human a refresh checklist** rather than fetching anything. Its own registry entry says
the remedy for pain points is `scripts/merge-agency-intelligence.js + scan-ndaa-sections.py`.
That is a **nag, not a pipeline** — and it is honest about being one.

---

## 2. Pain-point lineage

**Traced chain, as actually implemented:**

```
GAO / NDAA / budget docs
   └─ (MANUAL) human runs sync-agency-intel + scan-ndaa-sections.py
        └─ agency_intelligence (Supabase, 557 rows)
             └─ (MANUAL) scripts/merge-agency-intelligence.js
                  └─ src/data/agency-pain-points.json  ← compiled into the build
                       └─ pain-points-linker.ts
                            └─ target-market-research / customer-report / /api/pain-points
```

**Classification: MANUALLY CURATED (with a partially automated ingest step).**
Evidence: 9 commits in 9 months, all authored by Eric; no `cron_jobs` row for any
pain-point or intelligence job; `agency-intelligence/index.ts:12` states the fetchers are
*"exported under `fetchers` for manual/diagnostic use, but **NOT part of a full sync**."*

### The data model — what actually exists

Every pain point is a **bare string**. Measured: **3,045 of 3,045 elements are type
`str`.** The agency record has exactly four keys: `painPoints`, `priorities`, and (on one
agency) `note` / `see_also`. There is no record object, so there is nowhere to put
provenance.

| Field the user asked about | Exists? | Evidence |
|---|---|---|
| Agency | ✅ | JSON object key |
| Problem / pain text | ✅ | the string itself |
| Evidence source | ⚠️ **9.2%** | only **280 of 3,045** carry `(Source: GAO)`; **2,765 have no tag**. **0 of 2,658 priorities** carry any tag |
| Source date | ❌ | no field; 593 strings happen to mention a year in prose |
| As-of / effective date | ❌ | none |
| Source URL / document id | ❌ | **0 of 3,045 contain a URL** |
| Confidence / evidence level | ❌ | none |
| Status (emerging/active/declining/resolved) | ❌ | none — **nothing can ever be marked resolved** |
| Related program / mission | ❌ | only implied in prose |
| Related spending / budget | ⚠️ prose only | see §3 |
| Buying implication | ❌ | none |
| NAICS / PSC | ⚠️ derived, 18 codes | `getPainPointsByNaics` is a **hardcoded 18-NAICS keyword map**; any other code returns `[]` |

**Coverage caveat on the "307 agencies" claim:** **50 of the 307 agency keys have zero
pain points** (and 6 have zero priorities). Real pain-point coverage is **257 agencies**,
not 307. The 3,045 count is accurate; the agency count is not.

---

## 3. Priority lineage

Same file, same manual merge, same absence of structure — but **richer content**:

- **1,846 of 2,658 priorities (69.5%) contain a dollar figure** in prose
  (e.g. *"$6.2B allocated for hypersonic weapons development in FY2025-2026"*).
- **1,483 of 2,658 (55.8%) cite a fiscal year.**
- **0 of 2,658 carry a source tag, URL, or structured amount.**

> **Can Mindy detect that a priority has changed?** **No.** Priorities are overwritten by
> a whole-file merge. There is no history table, no diff, no `recompete_changes`-style
> append-only log for intelligence. A priority that shifts between refreshes is
> **silently replaced and the prior state is unrecoverable.**

> **Can Mindy distinguish a *stated* priority from a *funded* one?** **Not queryably.**
> The distinction largely exists in the prose ("allocated", "requested", "budgeted"), but
> because the amount, FY, and funding status are unparsed text, no surface can filter or
> rank on it. The information is present; the schema to use it is not.

---

## 4. Legislation / policy ingestion

Searched `src/` and `scripts/` for real fetch code (not prose). **Six files actually
fetch a policy host** — and their wiring is the finding:

| Fetcher | Wired to a producer? | Reality |
|---|---|---|
| `src/lib/agency-intelligence/fetchers/govinfo.ts` (GAO reports, budget docs) | ⚠️ imported only by `agency-intelligence/index.ts`, explicitly **excluded from full sync** | runs only on a manual admin call |
| `src/lib/agency-intelligence/verifier.ts` | ⚠️ same | manual |
| `src/lib/federal-register/index.ts` | ✅ live | but serves the **MCP `get_regulatory_demand` tool per-request** — it is a passthrough lookup, **it never writes intelligence** |
| `src/lib/briefings/web-intel/{rss,serper,query-generator}.ts` | ❌ **no importers found** | orphaned |

**Verdict by signal type:**

| Signal | Ingestion pipeline | Reality |
|---|---|---|
| Introduced / passed bills | ❌ **none** | `api.congress.gov` appears in **0 files** |
| Enacted laws | ❌ none | — |
| Appropriations | ❌ none | mentioned in prose only |
| NDAA | ⚠️ **manual** | `scan-ndaa-sections.py` lives outside this repo (`~/Bootcamp`); **46 NDAA-derived pain points across 20 agencies** did land in the Aug 1 pass — proof the *content* path works when a human runs it |
| Executive orders | ❌ none | — |
| GAO reports | ⚠️ manual | GovInfo fetcher exists, not scheduled |
| IG reports | ❌ none | `oversight.gov` has no fetcher |
| CRS | ❌ none | cited in docs as a source; **no code** |
| Budget justifications | ❌ none | static JSON, last built 2026-02-18 |
| Federal Register | ✅ live, **but not persisted** | per-request MCP passthrough only |

**On the evidence-strength taxonomy (SIGNAL → STRONG → POLICY → FUNDED → PROCUREMENT):**
**no equivalent exists today.** Mindy collapses all of it into one flat `priorities`
string array. A proposed bill, an enacted law, and an appropriated dollar are
indistinguishable to every consuming surface.

---

## 5. Continuous intelligence test (real trace, not manufactured)

Using the actual Aug 1 refresh (`eb87ba69`) — the most recent real advancement:

| Step | Result |
|---|---|
| New source material appeared (GAO/NDAA, FY2026) | ✅ yes |
| Did Mindy ingest it automatically? | ❌ **no** — a human ran `POST /api/admin/sync-agency-intel` |
| Did `agency_intelligence` change? | ✅ **yes** — 793 fetched → 450 upserted; 111 `contract_pattern` + 339 `gao_high_risk` rows stamped `updated_at = 2026-08-01` |
| Did a pain point change? | ⚠️ **+47 priorities, 0 new pain points** (the commit message says so explicitly) |
| Can a user discover the change? | ❌ **no** — no changelog, no "new this quarter" surface, no diff |
| Is the claim sourced? | ❌ **no** — the resulting strings carry no URL or date |

The commit message is itself the best evidence in this audit, and it is admirably
honest: pain points were *"123d stale (quarterly cadence)… the upstream
`agency_intelligence` table was itself last written 2026-04-19, so a merge alone would
have regenerated an identical file and turned a truthfully firing freshness alert
green."* **The team already knows the shape of this problem and refused to fake-green it.**

---

## 6. Event Radar

**Producer:** `cron/extract-sam-events` (`0 7 * * *`, last success 2026-09-13). It is a
**regex extractor** (`text.match(pattern)`) over `sam_opportunities` rows whose
`notice_type` is `Special Notice`, `Presolicitation`, or `Sources Sought`. Real,
automated, advancing daily.

**The useful metric — actionable upcoming events:**

| Measure | Value |
|---|---:|
| Total records | 4,945 |
| **Upcoming (`event_date >= today`)** | **508 (10.3%)** |
| Past events still in the pool | **4,354 (88.0%)** |
| No date at all | 83 |
| Upcoming **with a registration URL** | **0** |
| Upcoming with an inferred buying office (DoDAAC) | 231 of 508 (45%) |

**By type (upcoming):** RFI 414 · **industry day 76** · forecast 14 · webinar 4 ·
conference 0.

**Findings:**
- **Past and upcoming events are mixed in the same table with no expiration handling.**
  Any surface that renders a raw count shows ~4,945 when only ~508 are actionable.
- **Registration URL coverage is 0%** — the column exists and is never populated, so the
  single most action-enabling field is absent.
- **Coverage is structurally bounded by SAM.** Because the only input is SAM notices,
  Event Radar cannot see matchmaking events, procurement conferences, or agency outreach
  published elsewhere — which is exactly why `conference` totals 5 records all-time.
- Office/agency resolution does work (`inferred_dodaac` / `inferred_office`) for 45% of
  upcoming events.

---

## 7. Forecast integration

**The healthiest strategic dataset.** 33,687 rows, cron-driven daily, last synced
2026-09-12. Coverage of decision-relevant fields:

| Field | Coverage |
|---|---:|
| Contracting office | 99.8% |
| NAICS | 82.4% |
| POC email | 58.3% |
| Set-aside | 49.4% |
| PSC | 21.3% |
| **`anticipated_award_date`** | **0.2%** |

Two caveats worth naming: **`anticipated_award_date` is effectively unpopulated (0.2%)**,
so "when will they buy" leans on `fiscal_year`/`anticipated_quarter`; and **3,504 rows are
FY2025-or-earlier** (plus 4,826 with no FY), meaning expired forecasts sit alongside live
ones in the same pool — the same past/upcoming mixing seen in Event Radar.

---

## 8. Cross-dataset relationships — the moat question

The target chain is:
`Pain Point → Priority → Budget → Forecast → Buying Office → Decision Maker → Opportunity`

**Measured state of each link:**

| Link | Exists? | How |
|---|---|---|
| Pain point → Agency | ✅ | JSON key |
| Priority → Agency | ✅ | JSON key |
| Pain point → Priority | ❌ | two parallel arrays, never related |
| Priority → Budget | ❌ | budget is a separate 47-agency static file; no join key |
| Pain point → NAICS | ⚠️ | hardcoded **18-code** keyword map only |
| Pain point → Forecast | ❌ | none |
| Pain point / Priority → Opportunity | ❌ | none |
| Agency → Buying office | ✅ | `dodaac_directory`, real |
| Buying office → Decision maker | ✅ | `federal_contacts` + DoDAAC prefix anchoring — **the strongest link in the system** |
| Office → Opportunity / Recompete | ✅ | `solicitation_number` prefix |
| Agency → Events | ✅ | `inferred_dodaac` |

**Conclusion:** the **action half** of the chain (office → contact → opportunity → event)
is genuinely connected and is real engineering. The **intelligence half** (pain →
priority → budget → forecast) is **co-displayed, not connected.** In
`target-market-research/route.ts` pain points enter the product as
**`painPointCount`** — a number on an agency row, shown beside `openOppCount` and
`upcomingEventCount`. Nothing asserts that a given pain point *causes* a given buy.

**So the moat as described — "agency has cyber pain → budget → legislation → forecast →
office → official → opportunity" — does not exist as a traversable graph today.** Its
two ends exist; the middle is prose.

---

## 9. Freshness by signal type — expected vs actual

| Signal | Reasonable cadence | Actual | Status |
|---|---|---|---|
| SAM special notices → Event Radar | daily | **daily cron** | **LIVING** |
| Forecasts | source-specific | **daily cron** | **LIVING** |
| Decision makers / offices | rolling / monthly | cron | **LIVING** |
| Legislation & enacted law | daily–weekly | **no pipeline** | **ABSENT** |
| Executive orders | event-driven | **no pipeline** | **ABSENT** |
| GAO / IG | daily–weekly discovery | manual, 2× in 5 months | **STATIC** |
| Budget justifications | annual cycle | last built **2026-02-18** | **STATIC (stale)** |
| Pain points | on material new evidence | manual, 2026-08-01 | **STATIC** |
| Priorities | on policy/budget change | manual, 2026-08-01 | **STATIC** |

---

## 10. Strategic intelligence scorecard

| Intelligence domain | Records | Sources | Producer | Last advance | Update mechanism | Customer use | Status |
|---|---:|---|---|---|---|---|---|
| Agency pain points | 3,045 (257 real agencies) | GAO, NDAA, curation | hand-run merge script | 2026-08-01 | **human ritual + deploy** | market research, customer reports, content gen | **STATIC** |
| Agency priorities | 2,658 | budget prose, NDAA | hand-run merge script | 2026-08-01 | **human ritual + deploy** | same | **STATIC** |
| Agency intelligence | 557 | GovInfo (GAO), USASpending | admin route, no cron | 2026-08-01 | **manual trigger** | agency intel surfaces, MCP `get_agency_intel` | **PARTIAL** |
| Budget authority | 47 agencies | OMB FY2026 request + CBJs | hand-built JSON | **2026-02-18** | **manual, overdue** | budget-authority API, reports | **STATIC (stale)** |
| Forecasts | 33,687 | 21 agencies, 12 formats | `sync-forecasts` cron | 2026-09-12 | **automated daily** | Forecasts panel, map layer, MCP | **LIVING** |
| Event Radar | 4,945 (**508 upcoming**) | SAM special notices | `extract-sam-events` cron | 2026-09-13 | **automated daily** | map events, target research | **LIVING** (bounded to SAM) |
| Decision makers | 247,030 | SAM POCs, DoDAAC | `sync-gov-buyer-data` cron | rolling | automated | Decision Makers panel, MCP | **LIVING** |
| Buying offices | 4,826 | DoDAAC decode | monthly cron | 2026-09-06 | automated | office anchoring | **LIVING** |

---

## 11. Most important question — answered directly

> **Are the 3,045 pain points and 2,658 priorities a continuously maintained
> intelligence product, or primarily a useful historical corpus?**

**Primarily a useful historical corpus**, refreshed by hand roughly quarterly. The
evidence is unambiguous: it ships as a **static file inside the build**, has **9 commits
in 9 months**, has **no cron**, has **no source URL on any of 3,045 records**, has **no
status field so nothing can ever be marked resolved**, and its most recent refresh added
**zero new pain points**. The Supabase tables that would make it a live dataset
(`agency_pain_points_db`, `agency_priorities_db`) exist and hold **0 rows**.

That said — and this matters — **the corpus itself is genuinely valuable and not stale in
substance.** 455 pain points reference 2024–2026, 46 encode FY2026 NDAA provisions, and
69.5% of priorities carry real dollar figures. This is good raw material sitting in the
wrong container.

> **What would have to exist for it to become continuously updating?**

Four things, in dependency order:

1. **A record, not a string.** Promote each pain point/priority to a row with
   `agency`, `text`, `source_type`, `source_url`, `source_date`, `as_of`, `confidence`,
   `status`, `evidence_strength`, and optional `amount`/`fiscal_year`. Without this,
   nothing else is expressible. **This is the unlock.**
2. **A real store.** Move from the bundled JSON to the (already-created, empty) Supabase
   tables so an update is a data write, not a deploy.
3. **Pollers per source**, each writing evidence rows: Congress.gov (bills/laws),
   Federal Register (EOs/rules — the client **already exists**, it just isn't persisted),
   GovInfo (GAO — the fetcher **already exists**, it just isn't scheduled), oversight.gov
   (IG). Derivation from evidence → pain point stays human-reviewed or LLM-proposed-with-
   citation; the *ingest* is what should be automatic.
4. **An append-only change log** (`intelligence_changes`, mirroring `recompete_changes`)
   so "this agency's priority shifted" becomes a detectable, surfaceable event.
   Per the existing recompete lesson: **a change not recorded while it happens is gone
   permanently and cannot be backfilled at any price.**

---

## 12. Missing high-value signals

Ranked by strategic value vs effort:

1. **Congress.gov bills & enacted law** — no pipeline at all; the "what has Congress told
   them to do" question is currently unanswerable from data.
2. **Appropriations / enacted budget** — the "is it funded" half of the thesis.
3. **Executive orders** — Federal Register client already exists; only persistence missing.
4. **IG reports (oversight.gov)** — a large, structured, free corpus of agency problems.
5. **Agency budget justifications (CBJs)** — the richest source of *funded* priorities.
6. **Event registration URLs** — 0% populated; blocks the "when should I engage" action.
7. **Non-SAM events** (conferences, matchmaking) — structurally invisible today.

---

## 13. Gaps — P0 / P1 / P2

### P0 — would materially mislead a user or block the core promise
- **P0-1 · Pain points and priorities carry no source URL or date (0% / 0%).** Mindy
  presents oversight-derived claims a user may repeat to a contracting officer, with no
  way to cite or verify them. This directly violates the house rule that a displayed
  claim must be defensible. *(Also the fix that unblocks everything else.)*
  ⚠️ **The target schema ALREADY EXISTS as DDL and was never populated.**
  `supabase/migrations/20260405_budget_intelligence.sql` defines `agency_pain_points_db`
  with `source` (CHECK: `cbj|ndaa|gao|ig_report|manual|ai_inferred|import`), `source_url`,
  `naics_codes[]`, `urgency`, `estimated_resolution_fy`, `verified`; and
  `agency_priorities_db` with `funding_amount NUMERIC`, `fiscal_year`, `naics_codes[]`,
  `keywords[]`, `contract_vehicle`, `opportunity_window`, `source`, `source_url`.
  **Every provenance field this audit found missing was designed in April and left
  empty.** Both tables still lack `status` and an evidence-strength/confidence field.
  So P0-1 is *populate and extend an existing model*, not *design a new one* — a
  materially smaller job than it first appears.
- **P0-2 · Budget authority is ~7 months stale and still labels FY2026 a "President's
  Request"** while FY2026 is nearly over. Any "where is money being allocated" answer
  built on it is out of date.
- **P0-3 · No status field → nothing can be marked resolved.** A pain point an agency
  fixed in 2024 is presented identically to an active one. This is the highest risk of
  *confidently wrong* strategic advice.
- **P0-4 · Event Radar mixes 4,354 past events with 508 upcoming.** Any surface showing a
  raw count overstates actionable events by ~10×.
- **P0-5 · Agency mis-attribution in the merge step — CONFIRMED by inspection.** The merge
  groups GAO reports by `agency_name` and files some under the wrong agency. Verified
  examples: under **Department of Veterans Affairs** sit *"Hazardous Waste: Observations on
  EPA's Cleanup Program"*, *"Air Traffic Control: Observations on FAA's … Modernization
  Program"*, and *"Department of the Interior: Observations on Performance Plan"*; under
  **Department of Homeland Security** sit an **HHS** strategic-planning finding and an
  **SSA** workforce finding. I am deliberately **not quoting a percentage** — every
  automated estimate I tried produced false positives (e.g. counting "DOD" under
  "Department of Defense" as a mismatch), so the rate is **unquantified pending a proper
  alias-aware audit**. The defect itself is not in doubt: a user researching VA is shown
  EPA's and FAA's problems as VA's. This is the *plausible-but-wrong* failure mode the
  house rules single out, and it reaches the customer via `painPointCount` and the
  Decision-Makers/target-research surfaces.

### P1 — meaningfully reduces product quality
- **P1-0 · Customer-facing copy claims sources we do not ingest.**
  `src/components/app/panels/MyTargetListPanel.tsx` tells users *"Sources: GAO high-risk
  reports, agency strategic plans, budget justification docs, congressional testimony"*
  and `/api/admin/data-inventory` advertises *GAO · IG audits · CRS analyses · NDAA ·
  Budget justifications · Strategic plans · GovInfo API*. **Only GAO (via GovInfo) and
  USASpending have ingestion code.** IG, CRS, congressional testimony, strategic plans and
  budget justifications have **none** — `src/lib/utils/federal-oversight-data.ts` is a
  hardcoded TypeScript constant, not a fetcher. Per the honesty rule (#10), this copy
  overstates scope and should be narrowed to what we actually ingest.
- **P1-1 · No legislation/EO/appropriations ingestion** — a headline capability of the
  strategic thesis has no implementation.
- **P1-2 · No change detection for intelligence** — priority shifts are silently
  overwritten and unrecoverable.
- **P1-3 · Pain→NAICS linkage covers only 18 hardcoded codes**; every other NAICS gets a
  silent empty result.
- **P1-4 · `agency_intelligence` has no cron** — it advances only when someone remembers.
- **P1-5 · Forecast `anticipated_award_date` is 0.2% populated**, weakening "when will
  they buy."
- **P1-6 · 50 of 307 agencies have zero pain points**, so the "307 agencies" figure
  overstates true coverage (257).

### P2 — enrichment
- **P2-1 ·** Event registration URLs (0% populated).
- **P2-2 ·** Non-SAM event sources.
- **P2-3 ·** Parse the $ amounts already present in 1,846 priorities into structured
  fields (content exists; only extraction missing).
- **P2-4 ·** Remove or wire the orphaned `briefings/web-intel/*` fetchers.
- **P2-5 ·** Drop or populate the empty `agency_pain_points_db` / `agency_priorities_db`.

---

## 14. Recommended architecture (not implemented — for decision)

```
POLLERS (cron, per source, append-only)
  congress.gov · federalregister.gov · govinfo(GAO) · oversight.gov(IG) · CBJs
        ↓ writes
  intelligence_evidence   (doc id, url, date, agency, type, excerpt, evidence_strength)
        ↓ derivation (LLM proposes WITH citation; human approves)
  agency_pain_points / agency_priorities   (structured rows, status, confidence, as_of)
        ↓ diff on write
  intelligence_changes    (append-only — the moat that cannot be backfilled)
        ↓ joins on agency + NAICS/PSC + office
  forecasts · opportunities · recompetes · offices · decision makers
```

**Evidence-strength taxonomy to adopt** (currently all collapsed into one field):
`SIGNAL` (introduced) → `STRONG_SIGNAL` (advanced) → `POLICY` (enacted/EO) →
`FUNDED` (appropriated) → `PROCUREMENT_EVIDENCE` (forecast/solicitation/spend).

**Sequencing note:** P0-1 (the record model) and the `intelligence_evidence` table are
prerequisites for everything else — pollers have nowhere to write until they exist. The
Federal Register client and the GovInfo GAO fetcher are **already written**; they need a
destination and a schedule, not new code.

---

## 15. What is intentionally excluded

DIBBS · Grants · SBIR/STTR · BAA/research-lab funding — the specialty-feed workstream.
Procurement-table freshness (SAM/awards/recompetes/contractors) was covered by the
Core-90% pass and is not re-litigated here, except where a strategic dataset depends on it
(Event Radar's SAM dependency, forecasts).

---

## 16. Recommendation

**Do not "fix" the corpus by refreshing it again.** Another manual merge buys ~90 days
and reproduces the same gap. The corpus is good; the container is wrong — and the right
container was **already built in April 2026 and never filled** (see P0-1).

The highest-leverage first move is **P0-1 + P0-3 together**: give a pain point/priority a
real record with `source_url`, `source_date`, and `status`, in a real table. That single
change converts the asset from "a file we occasionally rewrite" into "a dataset that can
be appended to, cited, aged, and diffed" — and it is the precondition for every poller.
**Then** schedule the two fetchers that already exist (GovInfo GAO, Federal Register)
before writing any new ingestion code.

Until then, the honest description of this layer — and the one that should be used in
customer-facing copy — is: **a curated, oversight-grounded intelligence corpus refreshed
periodically**, not a real-time policy feed.
