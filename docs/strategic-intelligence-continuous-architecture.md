# Strategic Intelligence — Continuous Architecture (Design)

**Date:** 2026-09-13 · **Status:** architecture + design only. **No implementation.**
**Companion:** `docs/strategic-intelligence-core-audit.md` (the evidence audit this builds on).

**Thesis.** Competition Health continuously answers *"what is happening in this buyer's
procurement market?"* Strategic Intelligence must continuously answer *"what is changing
inside this agency that will create the next procurement market?"* This document reuses
Competition Health's **architecture**, not its metrics or scoring.

---

## 1. The Competition Health precedent (traced, not assumed)

**Files:** `src/lib/analytics/competition-health.ts` (16.3KB),
`competition-depth.ts` (16.6KB), surfaced by `/api/admin/competition-health` +
`src/app/admin/competition-health/page.tsx`.

```
SOURCE            sam_opportunities · recompete_opportunities · BigQuery usaspending.awards
  ↓ INGEST        (NOT its own job) — inherits the procurement crons:
                  sync-sam-opportunities (daily) · sync-recompete-contracts (hourly)
                  · bq awards ingest (weekly)
  ↓ NORMALIZE     set-aside code → label (SETASIDE_LABEL), isSetAside(), agency norm()
  ↓ DERIVE        computeCompetitionHealth(client, agency, days)
  ↓ AGENCY RESULT one CompetitionHealth object, scoped to ONE agency + window
  ↓ EVIDENCE      grounded · sampled · sampledWithData · strength · MoE · resolvedAgency · scope
  ↓ SURFACE       admin page + buildCompetitionPriorities()
  ↓ MONITORING    ❌ NONE (not in platform-health, not in verify:oracles) —
                  only a hand-maintained claim-ledger row
```

### The five principles worth copying

1. **Derivation is stateless; continuity lives in the INPUTS.** There is **no
   `competition-health` cron** — it is computed **on request**. It is current only because
   SAM and recompetes are refreshed beneath it by other jobs. *Implication for Strategic
   Intelligence: schedule the **collectors**. The derivation may stay on-demand — but
   unlike here, it must also persist its output, because our product is change over time.*
2. **A claim ships with its numeric basis.** The result type carries `sampled`,
   `sampledWithData`, `avgBidders`, `singleBidCount`, `singleBidMoe` — the words never
   travel without the numbers.
3. **Evidence strength is explicit and separate from the reporting gate.**
   `competition-depth.ts:132` — `type EvidenceStrength = 'insufficient'|'limited'|'sampled'|'strong'`,
   `evidenceStrength(n)` thresholds 12/30/100. `MIN_SAMPLE` is the *epistemic guard*
   ("report at all?"); strength is *"how much weight should this carry?"* **These are two
   different questions and the code keeps them apart.** ← directly reusable.
4. **Unmeasurable is declared, not hidden.** `notYetMeasurable: {metric, needs}[]` and
   `supplierReach: null` — the system names its own blind spots on the response.
5. **Accuracy ≠ precision.** `singleBidPlain` renders *"About half"* while the exact value,
   n and MoE sit underneath for analysts.

### ⚠️ IMPORTANT CORRECTION TO THE PREMISE

The brief framed Competition Health as a system that *"continuously derives buyer-side
intelligence… including regularly refreshed USAspending/award evidence."* **Traced against
the code, that is not what it is.** It is a **well-disciplined on-demand read**, not a
pipeline. Four of the seven stages in the requested pattern **do not exist there**:

