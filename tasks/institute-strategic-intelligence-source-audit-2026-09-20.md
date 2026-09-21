# Institute / Strategic Intelligence — Source Audit (Data Core Phase II)

**Date:** 2026-09-20 · **Mode:** READ ONLY. No source data mutated, no source created, no
ingest run, no publication recomputed, no DIBBS/Grants/SBIR/Research touched.
**Measured live** against production Postgres + the live GAO feed + live public routes.
**Code audited against `origin/main` (`5cc700d7`)** — the local checkout was 119 commits behind,
so anything read from the working tree would have been stale.

> ⚠️ **The prior rough inventory was wrong on its largest number.** It is corrected in §1.

---

## 0. Headline

| Question | Answer |
|---|---|
| Real strategic-evidence rows in the domain | **682**, not ~159K |
| Rows under the Phase-II control plane | **78** (11.4%) |
| Source families controlled | **2 of 13** |
| GAO status | **CURRENT · CONTROLLED · AUTOMATED** — verified 25/25 against the live feed |
| Largest live risk | **547 opportunities** (172 active) serve a fabricated multi-trillion-dollar agency figure; the cron re-stamps it hourly |
| Domain classification | **PHASE_II_REQUIRED** |

---

## 1. ⚠️ The prior inventory's three numbers, re-measured

| Prior claim | Measured 2026-09-20 | Verdict |
|---|---|---|
| "~159K strategic/intelligence rows" | `intelligence_log` = **169,417** rows, and it is a **daily-alert EMAIL DELIVERY LOG** (`user_email`, `delivered_at`, `delivery_method`, `opened_at`, `clicked_at`; 168,966 `daily_alert`/`sent`) | **MISCLASSIFIED.** Zero strategic evidence. A name collision (`intelligence_*`) was counted as a corpus. `intelligence_metrics` (171) is the same thing — daily-alert campaign metrics. |
| "~556 GAO/IG-style records" | `agency_intelligence` = **556** | **Count right, description wrong.** 445 `gao_high_risk` (GovInfo, **published 1993-10-06 → 2000-09-27**) + 111 `contract_pattern` (USASpending). **No IG records exist anywhere in the domain.** |
| "~25 current GAO RSS records" | `institute_sources` GAO = **49** held; feed window = 25 | **Stale (understated).** The corpus has accumulated since 2026-09-13. |

**Rule this establishes:** a table named `intelligence_*` is not evidence. Classify by **columns**,
never by name.

---

## 2. Exact source topology

### 2A. Database (682 content rows)

| Table | Rows | Class | Source family | Producer | Controlled? |
|---|---|---|---|---|---|
| `institute_sources` | **78** | SOURCE_NATIVE | GAO (49) + Congress (29) | 2 crons | ✅ both |
| `agency_pain_points_db` | **24** | MINDY_DERIVED (cited) | derived from GAO | `derive.ts` | ✅ via parent |
| `intelligence_changes` | **24** | MINDY_DERIVED (history) | interpretation log | `derive.ts` | ✅ via parent |
| `agency_intelligence` | **556** | NORMALIZED + **UNKNOWN** | GovInfo GAOREPORTS (445) · USASpending (111) | one-shot 2026-04-19 | ❌ |
| `agency_priorities_db` | **0** | — | — | `scripts/import-budget-intel.js` (never landed) | ❌ |
| `agency_budget_authority` | **0** | — | — | none | ❌ |
| `budget_programs` | **0** | — | — | none | ❌ |
| `web_intelligence_cache` | **0** | — | — | none | ❌ |
| `intelligence_sources` | 6 | registry | — | seed only | ❌ (phantom — see §7) |
| `mcp_external_cache[fedreg:documents]` | 19 | ephemeral | Federal Register | per-request | ❌ (**19/19 expired**) |

### 2B. Static files / TypeScript (NOT in any database)

