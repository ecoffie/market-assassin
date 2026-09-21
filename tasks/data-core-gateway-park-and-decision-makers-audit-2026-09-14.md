# Data Core — Gateway parked · domain inventory · Decision Makers Phase II audit
**2026-09-14 · READ-ONLY for Decision Makers · no Decision Makers mutation performed**

---

## PART A — GSA Gateway / FCO: PARKED OPERATIONAL STATUS

**Verdict: PARKED — CONTROLLED, PARTIAL, BEHIND UPSTREAM.**

| Field | Status |
|---|---|
| **WATCHING** | ✅ YES. `fco-roster-watch` cron registered (`/api/cron/fco-roster-watch?concurrency=4&budgetMs=240000`, `20 12 * * 1`, enabled, timeout 290000). Two real production runs proven: run #1 alerted `new`, run #2 `suppressed` (dedup proven). Both swept 372/372 pages, 0 failures. |
| **CURRENTNESS** | `source_state = content_stale`. `last_source_advance = 2026-09-14T23:32:00Z`. Upstream is moving; we are not following it. |
| **INGEST** | ❌ NONE. `last_verified_ingest = null`, `last_data_advance = null`. No row has ever been ingested through the controlled path. |
| **CANONICAL COVERAGE** | **PARTIAL — 1 of 9 departments complete.** STATE 396/396 ✅. Incomplete: DOI 1,147/4,249 · USDA 839/2,519 · DOT 81/709 · VA 250/688 · GSA 224/390 · DOL 5/144 · NRC 0/89 · NSF 0/32. Acquisition manifest exits non-zero; **do NOT ingest**. |
| **UPSTREAM** | 9,225 rows · 9,216 unique ids · 9 departments · MAX(changed) 2026-09-14T09:14:44-04:00. |
| **HELD** | 6,724 rows (`forecast_gsa_gateway`). Deficit vs upstream: **2,501 rows**. |
| **INTERVENTION** | `intervention_state = required`, `manual_action_type = controlled_import_required`. |
| **NEXT MANUAL ACTION** | Human browser (visible session, no MFA/WAF bypass) downloads of the remaining department slices: DOT 709 · VA 688 · GSA 390 · DOL 144 · USDA 2,519 (verify) · DOI 6 FY slices. Facet automation failed both headless AND visible — exports came back byte-identical, so this is a human step by design, not a missing script. |

Sibling instance `forecast_nrc_gateway`: `unreachable`, held 89, `last_verified_ingest 2026-06-26`, same `controlled_import_required`.

---

## PART B — REMAINING DATA CORE DOMAIN INVENTORY

**The control plane covers exactly one dataset.** `data_source_instances` holds **12 rows, all `dataset_key = 'forecast_intelligence'`** (5 current · 2 content_stale · 2 unmeasured · 3 unreachable; 7 needing intervention). **Every other Data Core domain has zero control-plane coverage** — no clocks, no dispositions, no intervention state.

| Domain | Table(s) | Rows | Control plane | Classification |
|---|---|---|---|---|
| Forecast Intelligence | `agency_forecasts` | — | 12 instances | **CONTROLLED_PARTIAL** (Gateway/FCO parked; NRC unreachable) |
| **Decision Makers** | `federal_contacts` | **247,173** | **none** | **PHASE_II_REQUIRED** — see Part C |
| DIBBS | `dibbs_rfqs` | 49,718 | none | **PARKED** (🟡 advancing, no advancement oracle, 19.7% job error rate) |
| Grants | `grants_cache` | 2,127 | none | **PARKED** (🟢 0 errors / 44 runs) |
| SBIR | — | 42 | none | **PARKED** (🔴 coverage: 1 of ~11 agencies; product decision first) |
| Research / Lab | — | — | none | **PARKED** (⚠️ `darpa_baa` + `grants_gov` slice ~5 months dead, `nsf_sbir` never wrote a row, while crons logged 75/86 successes) |
| Institute / Strategic Intelligence | `intelligence_log` 159,752 · `agency_intelligence` 556 · `institute_sources` 25 | — | none | **UNKNOWN** — never audited, no clocks, no classification |
| (supporting) | `dodaac_directory` | 4,826 | none | reference table |

Per the standing park order, DIBBS / Grants / SBIR / Research were **not** re-audited and **not** touched.

---

## PART C — DECISION MAKERS: READ-ONLY PHASE II AUDIT

### C1–C2 · Exact baseline (measured, not estimated)

| Measure | Value |
|---|---|
| Rows | **247,173** |
| Distinct `source_row_key` | 247,173 (0 null) — **row identity, not person identity** |
| Distinct emails | **21,347** (~11.6 rows per email) |
| Rows with email | 165,154 (67%) → **82,019 rows carry no email**; 82,017 carry neither email nor phone |
| Rows with phone | 82,156 (33%) |
| name / title / raw_data / role_category | 100% populated |
| Agencies | 71 · Offices | 12,081 |