| Stage | In Competition Health | Evidence |
|---|---|---|
| source | ✅ REAL | `sam_opportunities`, `recompete_opportunities`, USASpending v2 live |
| scheduled collection | ❌ **ABSENT** | **no cron, no `cron_jobs` row, no `vercel.json` entry.** Computed per request |
| source watermark | ❌ **ABSENT** | no `max(posted_date)`/`max(action_date)`, no `computed_at` on the result. Only `now()`-relative sliding windows |
| normalized evidence | ⚠️ PARTIAL | normalization happens in-memory per call; nothing materialized |
| derived intelligence | ✅ REAL | `computeCompetitionHealth` (measure) → `buildCompetitionPriorities` (interpret) |
| evidence-backed interpretation | ✅ REAL **but never persisted** | numbers travel with words, then die with the HTTP response |
| surface | ✅ REAL | admin page + `/api/gov-buyer/competition` |
| advancement monitoring | ❌ **ABSENT** | **0 hits** for "competition" in `platform-health/route.ts` and `verify-oracles.mjs`. Only a hand-maintained ledger row (`measurement-integrity.ts:65`, `verifiedOn: '2026-08-22'`) |

**Consequence worth stating plainly:** if `sam_opportunities` ingestion stalled, Competition
Health would keep returning 200s with plausible, silently-stale numbers over a sliding
window. **There is no automated detector.** Its only USASpending persistence is
`mcp_external_cache`, keyed `UNIQUE(cache_key)` — so each 24h recompute **overwrites** the
prior reading; no history is kept.

**So: copy its epistemic discipline (principles 1–5), not its plumbing.** The continuity it
appears to have is inherited from its inputs being refreshed by *other* crons — which is a
real and reusable idea, but it is not the same thing as a pipeline that knows its inputs
advanced. Strategic Intelligence must **add** the four missing stages: scheduled
collection, source watermark, history, and advancement monitoring.

One more pattern worth stealing, unique to this code — **refuse rather than guess**
(`competition-depth.ts:191-198`): if a SAM agency long-name cannot be confidently mapped to
a USASpending toptier, it **withholds the metric** rather than risk sampling the wrong
buyer. Given the confirmed agency mis-attribution in the pain-point corpus (P0-6), this is
precisely the guard Strategic Intelligence's agency-resolution step needs.

---

## 2. Existing Strategic Intelligence architecture (measured 2026-09-13)

| Domain | Store | Rows | Producer | Last data advance | Verdict |
|---|---|---:|---|---|---|
| Pain points | `src/data/agency-pain-points.json` **(in the build)** | 3,045 / 257 real agencies | hand-run merge | 2026-08-01 | STATIC |
| Priorities | same file | 2,658 | hand-run merge | 2026-08-01 | STATIC |
| Agency intelligence | `agency_intelligence` | 557 | `/api/admin/sync-agency-intel` (**no cron**) | 2026-08-01 | PARTIAL |
| Budget authority | `src/data/agency-budget-data.json` | 47 agencies | hand-built | **2026-02-18** | STATIC (stale) |
| Forecasts | `agency_forecasts` | 33,687 | `sync-forecasts` daily | 2026-09-12 | LIVING |
| Event Radar | `sam_events` | 4,945 (**508 upcoming**) | `extract-sam-events` daily | 2026-09-13 | LIVING |
| Decision makers | `federal_contacts` | 247,030 | `sync-gov-buyer-data` | rolling | LIVING |
| Buying offices | `dodaac_directory` | 4,826 | monthly cron | 2026-09-06 | LIVING |

**The structural break:** the three interpretive datasets ship **inside the JS bundle**, so
updating intelligence requires a **deploy**. Competition Health reads tables; pain points
read a compiled file. That single difference is why one is continuous and the other is not.

---

## 3. Reusable infrastructure (do not rebuild)