| Artifact | Population | Provenance |
|---|---|---|
| `src/data/agency-pain-points.json` | **307 agencies · 3,043 pain points · 2,658 priorities** | **0 URLs.** 278 carry a bare `(Source: GAO)` string; **2,765 (90.9%) carry no attribution at all** |
| `src/data/usace-office-specific-pain-points.json` | 5 offices · 26 pain points | none |
| `src/app/institute/evidence/route.ts` | 11 claims · 16 sources (15 `confirmed`, 1 `lead`) | 15 real URLs — **honest, but a hardcoded TS array outside every registry** |
| `research-publications.ts` | RES-001/002 `planned`, **RES-003 `published`** | registry-only |
| `observatory-methodology.ts` | OBS-001…OBS-009 | registry-only |

---

## 3. Control-plane coverage (`data_source_instances`)

`dataset_key = 'strategic_intelligence'` holds **exactly 2 instances**:

| source_key | mode | owner | state | last_poll | last_source_advance | last_data_advance | held | upstream | runbook |
|---|---|---|---|---|---|---|---|---|---|
| `institute_gao` | automated | data-core | current | 2026-09-20 12:20 | 2026-09-18 | 2026-09-19 12:20 | 49 | **null** | ✅ |
| `institute_legislation` | automated | data-core | current | 2026-09-20 12:59 | 2026-07-30 | 2026-09-20 13:33 | 29 | **null** | ✅ |

**Coverage:**

| | Controlled | Uncontrolled |
|---|---|---|
| **Source families** | 2 | 11 |
| **Rows** | **78** (11.4% of 682 DB rows) | **604** DB rows + **5,727** static claims |

Both instances have **`upstream_population = null`** → neither can answer *"are we holding
everything upstream has?"* from stored state. (For GAO I proved coverage out-of-band in §4;
that proof is not encoded anywhere.)

**Two competing registries exist.** `data_sources` carries `agency_pain_points` (3045,
quarterly, `last_built 2026-08-01`, `is_active true`) with **no** `data_source_instances` row —
so it is advertised as an active quarterly source while having no clocks, no `source_state`
and no `intervention_state`.

---

## 4. GAO — re-verified from production

**Status: CURRENT · CONTROLLED · AUTOMATED. Nothing has drifted.**

| Check | Result |
|---|---|
| Cron `institute-gao-sync` `20 12 * * *` | **8/8 consecutive successes**, 09-13 → 09-20, all `http_status 200` |
| **Upstream feed vs held corpus** | pulled `gao.gov/rss/reports.xml` live → 25 items → **25/25 held. Zero coverage gap.** |
| Held | 49 documents, **49/49 with a source URL**, 49 distinct document numbers, **0 duplicates** |
| Agency resolution | 31 resolved / 18 unresolved — unresolved stays unresolved, no fan-out |
| Derived | 24 pain points, **24/24 carry `institute_source_ids` + URL**; 24 changes, **24/24 linked** |
| Provenance typing | join proves **24/24** derived claims trace to a genuine `source_org='GAO'`, `source_type='gao_report'` row. **No mislabeling.** |
| Last evidence | 2026-09-18 — polls on 09-19/09-20 added no claim. That is `upstream_quiet`, the correct behaviour, not staleness |

**One defect:** `OIG-26-2` ("Information Technology Modernization…", 2026-08-28,
`gao.gov/products/oig-26-2`) is stored as `source_org='GAO'`, `source_type='gao_report'`.
GAO's feed *distributes* it; GAO did not *author* it. **`source_org` currently records the feed,
not the issuing authority** — 1/49 today, and it will recur.

**Latent risk:** `derive.ts` **hardcodes `source: 'gao'`** on every insert, and the legislation
cron calls the same function (route line 357). Only `isDefensiblePainPoint`'s GAO problem-vocabulary
regex — which never fires on a bill title — prevents a Congress document from being written as a
GAO-sourced claim. **The safety is accidental, not designed.**

---

## 5. Legislation — activated TODAY, not yet controlled

All 29 Congress rows were **created 2026-09-20 12:59**, hours before this audit. The
2026-09-13 control-plane doc listing legislation as MISSING is superseded.