### C3 · Control plane: **ZERO coverage**
No `data_source_instances` row exists for Decision Makers. No disposition, no `last_source_advance`, no `last_verified_ingest`, no `last_data_advance`, no intervention state. `docs/mindy-data-source-control-plane.md` already records it as **UNMEASURED — no clock at all**.

### C4 · Currentness: **MEASURABLE ONLY AS "SWEEP TOUCHED ME" — no advancement oracle**

The producer sweeps `sam_opportunities` ordered by `posted_date DESC`, `PAGE = 1000`, `MAX_PAGES = 10`, and **`offset` resets to 0 on every run**. That is a fixed head-window of the newest ~10,000 notices out of **206,551** POC-bearing notices — **4.8% of the corpus, re-swept daily, never advancing into the tail.**

Measured refresh frontier (last 24h):

| Measure | Value |
|---|---|
| Rows touched in 24h | **9,904** (from 7,248 distinct notices) |
| `posted_date` range of that refresh | **2026-09-03 → 2026-09-13 — an 11-day rolling window** |
| Rows touched in 7d / 30d | 17,649 / 48,181 |
| Rows untouched for 90+ days | **125,515 (50.8%)** |

`updated_at` is written unconditionally by the upsert payload, so it advances whether or not the person changed. There is **no change log, no snapshot table, no `last_verified` column** — `contacts`, `mi_beta_contacts`, `internal_outreach_contacts` are unrelated small tables (12 / 46 / 60 rows) and `opengov_iq_contacts` is **empty (0 rows)**. A contact that left government 6 months ago is indistinguishable from one verified yesterday.

### C5 · Identity & dedupe: **row identity ≠ person identity**

| Signal | Value |
|---|---|
| Distinct emails | 21,347 |
| Singleton emails | 5,121 |
| Emails on >10 rows | 4,287 |
| Emails with multiple distinct names | **2,321** |
| Emails spanning multiple offices | 0 |
| Worst single email | **2,918 rows** |
| Role mailboxes present | yes (e.g. `procurement_box7@state.gov` ×18) |

There is no person entity. The unique key is `<notice_id>::<poc_index>` — one row per (notice, POC slot). "247,173 contacts" is a row count; the honest people count is at most ~21K.

### C6 · Provenance: **`source` and `source_table` are column DEFAULTS, not attribution**

```
source_table  DEFAULT 'AllSamContacts'
source        DEFAULT 'sam_opportunities_poc'
```

The live producer (`sync-gov-buyer-data`) **never sets either column** — it inherits both defaults. So the apparent "three source families" are really *one default bucket plus two historical importers that set the column explicitly*:

| `source_table` | Rows | `source_row_key` shape | `raw_data` keys | Last import | Status |
|---|---|---|---|---|---|
| `AllSamContacts` | 134,717 | `<notice_id>::<idx>` | fullName, email | **2026-09-14** | LIVE (default bucket) |
| `sam_entities_pocs` | 82,017 | `<UEI>::<role>` | **uei, company, role, role_title** | 2026-05-28 | FROZEN |
| `sam_opportunities_pointOfContact` | 30,439 | `<notice_id>::<idx>` | fullName, email | 2026-05-28 | FROZEN |

**The provenance is actively wrong for 82,017 rows (33%):** the `sam_entities_pocs` family holds *contractor/vendor* registrant POCs (UEI + company, 0 with a federal department, 0 with an email), yet every one of them is stamped `source = 'sam_opportunities_poc'` and `role_category = 'contracting'` by default. Those two columns cannot be trusted as attribution anywhere.

### C7 · Producer safety classification

| Producer | Path | Classification | Note |
|---|---|---|---|
| `sync-gov-buyer-data` (`pull=contacts`) | flattens `sam_opportunities.points_of_contact` | **ACTIVE_CANONICAL** | The only live writer. Idempotent on `source_row_key`. |
| `sync-gov-buyer-data` (`pull=entities`) | SAM Entity API → `sam_entities` | ACTIVE_CANONICAL (different table) | Not a `federal_contacts` writer. |
| whatever produced `sam_entities_pocs` | — | **LEGACY** | 82,017 vendor rows, frozen 2026-05-28, no producer found in the repo. |
| whatever produced `sam_opportunities_pointOfContact` | — | **LEGACY** | 30,439 rows, frozen 2026-05-28, same key space as the live bucket but never re-touched. |
| `relationships/route.ts` BigQuery path | `fresh-ward-455220-j0.samgovcons.AllSamContacts` → `opengov_iq_contacts` | **DUPLICATE / DORMANT** | Target table is **empty (0 rows)**; it also created the `AllSamContacts` naming that the default column now echoes. |