| Need | Already exists | Reuse how |
|---|---|---|
| Evidence-strength vocabulary | `competition-depth.ts` `EvidenceStrength` | **extend** with a policy-lifecycle axis (§6) |
| "Declare the unmeasurable" | `notYetMeasurable[]` | same shape on intelligence results |
| Append-only change log | **`recompete_changes`** + `diffContracts` | **clone the pattern** for `intelligence_changes` |
| Advancement semantics | `src/lib/awards-ingest/clocks.ts` — `healthy / upstream_stale / ingest_broken / unmeasured`, run-clock vs source-clock | **reuse verbatim** — it already separates the three clocks §11 requires |
| Freshness registry + nag | `data_sources` + `cron/check-data-freshness` | register each new collector |
| Daily snapshots | `daily_metric_snapshots` + `snapshot-metrics` | intelligence counts per day |
| GAO fetcher | `agency-intelligence/fetchers/govinfo.ts` | **already written — needs a schedule** |
| Federal Register client | `src/lib/federal-register/index.ts` | **already written — needs persistence** |
| Target schema for claims | **`agency_pain_points_db` / `agency_priorities_db` DDL** (`20260405_budget_intelligence.sql`) | **already designed, 0 rows — populate + extend** |
| Agency resolution | `gov-contacts/agency-key.ts`, `agency-aliases.json`, DoDAAC anchoring | reuse for evidence→agency |

| Refuse-rather-than-guess resolver | `competition-depth.ts:191-198` | **guard for P0-6** — withhold rather than mis-attribute |
| Pure interpreter boundary | `buildCompetitionPriorities(h)` — zero I/O, takes only the measured struct | same split: measure, then interpret |

**Finding:** roughly **70% of the required primitives already exist.** The gap is wiring
and two new tables — not a new subsystem.

**But note the honest caveat:** the four primitives Strategic Intelligence needs *most*
(scheduled collection, watermark, history, monitoring) are **exactly the four Competition
Health does not have**. They must be built here for the first time — `recompete_changes`
and `awards-ingest/clocks.ts` are the in-repo precedents for those, **not** Competition
Health.

---

## 4. Source-by-source collection model

**Polling cadence ≠ publication cadence.** A yearly source is still *checked* often; it
simply is not expected to advance often. Each collector records `checked_at` AND
`source_watermark`, so "checked today, nothing new" is a healthy state — not a stale one.

| Source | Publishes | Poll | Endpoint | Exists? |
|---|---|---|---|---|
| GAO reports | continuous | daily | GovInfo `GAOREPORTS` | ✅ **fetcher written, unscheduled** |
| Federal Register (EOs, rules) | daily | daily | federalregister.gov | ✅ **client written, not persisted** |
| Bills / enacted law | continuous | daily | api.congress.gov | ❌ **none** (0 files) |
| Appropriations | episodic | weekly | congress.gov + GovInfo `BUDGET` | ❌ none |
| NDAA | annual | weekly in season | GovInfo | ⚠️ `~/Bootcamp/scan-ndaa-sections.py`, **outside repo**, last run Jan 2026 |
| IG reports | continuous | daily | oversight.gov | ❌ none |
| CRS | continuous | weekly | crsreports.congress.gov | ❌ none |
| Budget justifications (CBJ) | annual (Feb–Apr) | weekly in season | GovInfo `BUDGET` | ⚠️ `fetchBudgetDocuments()` **written but unrouted** |
| Strategic plans | multi-year | monthly | agency sites | ❌ none |
| Forecasts | source-specific | **daily** | `sync-forecasts` | ✅ LIVING |
| Industry days / special notices | daily | **daily** | `extract-sam-events` | ✅ LIVING |
| USASpending shifts | daily/weekly | weekly | BQ awards | ✅ LIVING |

**Cheapest real wins:** GAO and Federal Register need a **schedule and a destination**, not
new code.

---

## 5. Evidence model — `strategic_evidence` (proposed)

The principle: **derived intelligence must point back to immutable evidence.** No
equivalent exists today (`agency_intelligence` is closest but is overwritten in place by
upsert and holds interpretation, not raw evidence).

```
strategic_evidence            -- APPEND-ONLY. Never updated in place.
  evidence_id       uuid pk
  agency            text        -- resolved via agency-key.ts
  office_code       text null   -- DoDAAC when resolvable
  source_type       text        -- gao|ig|crs|bill|law|eo|approp|cbj|strategic_plan|forecast|event|spend
  source_id         text        -- GAO-24-106, PL 118-31, EO 14110, notice_id …
  source_url        text NOT NULL
  publication_date  date        -- when GOVERNMENT published it
  discovered_at     timestamptz -- when MINDY saw it  ← the two clocks, kept apart
  title             text
  extracted_fact    text
  evidence_strength text        -- §6
  topics            text[]      -- cyber, grid, logistics …
  naics_hint        text[]      -- only when defensible
  source_watermark  text        -- collector high-water mark
  UNIQUE (source_type, source_id)   -- idempotent re-polling
```

