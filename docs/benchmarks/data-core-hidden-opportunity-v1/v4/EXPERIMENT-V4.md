# v4: SAM.gov services and products benchmark, and Agent 3's guard fixes (2026-11-14)

**All labels are AI-generated (two blind Claude reviewers per item, Sonnet and Opus) and unverified by a human.**
Disputed items are reported as ranges (lower bound = both reviewers relevant). 1,059 labelled (business, notice) pairs: 885 new,
plus 174 reused from v3 (same protocol). Reviewers agreed exactly on 959 and on relevant-vs-not on 987 (93%). Offline and read-only;
no production change. The human-reviewed holdout of notices posted after Nov 14 is still required before any release.

## Setup

- **Source:** `sam_opportunities` (all rows `source = 'sam.gov'`), production's open definition: `active = true` and deadline
  in the future (9,716 open on 2026-11-14). DIBBS-only RFQs are excluded. DLA notices published on SAM.gov are included.
- **Production (baseline):** the real FIND Open code at `7f328de91` (#2050 included), run for 14 short business descriptions
  (7 services, 7 products; `queries_v4.json`). An in-memory copy of retrieval over the full open corpus reproduces production's
  matched count exactly for all 14. Its 500-row ranked window and top 20 match production exactly too: the live top 20 for all
  14, the full window for all 14.
- **Fix A** (Agent 3): mask the 352 registry organization names before word matching, and stop text-searching the buyer
  column. **Fix A+B:** Fix A plus the guard phrase requirement ("security guard(s)", "guard service(s)", "guard force").
  The sets are Agent 3's own (`matched-sets.json`, `matched-sets-v4-new.json`; Agent 3's masker confirmed Fix A changes nothing
  for the 8 new phrasings). Fix B applies only to the guard search.
- **What was labelled, per business:**
  - a random 30 of the matched set (stratified into kept vs removed rows where a fix removes rows)
  - a random 25 of the open notices filed under the trade's own codes (the code floor, a recall check)
  - the top 20 under each variant
  - for guards: every Fix A+B row, 25 rows removed by Fix B, and a 40-notice protective-services probe
- **Rubrics** (`INSTRUCTIONS_service.md`, `INSTRUCTIONS_product.md`): a service notice must procure the work, not mention the
  word. A product notice needs item-level evidence (item name, specification, PSC/FSC, NSN or part number); similarity alone
  never counts. Approved-source, brand-name, OEM, QPL and sole-source restrictions are recorded separately from relevance.

## 1. Retrieval: did Mindy find the relevant opportunities?

| Business | Matched | Relevant in a random 30 of the matched set | Code-floor notices judged relevant that were retrieved | Rows past the 500-row window (never ranked) |
|---|---|---|---|---|
| Janitorial | 1,187 | 1/30 | 17 of 25 | 687 |
| Nursing staffing | 46 | 8–9/30 | 6 of 8 | 0 |
| HVAC | 211 | 19–21/30 | 11 of 20 | 0 |
| Security guards | 476 | about 2% (11 of 476) | 4 of 12 | 0 |
| Steel buildings / roofing | 572 | 2–4/30 | 6 of 11 | 72 |
| Grounds / landscaping | 47 | 11–12/30 | 5 of 23 | 0 |
| Paving / site work | 161 | 15–21/30 | 16 of 21 | 0 |
| Replacement parts | 81 | about 35–38% | no code floor | 0 |
| Fasteners | 245 | 4/30 | 6 of 25 | 0 |
| Electrical components | 803 | 5–9/30 | 2 of 24 | 303 |
| Valves | 43 | 7–9/30 | **0 of 23** | 0 |
| Aircraft components | 475 | 14/30 | 4 of 21 | 0 |
| Medical / lab supplies | 156 | 3–5/30 | 4 of 24 | 0 |
| IT hardware | 468 | 0–3/30 | 0 of 4 | 0 |

**Retrieval is the main failure. Ranking comes after it.** Four mechanisms, each verified against production's matcher (`probe.mts`):

1. **Single-product sentences require every word.** "We supply industrial valves." becomes `ALL(valves · supply · industrial)`.
   A notice must also say "supply" and "industrial", so 43 of the 245 open valve notices are retrieved, and none of the 23
   relevant code-floor valve notices. Word forms are not the problem: the matcher inflects ("bolts" matches "BOLT").
