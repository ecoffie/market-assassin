# AUDIENCE-DRIVEN COVERAGE PRIORITIZATION — POST-IDENTITY-FIX REVALIDATION

**Run:** 2026-09-14 · **READ ONLY** — no connectors built, no data ingested, no user data mutated, Decision Makers not started.
Baseline: agency identity P0 closed in prod (PR #1508 / `48e60ea8`). 35,751 rows · 100% agency-reachable · 18,748 pinnable · 32,234 MCP-eligible.
All classifications rebuilt from current production data; **none reused** from the prior study.

---

## HEADLINE — the prior study's central thesis does not survive revalidation

> **"Three-letter/subagency Forecast coverage: 0% (0 / 16)."**

**That is false.** Every subagency market tested is already present inside its parent's forecast corpus:

| Subagency | Rows findable in parent | Parent |
|---|---:|---|
| NAVFAC | **2,402** | NAVY |
| U.S. Forest Service | **1,283** | USDA |
| U.S. Fish & Wildlife | **1,470** | DOI |
| NAVAIR | **931** | NAVY |
| U.S. Coast Guard | **702** | DHS |
| Federal Acquisition Service | **324** | GSA |
| CBP | **257** | DHS |
| National Park Service | **221** | DOI |
| NAVSEA | **194** | NAVY |
| FEMA | 118 | DHS |
| TSA | 84 | DHS |
| CMS | 81 | HHS |
| USSS | 59 | DHS |
| PBS | 40 | GSA |
| NIH | 35 | HHS |

**15 of 15 tested = PARTIAL (present, attributable), 0 = MISSING.** Not 0/16.

**But users cannot reach them.** Measured live on prod today:

```
USCG → 0        Forest Service → 0      National Park Service → 0
FEMA → 0        NIH → 0                 Coast Guard → 0
NAVFAC → 8,881  ← resolves, but returns ALL of Navy, not the 2,402 NAVFAC rows
```

**This is the identity bug again, one level down.** We just proved that class is cheap to fix and worth ~28,000 rows at the department level. **The same fix at subagency level unlocks ≥8,200 already-owned forecast rows across the 15 markets above — without building a single connector.**

**→ The #1 action is NOT a new agency source. It is subagency identity + office anchoring on corpora we already hold.**

---

## 1. Corrected user universe

| Metric | Now | Prior study |
|---|---:|---:|
| All profiles | **10,814** | 10,813 |
| Engagement-active 90d | **7,901** | 7,879 |
| Engagement-active 365d | **8,078** | 8,053 |
| Users with pursuits | **535** | 527 |
| Union (active365 + pursuit) | **8,084** | 8,055 |
| `user_confirmed` profiles | **1,726** (16.0%) | 1,726 |
| `system_default` profiles | **7,928** (73.3%) | 7,928 |
| `naics_source = null` | **1,160** (10.7%) | not reported |

**Methodology finding preserved and strengthened.** 7,922 of 7,928 `system_default` profiles carry the *identical* five codes (`541330,541512,541611,541990,561210`) — 7 distinct sets in total. And the 1,160 null-source profiles are mostly **empty** (920 carry no NAICS at all). Both are correctly excluded from demand inference.

## 2. Corrected top NAICS markets (`user_confirmed`, n=1,726; 588 distinct codes)

| # | NAICS | Description | Confirmed users | % | Active 90d | Pursuit users |
|---|---|---|---:|---:|---:|---:|
| 1 | 541511 | Custom Computer Programming | 1,092 | 63.3% | 643 | 215 |
| 2 | 541512 | Computer Systems Design | 1,080 | 62.6% | 697 | 239 |
| 3 | 541330 | Engineering Services | 1,074 | 62.2% | 687 | 227 |
| 4 | 541519 | Other Computer Related | 1,071 | 62.1% | 689 | 234 |
| 5 | 541611 | Admin/General Mgmt Consulting | 1,037 | 60.1% | 664 | 235 |
| 6 | 541990 | Other Prof/Sci/Tech | 958 | 55.5% | 586 | 199 |
| 7 | 541618 | Other Management Consulting | 913 | 52.9% | 544 | 183 |
| 8 | 541690 | Other Sci/Tech Consulting | 904 | 52.4% | 537 | 171 |
| 9 | 236220 | Commercial Building Construction | 225 | 13.0% | 193 | 78 |
| 10 | 561210 | Facilities Support Services | 223 | 12.9% | 196 | 70 |
| 11–25 | | 561720, 518210, 237990, 238210, 611430, 561730, 238220, 236210, 238160, 237310, 238910, 541715, 238990, 236118, 237130 | 112–156 | 6.5–9.0% | | |

**Unchanged from the prior study** — this axis was never contaminated by the agency bug. Two segments hold: **professional/IT services** (dominant) and **construction/facilities** (secondary).

## 3. PSC — still too sparse to weight

**210 of 10,814 profiles (1.9%)** carry any PSC. **No material improvement.** Top: R499 (53), R425 (44), R408 (37), DA01 (37), Z2JZ (16), R706 (16), R799 (14).
**→ PSC is NOT used as a ranking input.** Stated as a limitation, not silently dropped.

## 4. Corrected explicit agency-interest ranking — and a methodology correction

### ⚠️ The profile `agencies[]` signal is bulk-selected and must not drive ranking

The prior study ranked agencies by profile interest and flagged DFC/EXIM/CFTC/SEC (~246–256 users each) as *"may be an onboarding artifact — validate before connector work."* **The caution was right; the stated cause was wrong.**

- It is **not** onboarding prefill: only **19 of 7,928 (0.2%)** `system_default` profiles carry an agency list at all. 95–99% of those users are `user_confirmed`.
- It **is bulk multi-select**: median agency-list length is **10**, and **55%** of profiles select ≥10. The five agencies co-occur at **89–98%**, and **zero** DFC users picked it in a narrow (≤5) list.

Combined with procurement reality — **SEC 1 open / DFC 0 open / EXIM 2 open / CFTC 1 open**, and 0% of those in audience NAICS — these are **conclusively not real markets**. Question closed.

**→ Ranking uses REVEALED preference: pursuits (strongest) + deliberate target-list adds. Profile interest is reported with a `bulk%` flag, never as the driver.**

### Top markets by revealed demand

| # | Agency | Strong (target+pursuit) | Pursuit | Target | Profile | bulk% | Forecast |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | Department of Defense | **99** | 87 | 26 | 663 | 29% | PARTIAL |
| 2 | Department of Veterans Affairs | **87** | 50 | 52 | 739 | 64% | FULL |
| 3 | Department of the Army | **68** | 26 | 46 | 107 | 79% | PARTIAL (USACE only) |
| 4 | Department of the Navy | **55** | 19 | 38 | 157 | 80% | FULL |
| 5 | **Department of the Air Force** | **45** | 20 | 28 | 145 | 81% | **MISSING** |
| 6 | Department of the Interior | 36 | 34 | 5 | 85 | 25% | FULL |
| 7 | Department of Energy | 35 | 19 | 20 | 280 | 41% | FULL |
| 8 | **Department of State** | 35 | 11 | 26 | 155 | 37% | **MISSING** |
| 9 | Federal Acquisition Service | 33 | 0 | 33 | 34 | 94% | PARTIAL (in GSA) |
| 10 | Department of Homeland Security | 32 | 23 | 10 | 399 | 29% | FULL |
| 11 | NASA | 31 | 7 | 26 | 243 | 41% | FULL |
| 12 | U.S. Customs and Border Protection | 26 | 0 | 26 | 76 | 100% | PARTIAL (in DHS) |
| 13 | Department of Agriculture | 25 | 21 | 5 | 79 | 27% | FULL |
| 14 | Defense Contract Management Agency | 25 | 0 | 25 | 28 | 96% | MISSING |
| 15 | NAVFAC | 24 | 0 | 24 | 4 | 25% | PARTIAL (in NAVY) |

## 5. Derived buying demand — does the agency buy what our audience sells?

Open SAM (active, deadline ≥ today), and the share in the audience's top-18 NAICS:

| Agency | Open SAM | In audience NAICS | % aligned | SAM all-time | Recompete/award rows |
|---|---:|---:|---:|---:|---:|
| Navy | 2,000 | 141 | 7% | 24,169 | 17,521 |
| **Army proper** (excl. USACE) | **595** | **101** | **17%** | 12,179 | 17,124 |
| **USACE** (W912*) | **525** | **200** | **38%** | 8,830 | (in Army) |
| **Air Force** | **794** | **166** | **21%** | 13,064 | 12,331 |
| DLA | 4,269 | **6** | **0%** | 81,326 | 23,410 |
| Department of State | 203 | 34 | 17% | 3,611 | 3,336 |
| USCG | 215 | 39 | 18% | 4,448 | 2,066 |
| NIH | 107 | 9 | 8% | 1,373 | 4,110 |
| GSA PBS | 58 | 18 | 31% | 1,094 | 2,333 |
| Defense Health Agency | 64 | 7 | 11% | 1,104 | 2,160 |
| FAA | 40 | 13 | 33% | 448 | 2,622 |
| DISA | 40 | 6 | 15% | 648 | 1,818 |
| DARPA | 27 | 0 | 0% | 199 | 243 |
| CBP | 19 | 5 | 26% | 359 | 1,170 |
| FBI | 12 | 1 | 8% | 253 | 859 |
| TSA | 6 | 1 | 17% | 117 | 405 |
| USSS | 8 | 3 | 38% | 134 | 409 |
| CMS | 2 | 0 | 0% | 60 | 676 |
| SEC / DFC / EXIM / CFTC | 1 / 0 / 2 / 1 | 0 | 0% | 29 / 28 / 29 / 12 | 307 / 224 / 77 / 97 |

**DLA is the trap.** Biggest raw volume in federal procurement (4,269 open / 81,326 all-time) and **0% alignment** with what this audience sells — DLA buys parts and commodities (FSC/NSN), not IT or professional services. **Ranking on volume alone would put DLA first; ranking on audience fit removes it.** (DLA demand is already served by the DIBBS RFQ dataset, not `agency_forecasts`.)

## 6. DOD component matrix — parent coverage ≠ component coverage

| Component | Strong users | Pursuit | Target | Profile | Open SAM | Aligned | Recompete | Forecast rows | Status | Exact gap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| **DoD (parent)** | 99 | 87 | 26 | 663 | — | — | — | 11,789 | **PARTIAL** | 4 of ~10 components |
| **Army proper** | 68 | 26 | 46 | 110 | 595 | 17% | 17,124 | **0** | **MISSING** | all non-USACE Army |
| USACE | 32 | 2 | 30 | 157 | 525 | 38% | (in Army) | 2,908 | **FULL** | — |
| Navy (dept+commands) | 55 | 19 | 38 | 163 | 2,000 | 7% | 17,521 | 8,821 | **FULL** | — |
| ONR | 3 | 3 | 0 | 0 | — | — | — | 48 | FULL | — |
| NRL | 0 | 0 | 0 | 1 | — | — | — | 12 | FULL | — |
| **Air Force** | **45** | **20** | 28 | 147 | **794** | **21%** | 12,331 | **0** | **MISSING** | entire component |
| DLA | 14 | 3 | 11 | 43 | 4,269 | **0%** | 23,410 | 0 | MISSING | low audience fit |
| DISA | 9 | 0 | 9 | 11 | 40 | 15% | 1,818 | 0 | MISSING | thin |
| DARPA | 5 | 2 | 3 | 7 | 27 | 0% | 243 | 0 | MISSING | thin |

**DoD's 11,789 rows must never be read as DoD coverage.** Air Force — the **#5 market overall, 45 strong users, 20 pursuits, 794 open opps, 21% aligned** — contributes **zero** rows.

## 7. Army — USACE vs Army proper

| | USACE | Army proper |
|---|---:|---:|
| Open SAM | **525** (42%) | **595** (58%) |
| SAM all-time | 8,830 (42%) | 12,179 (58%) |
| Audience-NAICS aligned | **200 (38%)** | 101 (17%) |
| Forecast rows | **2,908** | **0** |
| Coverage | FULL | **MISSING** |

**Verdict: Army stays Tier 1 — but demoted from #1, and rescoped.** USACE already covers the *better-aligned* 42% (38% audience fit vs 17%). The genuine gap is Army proper: 595 open opportunities, 17,124 recompete rows, zero forecast. Demand labeled "Army" splits 46 target / 26 pursuit users, and Army Contracting Command (24 strong) + Army Materiel Command (17 strong) are both Army-proper markets with no forecast.

## 8. Navy — the artifact is corrected; no meaningful component gap

Navy was **never missing**. 8,881 identity rows · 5,053 pins · 8,701 MCP-eligible.
**Do not rank Navy as a new source.** Its LRAE corpus carries **102 distinct contracting offices** (DoDAAC-coded: `N00019` NAVAIR, `N40085` NAVFAC, `N00104` NAVSUP, `M67854` MARCORSYSCOM), so the commands users actually target **are already inside it** — NAVFAC 2,402 rows, NAVAIR 931, NAVSEA 194. The remaining Navy gap is **surfacing, not sourcing**: `NAVFAC` today returns all 8,881 Navy rows instead of its 2,402.

## 9. Three-letter / subagency study — recomputed

**Meaningful non-cabinet markets (≥5 revealed users): 69.** Prior "0/16 covered" is replaced by:

| Class | Count | Meaning |
|---|---:|---|
| FULL | 6 | resolves to its own source code (USACE, NASA, GSA…) |
| **PARTIAL** | **15+ proven** | present and attributable inside the parent corpus (table at top) |
| MISSING | remainder | no parent corpus holds them (Army commands, DCMA, DHA, DISA) |

Top subagency markets: Federal Acquisition Service (33) · CBP (26) · DCMA (25) · NAVFAC (24) · Army Contracting Command (24) · USCG (23) · CMS (23) · NAVSEA (22) · Defense Health Agency (19) · FAA (18) · NAVAIR (18) · Air Combat Command (17) · Army Materiel Command (17) · NIH (16) · PBS (16) · FEMA (15) · NAVWAR (15).

## 10. Alternative intelligence where Forecast is absent

A forecast gap is not an intelligence gap. For every MISSING agency Mindy already provides SAM notices, sources sought/RFIs, awards, incumbents, recompete windows, vehicles, competition and small-business patterns:

| Agency | Forecast | Open SAM | All-time SAM | Recompete/award rows |
|---|---|---:|---:|---:|
| Air Force | MISSING | 794 | 13,064 | 12,331 |
| Army proper | MISSING | 595 | 12,179 | 17,124 |
| DLA | MISSING | 4,269 | 81,326 | 23,410 |
| Department of State | MISSING | 203 | 3,611 | 3,336 |
| NIH | PARTIAL (HHS) | 107 | 1,373 | 4,110 |
| FAA | PARTIAL (—) | 40 | 448 | 2,622 |
| DHA | MISSING | 64 | 1,104 | 2,160 |

What formal Forecast uniquely adds remains **pre-solicitation intent 6–18 months ahead**. Everything else is already covered.

## 11. Corrected coverage KPIs (FULL and PARTIAL never merged)

| KPI | FULL | PARTIAL | MISSING |
|---|---:|---:|---:|
| Agencies with revealed demand (239) | 22 | 2 | 215 |
| Meaningful markets, ≥5 strong users (87) | 17 | 2 | 68 |
| **Strong signals** (target+pursuit, n=1,711) | **26.4%** | **9.8%** | 63.8% |
| **Pursuit signals only** (n=590) | **47.3%** | **19.2%** | 33.6% |
| Subagency markets (69) | 6 | 15+ proven | remainder |

FULL+PARTIAL = 36.2% of strong signals, **66.4% of pursuit signals** — shown as a sum only alongside its parts.
**The prior "49.3% / 64.1% / 43% / 0%" figures are superseded**: they were computed on profile-interest (bulk-selected) with pre-fix agency matching.

## 12. OLD vs CORRECTED Tier 1

| Old Tier 1 | Old rationale | What changed | Current coverage | Current demand | Still Tier 1? |
|---|---|---|---|---|---|
| **1. Army** | "Army returns 0 → no coverage" | Identity bug. USACE holds 2,908 rows and covers the *better-aligned* 42% | **PARTIAL** | 68 strong / 26 pursuit | **YES — but #2, rescoped to Army proper** |
| **2. Air Force** | high demand, no forecast | **Confirmed and strengthened** | **MISSING** | 45 strong / 20 pursuit / 794 open / 21% aligned | **YES — promoted to #1** |
| **3. DLA** | biggest raw volume | **Volume is not fit.** 0% of open DLA opps are in audience NAICS; already served by DIBBS | MISSING | 14 strong, 3 pursuit | **NO — drop to Tier 3** |
| **4. FAA** | 357 profile users | Profile signal was **99% bulk-selected**. Real: 18 strong, 3 pursuit, 40 open | PARTIAL (84 rows in DHS-adjacent/none) | thin | **NO — Tier 2** |
| **5. NIH** | 234 profile users | **99% bulk-selected**; 35 NIH rows already inside HHS | **PARTIAL** | 16 strong, 4 pursuit | **NO — Tier 2 (surfacing, not sourcing)** |
| — | — | **NEW** | — | 15 markets, ≥8,200 owned rows unreachable | **NEW #1 non-connector action: subagency identity** |

Also newly visible and previously absent from Tier 1: **Department of State** (35 strong, 11 pursuit, 203 open, 17% aligned, MISSING) and **Army Contracting Command / Army Materiel Command** (24 / 17 strong, both Army proper).

## 13. Corrected top 10 coverage targets

| # | Target | Parent | Strong | Pursuit | Aligned NAICS | Open SAM | Award/recompete | Forecast now | Exact gap | Decision it changes | Public source? |
|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|
| **0** | **Subagency identity + office anchoring** (15 markets) | — | 250+ | — | — | — | — | PARTIAL, unreachable | ≥8,200 owned rows users can't reach | "Show me USCG / Forest Service / NAVFAC forecasts" returns 0 today | **N/A — no source needed** |
| 1 | **Air Force** | DoD | 45 | 20 | 21% | 794 | 12,331 | **MISSING** | entire component | 6–18mo lead on the #5 market; zero today | **NEEDS DISCOVERY** |
| 2 | **Army proper** (non-USACE) | DoD | 68 | 26 | 17% | 595 | 17,124 | **MISSING** | 58% of Army | ACC/AMC pipelines invisible pre-solicitation | **NEEDS DISCOVERY** |
| 3 | **Department of State** | — | 35 | 11 | 17% | 203 | 3,336 | **MISSING** | whole agency | overseas/embassy pipeline unplannable | NEEDS DISCOVERY |
| 4 | NAVFAC precision | NAVY | 24 | 0 | — | — | — | PARTIAL (2,402) | returns all 8,881 | construction users get Navy-wide noise | N/A — precision fix |
| 5 | USCG | DHS | 23 | 4 | 18% | 215 | 2,066 | PARTIAL (702) | unreachable by name | 702 owned rows invisible | N/A — identity |
| 6 | Defense Health Agency | DoD | 19 | 4 | 11% | 64 | 2,160 | MISSING | whole component | health-IT pipeline | NEEDS DISCOVERY |
| 7 | DCMA | DoD | 25 | 0 | — | 0 | 499 | MISSING | whole component | **validate first** — 0 open SAM |
| 8 | CBP | DHS | 26 | 0 | 26% | 19 | 1,170 | PARTIAL (257) | unreachable by name | 257 owned rows | N/A — identity |
| 9 | Army Contracting Command | Army | 24 | 0 | — | (in Army) | (in Army) | MISSING | folded into #2 | — | with #2 |
| 10 | NIH / CMS | HHS | 16 / 23 | 4 / 1 | 8% / 0% | 107 / 2 | 4,110 / 676 | PARTIAL (35 / 81) | unreachable | thin but owned | N/A — identity |

**Tier 1** (demand + market + genuine gap + clear product value): Subagency identity (#0), **Air Force**, **Army proper**.
**Tier 2** (demand but substantial existing intelligence or partial coverage): State, DHA, USCG, CBP, NIH/CMS, FAS/PBS, FAA.
**Tier 3** (low prevalence or weak evidence): DLA (volume without fit), DISA, DARPA, FBI, TSA, USSS, SEC/DFC/EXIM/CFTC (**disproven**).

## 14. First source to investigate — **Department of the Air Force**

**Recommendation: investigate the Air Force forecast source first.** Do not build yet.

**Evidence:**
- **Demand is revealed, not claimed.** 45 strong users, **20 with live pursuits**, 28 deliberate target-list adds. Its profile signal is 81% bulk-selected — but pursuits and target adds are not bulk-selectable, and they rank it **#5 overall and #1 among MISSING**.
- **The market is real and aligned.** 794 open opportunities, 13,064 all-time, **21% in audience NAICS** — better alignment than Army proper (17%) or Navy (7%), and unlike DLA (0%) it buys what this audience sells.
- **We hold zero of it.** 0 forecast rows. Not partial, not historical — absent. The DoD parent rollup hides this: DoD reports 11,789 rows while its second-largest service contributes none.
- **What is impossible today:** an Air Force-focused contractor cannot see any pre-solicitation intent. Mindy can show them 794 open opps and 12,331 award/recompete rows — i.e. what already happened and what is already posted — but **nothing 6–18 months out**, which is the entire value of the Forecast product. For Navy users that question is answerable; for Air Force users it silently returns nothing.
- **Why not Army proper first:** larger recompete volume (17,124) but lower audience alignment (17%), fewer pursuit users (26 vs 20 is close, but Army's better-aligned 42% is *already covered* by USACE). Air Force has no such partial offset.
- **Why not the subagency work first:** #0 is higher value *per unit effort* and needs **no source engineering at all** — it is an identity-table extension of the resolver just shipped. It should proceed in parallel; it is not a connector investigation.

**Open question the investigation must answer:** whether a machine-readable Air Force forecast exists at all. Marked **NEEDS DISCOVERY** — I found no evidence either way in current data, and I will not assert one exists. If discovery fails, Army proper (#2) becomes the first connector.

## 15. Remaining telemetry limitations that could distort this ranking

1. **Bulk multi-select inflates profile interest** — median list = 10 agencies, 55% pick ≥10. Mitigated by ranking on pursuits/target adds, but it means profile-based counts anywhere else in the business are unreliable for demand.
2. **Target-list adds may themselves be semi-bulk.** Several markets show high target counts with **0 pursuits** (ACC 17, AMC 17, NAVSEA 22, CMS 22). Pursuit is the only fully revealed signal, and it is thin — **590 pursuit signals across 535 users**.
3. **Only 535 of 10,814 users (4.9%) have any pursuit.** The strongest signal covers 5% of the base; the ranking leans on a small, possibly unrepresentative cohort.
4. **`user_engagement` carries no agency/NAICS dimension** (273,049 rows, user+event only) — it establishes activity but cannot corroborate market preference.
5. **PSC unusable at 1.9%.**
6. **SAM agency naming is not canonical** — USACE is not labeled by name anywhere in `sam_opportunities`; the Army split relied on the `W912` DoDAAC prefix. Other components may be similarly mis-split, so component SAM counts are good-but-not-exact.
7. **Subagency "findability" was measured by office/title keyword match** inside parent corpora. It proves the rows exist and are attributable; it does not prove a clean office-code join for every market.
8. **`user_confirmed` still skews IT/professional services** (8 of the top 8 codes are 5415xx/5416xx). Construction is second but under-weighted — a construction-led ranking would favor USACE/PBS/NAVFAC more strongly.

---

**READ ONLY. No connector work started. Stopping for review.**