`source_url` is `NOT NULL` **by design**: today **0 of 3,045** pain points carry one, and
that is the P0 defect. Make it structurally impossible to add an uncitable claim.

---

## 6. Evidence strength — two axes, not one

Competition Health's axis is **statistical** (`insufficient|limited|sampled|strong`, from n).
Strategic Intelligence needs a second, **policy-lifecycle** axis. Keep them separate — as
the codebase already keeps `MIN_SAMPLE` separate from `evidenceStrength`:

| Level | Meaning | Example |
|---|---|---|
| `EMERGING_SIGNAL` | introduced bill, isolated report | bill introduced |
| `STRONG_SIGNAL` | advanced materially / corroborated | passed a chamber; GAO + IG agree |
| `REQUIREMENT` | enacted law, EO, formal mandate | PL signed; EO issued |
| `FUNDED_PRIORITY` | identifiable budget/appropriation | appropriation line; CBJ request |
| `BUYING_SIGNAL` | forecast, sources sought, industry day | forecast row; industry day |
| `ACTIVE_PROCUREMENT` | solicitation live | SAM notice |

**Rule: an introduced bill must never become an agency "priority."** It enters as
`EMERGING_SIGNAL` and *strengthens* as corroborating evidence arrives. The lifecycle —
bill → law → appropriation → forecast → solicitation — **is the product** for advanced
contractors, and it is exactly what today's flat string array cannot express.

---

## 7. Change detection — the daily loop

```
NEW GOVERNMENT EVIDENCE
   ↓ INGEST (per-source collector, idempotent on (source_type, source_id))
   ↓ NORMALIZE (dates, agency names, topics)
   ↓ RESOLVE AGENCY/OFFICE  ← agency-key.ts + aliases + DoDAAC
   ↓ WHAT CHANGED SINCE YESTERDAY?   (new evidence rows only)
   ↓ AFFECTED AGENCIES = distinct(agency) over new evidence   ← usually a handful
   ↓ RECOMPUTE ONLY THOSE agencies' claims
   ↓ DIFF vs current claim state  → write intelligence_changes (append-only)
   ↓ SERVE + MONITOR
```

**Incremental by construction.** If three agencies got new evidence, three agencies
recompute. This mirrors `sync-recompete-contracts`, which drains under a wall-clock budget
rather than rebuilding the world.

**Diff-before-write, as `recompete_changes` already does:** take the diff **before** the
upsert (afterwards the old value is gone) and write it **after** the upsert succeeds.

---

## 8. Pain-point lifecycle

A pain point must be able to: **appear → gain evidence → strengthen → weaken → resolve.**

```
GAO finding            → claim appears        (EMERGING_SIGNAL, confidence low)
IG report corroborates → +evidence            (STRONG_SIGNAL)
CBJ funds remediation  → FUNDED_PRIORITY
Forecast appears       → BUYING_SIGNAL
Solicitation posts     → ACTIVE_PROCUREMENT
GAO closes the finding → status = resolved    (retained, never deleted)
```

Required claim fields beyond today's bare string: `status`
(`emerging|active|strengthening|weakening|resolved`), `confidence`, `first_seen`,
`last_evidence_at`, `evidence_ids[]`.

**The existing DDL already supplies** `source`, `source_url`, `naics_codes[]`, `urgency`,
`estimated_resolution_fy`, `verified`. **Missing:** `status`, `confidence`, `evidence_ids[]`,
`first_seen`/`last_evidence_at`. So this is an **ALTER + populate**, not a new design.