2. **List parsing.** "fasteners like bolts, screws and nuts" makes "like" a search concept, and requires "screws" and "nuts"
   together (`ALL(screws · nuts)`), so "53--SCREW,CAP,SOCKET HE" is missed.
3. **No vocabulary bridge.** "We clean commercial office buildings." admits on "clean" alone: grease traps, hulls, laundry.
   Notices that say "Custodial Services" or "Janitorial Services" do not match. Likewise "landscaping and grounds maintenance"
   misses "Grounds maintenance services for Riverside National Cemetery".
4. **No code-based recall for any of the 14 phrasings.** None maps to an industry preset (`cap.direct` is literal, with no NAICS/PSC).
   9 of the 13 guard-coded notices never say "guard" ("Protective Security Officer Services", "Access Control and Security
   Escorts"), so no word rule can reach them.

Separately, the 500-row deadline window means 687 janitorial, 303 electrical and 72 steel matches are never ranked.

## 2. Agent 3's guard fixes

| Measure (security guards) | Production | Fix A | Fix A+B |
|---|---|---|---|
| Matched rows | 476 | 273 | 13 |
| Retrieval precision | about 2% (estimated 11 relevant of 476) | 1/25 in a random sample (4%) | **7/13 (54%)**, exact |
| Relevant rows in a random 25 of the rows each fix removed | n/a | 0/25 | 0/25 |
| Known relevant guard notices retrieved (of 14 labelled relevant) | 8 | 8 | 7 |
| Relevant protective-services notices retrieved (of 12 found by the probe) | 7 | 6 | 5 |
| Relevant guard-coded notices retrieved (of 12 relevant) | 4 | 4 | 4 |
| DIRECT rows / relevant among labelled DIRECT | 86 labelled, 4 relevant | 44, 4 | 4, 4 |
| Top-20 relevant | 2/20 | 3/20 | **7 of 13 shown** |

**Relevant opportunities lost by each rule:**

- Fix A, guards: one disputed row, "Israel S&RTS" (one reviewer NO, one PARTIAL). Its only guard evidence was inside an organization name.
- Fix A, parts: two rows both reviewers called PARTIAL, "Replace Door Control Unit" and "417 SCMS Landing Gear Depot Support".
  Fix A removed them because "defense" came only from "Department of Defense". Fix A removed 26 parts rows in total; 25 were labelled, and 23 of those were not relevant.
- Fix B, guards: one row both reviewers called PARTIAL, "REPLACE OR CHILLERS" (a construction job whose text names guard services).
  Rows Fix B removed: 260; relevant in a random 25 of them: 0.
- Fix A changes nothing for the other 12 businesses.

**Legitimate protective-services, access-control and facility-security work:** the probe found 12 relevant notices.
Production retrieves 7, Fix A 6 and Fix A+B 5. **The bigger loss is upstream: 5 relevant notices are retrieved by no variant**
(two "Protective Security Officer Services, Los Angeles Area" and three "INSCOM G-2 Access Control and Security Escorts"). They are
reachable only through codes (561612 / S206) or protective-service phrases.

**Notices with missing or unexpected industry codes:** 4 relevant guard notices are filed outside 561612/S206. Production and Fix A
keep all 4; Fix A+B keeps 3.

**Do not read fewer results as better search.** Fix A+B is better here because 0 of 25 removed rows were relevant and precision
went from about 2% to 54%. But it found no new relevant notices, and 8 of the 12 relevant guard-coded notices are still unreachable.

## 3. Classification: are relevant notices in the right evidence group?

Among labelled rows (production):

| Business | Relevant rows labelled DIRECT | DIRECT rows that are relevant |
|---|---|---|
| HVAC | 44 of 47 | 44–46 of 52 |
| Fasteners | 13 of 13 | 13–14 of 34 |
| Valves | 10 of 10 | 10 of 12 |
| Aircraft components | 26 of 26 | 26–28 of 45 |
| Grounds | 13 of 15 | 13–14 of 21 |
| Paving | 26 of 36 | 26–29 of 32 |
| Steel / roofing | 16 of 17 | 16–19 of 52 |
| Janitorial | 12 of 20 | 12–13 of 61 |
| Medical | 7 of 9 | 7–9 of 32 |
| Electrical | 14 of 16 | 14–17 of 36 |
| Nursing | 7 of 10 | 7–9 of 23 |
| Guards | 4 of 8 | 4 of 86 |
| Replacement parts | **3 of 17** | 3–4 of 6 |

DIRECT is a weak signal for janitorial, guards, steel, medical and electrical: most labelled DIRECT rows there are not relevant.
For replacement parts it is the reverse: 14 of 17 relevant notices sit in "other".

## 4. Ranking: top-20 relevance (production order applied to each variant)

| Business | Production | Fix A | Fix A+B |
|---|---|---|---|
| Janitorial | 2–3 | same | same |
| Nursing | 6–8 | same | same |
| HVAC | 16–17 | same | same |
| Guards | 2 | 3 | 7 of 13 |
| Steel / roofing | 3–4 | same | same |
| Grounds | 12–13 | same | same |
| Paving | 15–17 | same | same |
| Replacement parts | 5–6 | 7–9 | 7–9 |
| Fasteners | 7–8 | same | same |
| Electrical | 9 | same | same |
| Valves | 10–13 | same | same |
| Aircraft | 9–11 | same | same |
| Medical | 6–7 | same | same |
| IT hardware | 0 | same | same |

## Products: fulfillment restrictions (tracked separately from relevance)

Among relevant product notices, approved-source restrictions are common:

| Category | Approved source | Other restrictions | No restriction |
|---|---|---|---|
| Electrical | 18 of 42 | 1 QPL | 23 |
| Aircraft | 13 of 45 | 2 OEM-only, 1 sole source | 27 |
| Medical | 5 of 33 | 2 brand-name, 2 sole source | 20 |
| Fasteners | 4 of 33 | 2 sole source | 26 |
| Valves | 2 of 36 | 2 sole source | 31 |

A supplier would have to be on the approved source list to bid these. Surfacing the restriction matters as much as surfacing the notice.

## Recommended matching approach (for Eric's decision; nothing implemented)

1. **Adopt Fix A for correctness**, with the "typed phrase is never masked" test Agent 3 proposed. It halves wrong DIRECT labels on
   guard searches and removed no clearly relevant guard row. Weigh its two PARTIAL parts losses: "defense" written only in a buyer
   name is exactly what Fix A is meant to ignore, but those two notices were scope a parts supplier could fill.
2. **Adopt the phrase requirement (Fix B) for guard-intent searches only together with recall.** Add code-based recall
   (561612 / S206) and the protective-service phrases ("protective security officer", "access control", "security escort",
   "force protection"). Fix B alone raises precision to 54%, but leaves 8 of 12 guard-coded notices unreachable.
3. **Fix retrieval before ranking**, in this order:
   - a single-product sentence must not require qualifier words ("supply", "industrial")
   - list parsing must drop function words ("like") and treat each listed item as its own concept
   - a trade-vocabulary bridge (janitorial ↔ custodial, landscaping ↔ grounds maintenance) or code-based recall from a preset
   - a candidate window that does not silently drop matches beyond 500 by deadline
4. **For products, use item-level evidence**: the PSC/FSC group and the item noun in the DLA title ("VALVE,", "SCREW,"). Show
   approved-source and brand-name restrictions on the card.
5. **Ranking** (meaning order, v3) is worth revisiting only after 1–4, then on the blind human-labelled holdout.

## Files

| Path | Contents |
|---|---|
| `scripts/harness_r4.mts`, `scripts/observer.diff` | Production capture and emulation (read-only; the observer is one line in a throwaway worktree) |
| `scripts/build_r4.py`, `scripts/score_r4.py`, `scripts/probe.mts` | Builder, scorer and matcher probe |
| `queries_v4.json`, `INSTRUCTIONS_*.md` | The 14 phrasings with code floors, and the two rubrics |
| `labels/` | Both reviewers' labels plus `r4_meta.json`, `r4_plan.json` (why each item was labelled) |
| `results/r4_eval.json` | All metrics |
| `results/r4_sets.json` | Matched sets, windows and classes per variant |

The raw open-corpus capture (text and vectors, about 120 MB) is not committed.

## Limits

AI labels only. In-sample on the benchmark phrasings. One snapshot (2026-11-14). Small n per cell; most intervals are about ±20
points. Random samples bound the removed populations; they are not a census. The code floor is a recall check, not a definition of
relevance; the IT-hardware floor (PSC 7A/7B/7G) turned out to be mostly software and services.