| Measure | Value |
|---|---|
| Rows | 29 (22 `introduced_bill` · 5 `committee_report` · 2 `enacted_law`) |
| **Scope** | **28 of 29 are NDAA**; `NDAA_TITLE_PATTERN` is the discovery filter |
| **Agency spread** | **1 distinct agency** (Department of Defense, 28 rows) |
| Unresolved | 1 |
| `publication_date` null | **2** — including `119-S1071-ENR`, the **enrolled FY2026 NDAA** (an enacted law with no date) |
| Residual title pollution | **1/29** — `119-SRPT-39-ERRATA` = `'S. Rept. 119-39,Errata [S. Rept. 119-39,Errata]'` (self-duplicated decoration; PR #1570's repair missed this shape) |
| Derived claims | **0** |
| User-reachable | **0** — `sourced-pain-points.ts` filters `.eq('source','gao')`; nothing else reads `institute_sources` |
| Cron `40 13 * * 0` | one run ever: 2026-09-20 13:58, **`status='dispatched'`, `http_status = NULL`**, 12,002 ms |

⚠️ **The only recorded run never reported an outcome.** Per the Decision Makers lesson
(*registered + enabled + firing on time ≠ working — read `cron_job_runs.http_status`*), this
source has **not yet been proven to work on its own schedule**; the corpus it holds came from
manual runs at 12:59 and 14:32.

⚠️ **`CONGRESS_API_KEY` is not set in production** (`vercel env ls production` — only
`GOVINFO_API_KEY`, 154 days old, and the Potato-1 doc measured that key returning
`API_KEY_INVALID` for GovInfo collections). Ingest currently depends on the fallback.

**It is an NDAA tracker, not legislation coverage.** It must never be described as the latter.

---

## 6. The historical strategic corpus

### 6A. `agency_intelligence` — frozen, decades-stale, and contaminated

| Measure | Value |
|---|---|
| Ingested | **one day only: 2026-04-19.** Never refreshed |
| `gao_high_risk` | 445 rows, **publication dates 1993-10-06 → 2000-09-27** (26–33 years old) |
| `verified` | **0 of 556** |
| Producer alive? | `sync-agency-intel` exists; its fetcher targets GovInfo `GAOREPORTS`, **frozen at 2008-09-18** with an invalid key |

**The agency-misattribution repair did NOT close the class.** Potato-0C fixed **one** report
(`GAOREPORTS-T-RCED-98-12`) and its 50 cached opportunities. Structurally:

- 271 distinct titles → 445 rows
- **133 titles (49%) are filed under 2–4 different agencies**
- **307 of 445 rows (69%)** come from those fan-out titles

Concrete, unambiguous contamination:

| Title | Filed under |
|---|---|
| "**Department of Health and Human Services**: Management Challenges…" | HHS · **Homeland Security** · **EPA** · "Department of Health" |
| "**Department of the Interior**: Observations on Performance Plan…" | Interior · **Veterans Affairs** · **EPA** · "Department of the" |
| "**General Services Administration**: Building Security Upgrades…" | GSA · **Commerce** · **Homeland Security** · **SEC** |

**148 of 445 rows (33.3%) carry a non-canonical agency identity**: `General Government` (141 —
a GovInfo category, not an agency) plus 7 parse artifacts — `Department of the`, `Department of
Health`, `Department of Veterans`, `for Agency`, `Governing Agency`.

*This is the CLAUDE.md lesson verbatim: the fix targeted the instance, not the pattern.*

### 6B. Static JSON — 5,727 claims, zero traceability

- **3,043 pain points**: 0 URLs · 278 tagged `(Source: GAO)` (a bare string, no document number)
  · **2,765 (90.9%) with no attribution at all** · 46 NDAA-derived (identifiable only by text,
  produced by an **out-of-repo Python script**).
- **2,658 priorities**: **0 URLs · 0 source tags** · **1,810 (68.1%) assert a specific dollar
  figure** — e.g. *"$6.2B allocated for hypersonic weapons development in FY2025-2026"*,
  *"$9.1B committed to the Pacific Deterrence Initiative"*.

**There is no living priority pipeline at all.** `agency_priorities_db` = **0 rows**; its only
writer is a manual script that has never landed. So **100% of priorities Mindy shows are
unsourced static prose**, and two thirds of them carry a dollar amount.

---

## 7. Producer map

| Producer | Writes | Classification |
|---|---|---|
| `cron/institute-gao-sync` | `institute_sources`, `agency_pain_points_db`, `intelligence_changes` | **ACTIVE_CANONICAL** |
| `cron/institute-legislation-sync` | `institute_sources` | **ACTIVE_CANONICAL (unproven on schedule)** |
| `cron/precompute-opp-intel` `0 * * * *` | `sam_opportunities.intel_*` | **ACTIVE — and propagating the §8 defect** |
| `lib/strategic-intel/derive.ts` | pain points + changes | ACTIVE_CANONICAL (hardcodes `source:'gao'`) |
| `admin/sync-agency-intel` + `agency-intelligence/index.ts` | `agency_intelligence` | **LEGACY** — GovInfo frozen 2008, key invalid |
| `admin/build-pain-points` (Grok `grok-3`) | pain points | **LEGACY / INERT** — **`GROK_API_KEY` is not set in production.** Its own code correctly states *"AI builder outputs are INTERPRETATION, not evidence"* |
| `scripts/import-budget-intel.js` | `agency_priorities_db`, `agency_pain_points_db` | **HISTORICAL_ONLY** — target table empty; never landed |
| `scripts/repair-intel-agency-cache.mts` | `agency_intelligence`, opp cache | MANUAL_CONTROLLED (one-shot, instance-scoped) |
| `scripts/repair-legislation-titles.ts`, `seed-institute-legislation-source.ts` | titles / instance | MANUAL_CONTROLLED |
| out-of-repo `scan-ndaa-sections.py` | static JSON | **UNKNOWN** — not in the repo |
| `intelligence_sources` (6 rows, all `enabled=true`, **all `last_sync_at = NULL`**) | — | **PHANTOM REGISTRY** — a third registry that looks live and has never recorded a sync |
| `federal-register/index.ts` | 1h TTL cache only | **DEAD AS EVIDENCE** — 19/19 rows expired, last fetch 2026-09-02 |

---

## 8. 🔴 Customer-facing defect — a fabricated multi-trillion-dollar agency figure

**All 111 `contract_pattern` rows carry the identical string** `"Congressional justification
outlay: $16047.1B"` — one global number stamped onto every agency as if it were that agency's
figure. (Verified: `distinct_outlays = 1` across 111 rows. $16.05T is ~2.5× total federal outlays.)

`agency-intelligence/index.ts` pushes `contract_pattern.description` into **`result.priorities`**.
`opp-intel.ts` takes `priorities.slice(0,3)` and bakes it into `sam_opportunities.intel_agency`.

Measured in production:

| | |
|---|---|
| Opportunities carrying the figure | **547** |
| **Currently ACTIVE** | **172** |
| Carrying **both** contradictory vintages ($13,541.1B **and** $16,047.1B) in one blob | **519** |
| Carrying the `[LEGACY_MANUAL — provenance unavailable]` label | **31 (5.7%)** — 516 carry **no label** |
| Stamping window | 2026-08-04 → **2026-09-20 (today)** — the hourly cron is still writing it |

Live example (`b20c53189b47471099ed3209377cd33d`, active, deadline 2027-08-26):

> NASA — "Total obligated: **$43.3B**. Congressional justification outlay: **$13541.1B**"

NASA's entire annual budget is ~$25B. A $13.5-trillion "congressional justification outlay" is
presented as NASA budget context on a live, biddable opportunity — and 519 opportunities show
two mutually contradictory trillion-dollar figures at once.

**This is the exact failure `docs/engineering/a-number-is-a-product-feature.md` exists to prevent:
not a crash, a number plausible enough to influence a bid decision.** A `LEGACY_MANUAL` label
would not excuse it, and 94.3% of the rows do not even carry that.

---

## 9. Source vs derived separation

**The separation layer exists and is good.** `src/lib/strategic-intel/sourced-pain-points.ts`
types every claim `SOURCE_FACT` | `MINDY_INTERPRETATION` | `LEGACY_MANUAL`, refuses to promote a
claim without both an Institute id and a URL, and returns `citations` + `sourcedCount` +
`legacyCount`. `/api/pain-points` and the MCP `agency-intel` tool honour it fully
(*"Never invent a URL for LEGACY_MANUAL rows"*).

| Field family | Class |
|---|---|
| `institute_sources.{document_number,title,source_url,publication_date,abstract}` | **SOURCE_NATIVE** |
| `institute_sources.{canonical_agency,toptier_code,resolution_method}` | **NORMALIZED** |
| `agency_pain_points_db.{pain_point,status,confidence,urgency}` | **MINDY_DERIVED** |
| `intelligence_changes.*` | MINDY_DERIVED (history) |
| `agency_intelligence.{title,source_url,publication_date}` | SOURCE_NATIVE (stale) |
| `agency_intelligence.agency_name` | **UNKNOWN** — 33.3% non-canonical, 69% fan-out |
| `agency_intelligence.description` (`contract_pattern`) | **UNKNOWN / fabricated** (§8) |
| static `painPoints[]`, `priorities[]` | **UNKNOWN** — 0 URLs, no author, no date |

**Bypass is the problem, not the model.** 23 modules import the raw JSON directly instead of the
provenance-aware reader — including `lib/proposal/agency-context.ts` (feeds **drafted proposals**
under the heading *"Stated strategic priorities"*), `lib/briefings/market-assassin/data-aggregator.ts`,
`agency-hierarchy/pain-points-linker.ts`, `api/agency-sources`, `api/budget-intel`, `api/lindy/match`.

Two surfaces also **drop** the provenance the reader hands them:
- `opp-intel.ts` keeps the strings, discards `painPointCitations` / `hasSourcedIntelligence` → the
  54,494 stamped opportunities carry **no source URL**.
- `target-market-research` collapses `sourcedCount + legacyCount + legacyPriorityCount` into one
  count, mixing 24 cited claims with thousands of unsourced ones.

And `getUnifiedAgencyIntelligence` emits `gaoReports` as **title only — no publication date**, so a
1997 GAO report is visually indistinguishable from a 2026 one. `MyTargetListPanel` labels the whole
block *"the documented pain points + priorities for this agency."*

---

## 10. Currentness oracles

| Family | Oracle | Verdict |
|---|---|---|
| GAO | `max(publication_date)` vs poll; live feed comparable | ✅ **MEASURED** (and proven 25/25) |
| Legislation | congress.gov `updateDate` watermark (rewound 36h) | ⚠️ measurable; **upstream population UNMEASURED** |
| `agency_intelligence` | none | ❌ **UNMEASURED** — frozen upstream, invalid key |
| Static pain points | file `lastUpdated` only | ❌ **UNMEASURED** |
| Static priorities | none | ❌ **UNMEASURED** |
| Federal Register | API exposes `publication_date` + `document_number` | ❌ **not wired** — no durable store |
| IG · appropriations · budget justifications · strategic plans | no collector | ❌ **ABSENT** |

Per the rule: **no Mindy ingest time is substituted for a source clock anywhere above.**

---

## 11. Identity / duplication

| Test | Result |
|---|---|
| `institute_sources` duplicate `(source_type, document_number)` | **0** — 78/78 unique |
| Null document numbers | 0 · Null URLs | 0 · Null publication dates | **2** |
| `agency_intelligence` same title under multiple agencies | **133 titles → 307 rows** |
| Cross-source overlap GAO corpus vs legacy archive | **none** (2026 vs 1993–2000 — disjoint eras) |
| Superseded editions | legislation holds **one row per VERSION** by design (IH/RH/EH/RS/ENR) — correct, but 7 of 29 rows describe the same two NDAAs at different stages |
| Misfiled authority | **1** (`OIG-26-2` as `gao_report`) |

Nothing was deduped.

---

## 12. User-facing exposure

| Surface | Reads | Provenance shown | Risk |
|---|---|---|---|
| `/research/small-business-participation-benchmark` | `sam_opportunities` | ✅ cites OBS-001/002, exact head-counts, floor disclosed, "Generated 2026-09-20" | **LOW** — live, 200, 40.7% gov-wide / 34,684 active |
| `/research`, `/institute`, `/institute/evidence`, `/institute/competition-gap` | static TS | URLs + `confirmed` status | LOW content risk, **but entirely outside the control plane** |
| **Opportunity Map / opp drawer** (`intel_agency`, **54,494 stamped**) | unified intel | **strings only, no URL, no date** | 🔴 **HIGH — §8** |
| `MyTargetListPanel` | `/api/pain-points` | inherits inline `[LEGACY_MANUAL]` suffix; ignores `citations` | MEDIUM |
| MCP `get_agency_intel` | shared reader | ✅ full citations + `_meta.grounded` | LOW |
| `understand_customer` | unified intel | ✅ explicit "NOT an official agency statement" disclaimer | LOW |
| Proposal drafting (`agency-context.ts`) | **raw JSON** | ❌ none — rendered as *"Stated strategic priorities"* | **HIGH** |
| `buyer-detail.ts` | unified intel | claims *"never an LLM guess"* — true of origin, not of agency attribution | MEDIUM |
| **`institute_sources` itself (all 78 docs)** | — | — | **NOT USER-REACHABLE.** The 29 legislation rows reach no surface at all |

---

## 13. Research / Observatory lineage & publication safety

```
sam_opportunities ──► OBS-001 / OBS-002 (Production, publishable, citable)
                          └──► RES-003 ──► /research/small-business-participation-benchmark  [PUBLISHED]
user_engagement ──► OBS-003..007 (Collecting/Beta, NOT citable) ──► RES-002  [planned]
OBS-008/009 (Research/Beta) ──► RES-001  [planned]
institute_sources ──► agency_pain_points_db ──► (NO publication depends on this)
```

| Publication | Status | Reproducible from a controlled source? | Missing dependency |
|---|---|---|---|
| **RES-001** Competition Gap | planned | **N/A** — correctly gated on OBS-008 not reaching Beta | — |
| **RES-002** Procurement Intelligence Report 2026 | planned | **N/A** — correctly gated on OBS-003..007 | — |
| **RES-003** Small-Business Participation Benchmark | **PUBLISHED** | **PARTIAL** | `sam_opportunities` has a `data_sources` row but **no `data_source_instances` row** — no clocks, no `source_state`, no `intervention_state`. The figures are exactly reproducible today; **staleness in its one input cannot be detected by the control plane.** |

The registry's honesty discipline holds: nothing claims `published` that is not, `url` and
`publishedDate` are null for planned entries, and each gate states the real reason.

**The Institute's published research does not depend on the Institute's evidence corpus at all.**
RES-003 rests on `sam_opportunities`; `institute_sources` feeds no publication.

---

## 14. Domain reconciliation

**Definitions.** *Physical rows* = rows/claims that exist. *Source-native* = the authority's own
words/identifiers. *Derived* = Mindy's interpretation. *Controlled* = has a
`data_source_instances` row. *Automated* = written by an enabled cron. *Full provenance* =
authority + document + native id + publication date + URL, all resolvable.

| Category | Count | Notes |
|---|---|---|
| **Physical rows — database** | **682** | excludes the 6-row phantom registry + 19 expired cache rows |
| **Physical claims — static files** | **5,727** | 3,043 pain + 2,658 priorities + 26 USACE |
| **Domain total** | **6,409** | |
| Source-native evidence rows | **634** | 78 Institute + 556 legacy |
| Derived intelligence rows | **48** | 24 pain points + 24 changes |
| **Controlled rows** | **78** | 11.4% of DB · **1.2% of domain** |
| **Uncontrolled rows** | **6,331** | |
| **Automated rows** | **78** | GAO 49 + legislation 29 |
| Manual / one-shot rows | **582** | 556 legacy + 26 USACE |
| **Historical-only rows** | **6,257** | 556 frozen + 5,701 static (incl. 46 NDAA) |
| **Full provenance** | **102** | 78 Institute + 24 derived (all carry id + URL) |
| **Partial provenance** | **723** | 445 legacy GAO (URL + date, **agency untrustworthy**) + 278 `(Source: GAO)`-tagged (no doc id, no URL) |
| **No defensible provenance** | **5,584** | 2,765 untagged pain + 2,658 priorities + 111 `contract_pattern` + 26 USACE + 24 NDAA-text remainder |

**87.1% of the domain has no defensible provenance. 1.2% is under control.**

---

## 15. Phase II classification

| # | Source family | Rows | Classification |
|---|---|---|---|
| 1 | **GAO** (`institute_gao`) | 49 → 24 claims | **CLOSED** |
| 2 | **Legislation / NDAA** (`institute_legislation`) | 29 | **CONTROLLED_PARTIAL** |
| 3 | Legacy GovInfo GAO archive | 445 | **PHASE_II_REQUIRED** (contaminated + upstream dead) |
| 4 | USASpending `contract_pattern` | 111 | **PHASE_II_REQUIRED** 🔴 (fabricated, live) |
| 5 | Static agency pain points | 3,043 | **PHASE_II_REQUIRED** |
| 6 | Static agency priorities | 2,658 | **PHASE_II_REQUIRED** 🔴 (1,810 dollar claims, zero provenance) |
| 7 | USACE office pain points | 26 | **HISTORICAL_ONLY** |
| 8 | NDAA text (out-of-repo script) | 46 | **UNKNOWN** (producer not in repo) |
| 9 | Institute evidence TS array | 16 sources | **HISTORICAL_ONLY** (honest, uncontrolled) |
| 10 | Federal Register | 19 expired | **BLOCKED_CONTROLLED** (client + registry row exist; no persister) |
| 11 | Observatory → RES-003 | — | **CONTROLLED_PARTIAL** (input has no instance row) |
| 12 | Inspector General | 0 | **PHASE_II_REQUIRED** (no collector) |
| 13 | Appropriations · budget justifications · strategic plans | 0 | **PHASE_II_REQUIRED** |

### Domain: **PHASE_II_REQUIRED**

GAO is genuinely CLOSED — and it is **1 family of 13, 49 rows of 6,409 (0.8%)**. The domain is
not complete because GAO is healthy.

---

## 16. Recommended finish order

Ranked by consequence, not row count.

1. 🔴 **Stop serving the fabricated agency figure.** 172 active opportunities; the hourly cron
   re-stamps it. Three decisions: (a) stop `contract_pattern.description` entering `priorities`,
   (b) restamp the 547 cached blobs — the Potato-0C lesson is that fixing the source alone leaves
   the cache serving it forever, (c) decide whether the 111 rows survive at all.
2. 🔴 **Close the agency-misattribution class** (133 fan-out titles / 307 rows / 148 non-canonical
   identities). The repair was instance-scoped; the pattern is live. Route every read through
   `resolveAgency()` or quarantine the table.
3. 🟠 **Rule on 2,658 unsourced priorities, 1,810 carrying dollar figures.** No living pipeline
   exists (`agency_priorities_db` = 0). Either give priorities a source contract or stop
   presenting them as agency statements — especially inside drafted proposals.
4. 🟠 **Harden legislation before trusting it.** Prove the Sunday cron completes (`http_status`,
   not `dispatched`); set `CONGRESS_API_KEY`; repair the 1 polluted title; fix the 2 null
   publication dates; decide whether NDAA-only evidence reaching **zero** surfaces is intended.
5. 🟠 **Give `derive.ts` a real source label** instead of the hardcoded `'gao'`, and record the
   issuing authority separately from the discovery feed (`OIG-26-2`). Cheap now, corrupting later.
6. 🟡 **Register the uncontrolled families** in `data_source_instances` — starting with
   `sam_opportunities` (RES-003's only input) and `agency_pain_points` (advertised active quarterly,
   zero clocks). Retire or fill the phantom `intelligence_sources` registry; three registries is one too many.
7. 🟡 **Add an upstream-population oracle** to both Institute instances. I proved GAO 25/25 by hand;
   that proof lives nowhere.
8. 🟢 **Then** activate Federal Register (client + registry row already exist, needs a persister +
   relevance filter) and Inspector General (highest intelligence value — IG corroboration lets a
   claim *strengthen*).

---

## 17. Decision Makers drain at audit end

**Not stopped. Advanced during the audit.**

| Measure | At your reading | At audit end (2026-09-20 18:00 UTC) |
|---|---|---|
| `government_buyer` | 205,517 | **212,415** (+6,898) |
| `vendor_entity_poc` | 82,017 | **82,017** |
| `unclassified` | 0 | **0** ✅ |
| Control-plane drain | — | **212,415 / 266,113 = 79.8%** |
| `last_data_advance` | — | 2026-09-20 14:00 |
| `last_poll` | — | 2026-09-20 18:00 |

⚠️ Your 58.0% (120,000/207,067) is the **notice-traversal** metric; 79.8% is the control plane's
**contact-population** metric. Different denominators — I have not reconciled them, and they
should not be quoted as one number.

Person identity was not built. No source data was mutated.