⚠️ **A resolved pain point is retained, never deleted** — "what stopped being a problem"
is itself intelligence, and today nothing can ever be marked resolved.

---

## 9. Priority lifecycle — stated vs funded vs procurement-active

| Stage | Evidence | Today |
|---|---|---|
| **Stated** | strategic plan, speech, bill | ❌ indistinguishable |
| **Funded** | appropriation, CBJ, budget authority | ⚠️ **1,846/2,658 (69.5%) already carry a $ figure in prose**; 1,483 cite an FY — unparsed |
| **Procurement-active** | forecast, sources sought, solicitation | ❌ no link |

The content largely exists; the **schema** to query it does not. `agency_priorities_db`
already defines `funding_amount NUMERIC`, `fiscal_year`, `contract_vehicle`,
`opportunity_window` — again **designed, never populated**. Adding `evidence_strength` +
`evidence_ids[]` makes stated-vs-funded a queryable distinction rather than a reading
exercise.

---

## 10. Events & forecasts as confirmation

A priority with an industry day and a forecast is a far stronger signal than any one alone.
Both feeds are **already LIVING and already agency/office-resolved**
(`sam_events.inferred_dodaac` — 231 of 508 upcoming events carry an office;
`agency_forecasts.contracting_office` at 99.8%). They can participate **today** — they are
simply never joined to a pain point or priority.

**Blockers:** Event Radar mixes 4,354 past with 508 upcoming (needs an `is_upcoming`
predicate at query time), and **0% of upcoming events carry a registration URL**, which
blocks the "when should I engage" action.

---

## 11. Historical state & operational health

**Three clocks, tracked separately** — reusing `awards-ingest/clocks.ts` semantics verbatim:

| Clock | Question | Failure it catches |
|---|---|---|
| `last_job_success` | did the poller run? | collector crashed |
| `last_source_advance` | did the GOVERNMENT publish something new? | upstream quiet (**healthy**) |
| `last_intelligence_change` | did a CLAIM change? | evidence arriving but derivation dead |

Both of these are healthy, and must render differently:
`Legislation: polled Sep 13 · new evidence Sep 13 · DOE priority changed Sep 13`
`Budget: polled Sep 13 · latest doc Aug 28 · priority changed Aug 28`

Statuses reuse `healthy | upstream_stale | ingest_broken | unmeasured`, plus `manual_due`.

⚠️ **Per the recompete lesson: a change not recorded while it happens is gone permanently
and cannot be backfilled at any price.** `intelligence_changes` must exist *before* the
collectors, or the first months of history are lost. **This is the ordering constraint that
matters most in §14.** A flat `intelligence_changes_total` across days is the alarm — an
empty log because nothing changed and an empty log because the job died look identical.

**Target admin view** (no composite score — a split, like `decisionMetricsIntegrity`):
per-source rows (poll / source advance / new evidence today / status), then derived-product
rows (Pain Points, Priorities: last recomputation · agencies changed · claims
added/strengthened/weakened · status).

---

## 12. Does the architecture support "the contractor's read"?

Target: *"DOE — NEW: grid resilience strengthened · FUNDING: $X · PAIN: legacy infra ·
BUYING SIGNAL: industry day · FORECAST: expected · WHO: office · WHY: sources."*

| Element | Supportable today? |
|---|---|
| PAIN | ⚠️ text only, no status/date |
| FUNDING | ❌ prose only, unparsed |
| BUYING SIGNAL | ✅ `sam_events` live |
| FORECAST | ✅ `agency_forecasts` live |
| WHO (office/official) | ✅ `dodaac_directory` + `federal_contacts` — **the strongest link** |
| NEW / changed | ❌ **no history** |
| WHY (sources) | ❌ **0% source URLs** |

**Verdict: not yet.** The two blockers are exactly P0-1 (citable claims) and the absence of
history. Everything to the right of FUNDING already works.

---

## 13. Gaps, ranked