**⚠️ The canonical producer is not scheduled.** There is **no `cron_jobs` row** for it (0 of 99 jobs match) and **no `vercel.json` cron entry**. It runs only because `sync-sam-opportunities` (`type=full`, `0 1 * * *`) **fire-and-forgets** a `fetch()` at `route.ts:728` — not awaited, response logged only, never failing the parent. The code comment names it: *"It has no Vercel cron slot of its own — the platform caps crons at 100 and we're at the limit."* If that fetch silently fails, nothing anywhere records it.

### C8 · User surfaces — reachable, and guard parity holds

| Surface | Guard | Verdict |
|---|---|---|
| `/api/app/federal-contacts` | `department_ind_agency IS NOT NULL` + telephone/phone/fax/tel-prefix exclusion + `isUsableContactCard` | ✅ vendor rows excluded |
| `/api/app/contacts-map` | `solicitation_number IS NOT NULL` + same name guards + `isUsableContactCard` | ✅ excluded by a different key (entity rows have 0 sol numbers) |
| `src/lib/gov-contacts/contact-roster.ts` | full guard set | ✅ |
| MCP `search_federal_contacts` | delegates to `contact-roster.ts` | ✅ **mirror rule holds** |
| `/api/app/buyer-detail` | single-id lookup, no guard | ⚠️ can render a vendor row if deep-linked by id (not reachable from the guarded lists) |

**Reachable population, measured:**

| Measure | Value |
|---|---|
| Total rows | 247,173 |
| With a federal department | 165,156 |
| Passing the full guard (reachable) | **161,244** |
| **Distinct reachable people (by email)** | **21,227** |

`office` is NULL on **all** 165,156 government rows (only the 82,012 vendor rows carry it) — office anchoring runs on the `solicitation_number` DoDAAC prefix, as already documented.

### C4b · The only watchdog is firing and failing

`check-data-freshness` (`5 13 * * *`, enabled) is the single monitor that touches `federal_contacts` (`LIVE_SYNC_CHECKS.federal_contacts_sync`, staleDays 3). Its run history: **46 success, 5 error — and the last 5 errors are all HTTP 502 on 2026-08-28, 08-30, 09-09, 09-11 and 09-14 (today).** In that route, **502 means exactly one thing: stale sources were found AND the notification email failed.** The watchdog has been detecting staleness and failing to tell anyone for 17 days.

(`federal_contacts` itself passes its own 3-day check — `max(updated_at) = 2026-09-14` — so the staleness it is failing to report is in the curated sources, not Decision Makers.)

### C9 · Phase II verdict

**PHASE_II_REQUIRED.** The corpus is large, live at the head, and genuinely reachable through every surface — but it has **no control plane row, no person identity, no advancement oracle, defaults masquerading as provenance, and an unscheduled producer kept alive by an unawaited fetch.**

Gaps, in dependency order:

1. **Producer is not scheduled** — a fire-and-forget `fetch()` is the only trigger; a silent failure is invisible.
2. **No control-plane instance** — no clock can distinguish "current" from "we stopped looking."
3. **95.2% of the corpus is never re-verified** — an 11-day rolling window; 50.8% of rows untouched for 90+ days.
4. **No person identity** — 247,173 rows = ~21K people; 2,321 emails carry conflicting names.
5. **Provenance is a lie on 33% of rows** — vendor POCs stamped as opportunity POCs by column default.
6. **The lone watchdog has been 502-ing for 17 days.**

**Recommended first Decision Makers source to finish: the existing `sync-gov-buyer-data` contacts pull — register it, clock it, and let it drain.** It is already the canonical producer, already idempotent on `source_row_key`, already correctly guarded on every surface, and needs **no new upstream, no new credential, and no human browser step**. Concretely: give it a real `cron_jobs` row (the dispatcher has capacity — Vercel's 100-cron cap is what forced the chaining band-aid, and `cron_jobs` is not that cap), checkpoint `offset` in a sync-state row so the sweep advances past the 10,000-row head instead of resetting, and register one `data_source_instances` entry for `decision_makers` so held vs upstream population and `last_data_advance` become measurable. That converts the domain from UNMEASURED to measured without touching a single row of data — and it is the prerequisite for every other gap above.

Deliberately **not** recommended first: a new upstream (SAM Federal Hierarchy, agency staff directories) or a person-identity resolver. Both are real Phase II work, but neither is checkable until there is a clock.

---

## STOPPED FOR REVIEW
No Decision Makers mutation. No DIBBS / Grants / SBIR / Research work. No Gateway ingest.