### P0 — necessary to make intelligence continuously defensible
- **P0-1 · Claims are not citable.** 0/3,045 pain points and 0/2,658 priorities carry a
  source URL. **Mitigated by:** the target DDL already exists (`20260405_budget_intelligence.sql`);
  needs populating + `status`/`confidence`/`evidence_ids`.
- **P0-2 · No evidence ledger.** Nothing immutable for a claim to point back to.
- **P0-3 · No change log.** History is being lost daily and is **unbackfillable**. Build
  `intelligence_changes` FIRST.
- **P0-4 · Intelligence ships in the JS bundle**, so a data update needs a deploy. Move to
  the (empty) tables.
- **P0-5 · No `status` field** — a resolved 2024 problem is presented as current.
- **P0-6 · Agency mis-attribution confirmed** (EPA/FAA/Interior findings filed under VA;
  HHS/SSA under DHS). Agency resolution must be a first-class, tested step — rate
  unquantified pending an alias-aware audit.

### P1 — meaningfully strengthens foresight
- **P1-1 ·** Schedule the **two fetchers that already exist** (GovInfo GAO, Federal Register).
  Highest value per unit of work in this document.
- **P1-2 ·** Congress.gov collector (bills/laws) — the missing "what has Congress told them
  to do" axis.
- **P1-3 ·** Evidence-strength lifecycle (§6) so a bill ≠ an appropriation.
- **P1-4 ·** Parse the $ figures already present in 1,846 priorities into `funding_amount`/`fiscal_year`.
- **P1-5 ·** Budget authority refresh (stale since 2026-02-18) + a collector.
- **P1-6 ·** Join events/forecasts to claims (both feeds already resolved to agency/office).
- **P1-7 ·** Narrow customer-facing source claims to what we actually ingest (honesty rule).
- **P1-8 ·** `agency_intelligence` has no cron.

### P2 — enrichment
- IG (oversight.gov) · CRS · strategic plans · event registration URLs (0%) ·
  non-SAM events · retire orphaned `briefings/web-intel/*`.

---

## 14. Smallest implementation sequence

Ordered by dependency, each step independently shippable and verifiable.

| # | Step | Why first | Proof |
|---|---|---|---|
| **1** | Create `strategic_evidence` + `intelligence_changes` (append-only) | **History cannot be backfilled.** Every day without them loses data permanently | `npm run db:check` both tables |
| **2** | Schedule the GAO (GovInfo) collector → write evidence rows | Code exists; only a destination + `cron_jobs` row missing | evidence rows appear with real `source_url` |
| **3** | Persist Federal Register → evidence rows | Client exists; passthrough today | EO/rule rows land |
| **4** | `ALTER` the two empty claim tables: add `status`, `confidence`, `evidence_ids[]`, `first_seen`, `last_evidence_at`; migrate the JSON in | Turns the corpus into a live dataset; **no deploy needed to update data** | row counts > 0; a claim renders its source URL |
| **5** | Agency-resolution pass with tests (fixes P0-6) | Prevents importing the mis-attribution into the new store | VA no longer shows EPA/FAA findings |
| **6** | Incremental daily loop: new evidence → affected agencies → recompute → diff | The continuous engine | `intelligence_changes` accrues daily |
| **7** | Three-clock health view (poll / source advance / claim change) | Makes stalls visible; a flat total is the alarm | admin view renders all three |
| **8** | Congress.gov collector + evidence-strength lifecycle | The "what did Congress require" axis | bill → law → funded transitions observable |

**Steps 1–4 are the minimum viable "continuously defensible" system.** Steps 2–3 are
mostly configuration, because the fetchers are already written.

⚠️ **Sequencing rule (house rule #5):** deploy each collector route, curl it for a real
200 + JSON on prod, **then** insert its `cron_jobs` row — never in the same push.

---

## 15. What this does NOT change

Competition Health is untouched. The procurement layer (SAM, recompetes, contractors,
forecasts, events) is already living and is not part of this work. DIBBS / Grants /
SBIR remain out of scope. **No repairs performed in this pass.**
