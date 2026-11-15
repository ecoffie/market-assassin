# v4 release gate: in-sample preview, holdout protocol, and recommendation to Agent 3 (2026-11-14)

Author: Agent 4 (benchmark construction, blind scoring and holdout design). Offline and read-only. No production change.

**Search is not release-ready. Nothing in this document is evidence that it is.** Section 1 applies the release gate to the
v4 **AI labels** (two blind reviewers, no human), in-sample on the phrasings the fixes were designed against. It shows where the
current system stands. It cannot pass anyone. Only the human-labelled holdout in Section 2 can.

## 1. Gate preview on the v4 AI labels (production, Fix A, Fix A+B)

Reproduce with `python3 -I scripts/gate_preview.py` → `results/gate_preview.json`, `results/missed_relevant.json`.
Relevant = FIT or PARTIAL. Ranges: lower bound = both reviewers relevant, upper bound = either reviewer.

| Gate leg | Bar | Production | Fix A | Fix A+B |
|---|---|---|---|---|
| Pooled top-20 relevant | ≥ 60% | 36–42% ❌ | 38–44% ❌ | 40–46% ❌ |
| Businesses with top-20 below 40% (lower bound) | none | 8 of 14 ❌ | 8 ❌ | 7 ❌ |
| Recall within the business's own codes (pooled sample) | ≥ 50% | 34% ❌ | 34% ❌ | 34% ❌ |

### Per business (production unless a variant differs)

| Business | Top-20 relevant | Code-floor recall (relevant retrieved / relevant in sample) | Fails |
|---|---|---|---|
| Janitorial | 2–3 / 20 | 17 / 25 (68%)* | top-20 |
| Nursing staffing | 6–8 / 20 | 6 / 8 (75%) | top-20 (30–40%) |
| HVAC | 16–17 / 20 | 11 / 20 (55%) | — |
| Security guards | 2 / 20 · Fix A 3 / 20 · **Fix A+B 7 / 13** | 4 / 12 (33%), every variant | recall; top-20 in production and Fix A |
| Steel buildings / roofing | 3–4 / 20 | 6 / 11 (55%) | top-20 |
| Grounds maintenance | 12–13 / 20 | **5 / 23 (22%)** | recall |
| Asphalt paving | 15–17 / 20 | 16 / 21 (76%) | — |
| Replacement parts | 5–6 / 20 · Fix A / A+B 7–9 / 20 | no code floor (category spans all FSCs) | top-20 |
| Fasteners | 7–8 / 20 | 6 / 25 (24%) | top-20 (35–40%), recall |
| Electrical components | 9 / 20 | **2 / 24 (8%)** | recall |
| Valves | 10–13 / 20 | **0 / 23 (0%)** | recall |
| Aircraft components | 9–11 / 20 | 4 / 21 (19%) | recall |
| Medical supplies | 6–7 / 20 | 4 / 24 (17%) | top-20, recall |
| IT hardware | **0 / 20** | 0 / 4 (floor is mostly software/services) | top-20, recall |

\* Janitorial recall counts the whole matched set, but 687 of its 1,187 matches sit past the 500-row deadline window and are
never ranked, so a customer would not see many of them.

Only HVAC and paving pass both legs on this preview. **Every product category fails recall.** The fixes Agent 3 has proposed so far
(A, A+B) move one business (guards) and leave both pooled numbers below the bar.

### Missed relevant opportunities

`results/missed_relevant.json` lists, per business, code-floor notices judged relevant that **no variant** retrieved (up to 12 stored
per business; the counts above are complete). Representative misses, each traced to a mechanism in `EXPERIMENT-V4.md` §1:

| Business | Missed notice (examples) | Why it is missed |
|---|---|---|
| Valves | "Valve, Solenoid - NSN 4810-01-044-9244", "48--VLV, REGUL PRESSURE", "PARTS KIT,BALL VALV" | query requires "supply" and "industrial" too; DLA abbreviation "VLV" |
| Fasteners | "53--SCREW,CAP,SOCKET HE", "NUT,SELF-LOCKING,HE", "SCREW,MACHINE" | list parsing requires "screws" and "nuts" together; "like" becomes a concept |
| Electrical | "59--RELAY,THERMAL", "59--CONNECTOR,PLUG,ELECTRI", "CIRCUIT CARD ASSEMB" | the item noun never says "electrical"/"electronic"; no FSC 59 recall |
| Aircraft | "MANIFOLD,ENGINE AIR", "GUIDE,SWASHPLATE", "16--DUCT ASSY" | no FSC 15/16 recall; item noun never says "aircraft" |
| Medical | "65--ADMINISTRATION SET,INT", "Midmark 626 Barrier Free Exam Chairs" | no FSC 65 recall |
| Grounds | "Grounds maintenance services for Riverside National Cemetery -- S208", snow removal | "landscaping AND grounds" both required; no vocabulary bridge |
| Janitorial | "Custodial Services for the 88th DPW", "Custodial and Related Services for TSA" | "custodial" never bridged from "clean" |
| HVAC | "J041--Building 2 Steam Station Replacement", "Chiller Tube Cleaning Services" | text never says "HVAC"; no J041 recall |
| Guards | "Protective Security Officer Services, Los Angeles Area" (×2), "INSCOM G-2 Access Control and Security Escorts" (×3) | never says "guard"; reachable only by 561612/S206 or protective-service phrases |
| Nursing | "Q701--7 FTE Medical Technologists" (×2) | adjacent clinical staffing; no Q-code recall |

## 2. Human holdout protocol (frozen today, before any post-freeze notice exists)

### 2.1 Readiness today: NOT READY, as planned

- The benchmark froze on 2026-11-14 (commit `3301cb3a0`). A read-only count today found **0** open notices posted on or after
  2026-11-15. The holdout cannot start until notices accumulate.
- Last week's volume sizes the window (open SAM.gov notices posted 2026-11-07 to 11-13, by each business's code floor):

| Business | Floor notices / week | Business | Floor notices / week |
|---|---|---|---|
| Janitorial | 18 | Fasteners | 10 |
| Nursing staffing | **2** | Electrical | 185 |
| HVAC | 32 | Valves | 40 |
| Security guards | **3** | Aircraft | 200 |
| Steel buildings | 7 | Medical | 45 |
| Grounds | 24 | IT hardware | 42 |
| Paving | 15 | Replacement parts | no floor |

  All open notices: about 3,840 posted per week.

### 2.2 What is frozen now (cannot change after a post-freeze notice is seen)

1. The 14 phrasings in `queries_v4.json` (the short form, `q[0]`, which is what FIND receives), their code floors, and the two rubrics
   `INSTRUCTIONS_service.md` / `INSTRUCTIONS_product.md`.
2. The gate thresholds: pooled top-20 ≥ 60%; no business below 40%; recall within codes ≥ 50%. Every leg is reported per business, not only pooled.
3. Relevant = FIT or PARTIAL (both reported separately as well). Product restrictions (approved source, brand name, OEM, QPL, sole
   source) are recorded but never change relevance.
4. The variants: **production at the snapshot SHA** (baseline) and **one release candidate named by Agent 3 as a git SHA before the
   snapshot date**. A candidate submitted after labels exist is not evaluable on this holdout.

### 2.3 Pool and snapshot

- **Eligible notices:** `sam_opportunities` rows with `source = 'sam.gov'`, `active = true`, deadline after the snapshot, **and**
  `posted_date ≥ 2026-11-15` **and** `created_at ≥ 2026-11-14T21:00Z`. The created-at condition excludes backdated notices that
  existed before the freeze (16.8% of notices arrive more than 2 days after their posted date). Excludes DIBBS-only RFQs
  (`dibbs_rfqs`) and SBIR/STTR topics. DLA notices on SAM.gov are eligible.
- **Snapshot 1: 2026-12-12** (four weeks), for 12 businesses. **Snapshot 2: 2027-01-09** (eight weeks), for nursing and guards only:
  at 2–3 floor notices a week, four weeks would give fewer than 10 relevant floor notices, too few to certify a 50% recall.
- **How each variant runs:** over the **full** open corpus at the snapshot (`harness_r4.mts`, the production-matched emulation). Pre-freeze notices are then
  removed from the ranked list without reordering. "Top 20" = the first 20 remaining. This is what the customer would see among new
  notices. If fewer than 20 remain, precision is over what is shown; a business with fewer than 8 shown is reported "insufficient".
- **Full matched set:** each variant's matched set is recorded in full. The 500-row window is reported as a separate number. It never defines the population.

### 2.4 What humans label

| Set | Per business | Purpose |
|---|---|---|
| T: top 20 of each variant, de-duplicated | ≤ 40 (usually about 25) | top-20 precision |
| F: code-floor census, or a random 30 if more than 30 | ≤ 30 | recall within codes |
| M: random 15 of the candidate's matched set outside its top 20 | 15 | retrieval precision of the full set |
| X: rows the candidate removes relative to production, random 15 | ≤ 15 | relevant work lost by the fix |

About 1,000 items before overlap, about 800 after. Expect 6–8 hours of human time at roughly 30 seconds an item.
**To reduce it:** AI pre-labels everything with two blind reviewers (as in v4). Humans label all of T and F (the gate legs; about 700) plus every
AI-disputed item in M and X. The undisputed M/X rows keep their AI labels and are marked as such.

### 2.5 Blinding and reviewers

- One mixed, shuffled queue across businesses. The reviewer never sees the variant, the rank, Mindy's DIRECT/related label or the AI label.
- Show the full notice text, the SAM.gov link, **and the sentence that triggered the match**. In the v1 human review, AI labels
  undercounted subcontract scope whenever the deciding sentence was outside the excerpt (5 of 6 "false positives" were relevant).
- **At least one reviewer who is not the project owner.** The v1 review had one reviewer, and that reviewer was not independent.
  A second human double-labels a random 15% for agreement (Cohen's κ reported). Disagreements are adjudicated by a third person, or
  reported as ranges.
- **Labels are not shared with Agent 3 until the scores are published.** Reusing holdout items for tuning ends their use as a holdout.
- Labelling surface: reuse the v1 review page (`review/build_review_page.py`) with the v4 rubrics and the evidence-sentence field.

### 2.6 What gets reported

For each business and each variant: top-20 relevant (FIT+PARTIAL and FIT-only) with a Wilson interval, recall within codes with an interval, retrieval
precision of the full matched set, relevant rows lost versus production, off-code relevant notices found, DIRECT precision and recall
(classification), and product restrictions. Gate verdict per leg, **pass/fail named per business**, then pooled.

### 2.7 Before Snapshot 1 (owner)

- [ ] Agent 3 names the candidate SHA (Agent 3)
- [ ] An independent human reviewer is named, plus a second for the 15% overlap (Eric)
- [ ] `harness_r4.mts` reads `.env.local` from a hardcoded MacBook path (`/Users/ericcoffie/Market Assasin/market-assassin`).
  Point it at the Studio checkout's env, and add the post-freeze pool filter (Agent 4, offline)
- [ ] The Studio checkout `/Users/ericcoffie/mindy-studio` has no `.env.local` and no `node_modules`. Today's read-only counts
  borrowed `~/Projects/market-assassin/.env.local`. Provision the Studio env with `npm run env:link-worktree` (Eric/infra)
- [ ] The query-vector cache (`vcache_v4.json`) and the 120 MB corpus capture stayed on the MacBook and were never committed. Re-embedding the 14 phrasings is 14 calls, within the approved embedding budget

## 3. Guard-matching blind comparison: findings (from `EXPERIMENT-V4.md` §2)

Variant naming from the brief: **A** = current production, **B** = agency-name filtering (Agent 3's "Fix A"),
**C** = B + the security-guard phrase requirement ("Fix A+B").

| Security guards | A (production) | B | C |
|---|---|---|---|
| Matched | 476 | 273 | 13 |
| Retrieval precision | ~2% | 4% (1/25) | **54% (7/13)** |
| Relevant in a random 25 of rows removed | — | 0/25 | 0/25 |
| Relevant guard-coded notices retrieved | 4 of 12 | 4 | 4 |
| Relevant protective-services notices (probe) | 7 of 12 | 6 | 5 |
| Top-20 relevant | 2/20 | 3/20 | 7 of 13 shown |

- **Lost legitimate opportunities:** B loses one disputed row ("Israel S&RTS", whose guard evidence was only in an organization name). C also loses
  "REPLACE OR CHILLERS" (PARTIAL: a construction job whose scope names guard services) and one relevant guard notice filed outside 561612/S206.
- **Related trades:** B also runs on every other search. It changes nothing for 12 of the 13 other businesses. For replacement parts it removes 26 rows,
  23 of the 25 labelled not relevant, but 2 PARTIAL ("Replace Door Control Unit", "417 SCMS Landing Gear Depot Support") whose only
  "defense" was "Department of Defense". C's phrase rule applies only to guard-intent searches. By design it excludes access-control-system and
  alarm installation work from guard results. That is correct for a guard company, but those notices need a home under electronic-security intent.
- **The fewer results are not why C looks better.** C looks better because 0 of 25 removed rows were relevant. **None of the variants finds a new relevant
  notice.** 8 of 12 relevant guard-coded notices remain unreachable by any of them.

## 4. Recommendation to Agent 3

In priority order. Each item names the gate leg it moves and the businesses it moves.

1. **Retrieval, single-concept sentences** (recall: valves, medical, electrical, aircraft, IT hardware). A qualifier ("supply", "industrial",
   "computer", "commercial") must not be a required concept. "We supply industrial valves" must admit "VALVE,LINEAR,DIRECT".
2. **List parsing** (recall: fasteners; precision: steel). Drop function words ("like", "and"), and make each listed item an OR-concept, not an AND.
3. **Code-based recall from a trade preset** (recall: guards, grounds, HVAC, janitorial and every product category). 561612/S206, 561730/S208,
   238220/J041, 561720/S201, FSC 53xx/59/48/15–16/65. A code is a recall source and a ranking signal, **never proof of relevance**.
   The floor samples above include code-filed notices that were not relevant (for example, IT-hardware PSCs holding software).
4. **A trade-vocabulary bridge** (janitorial ↔ custodial; landscaping ↔ grounds maintenance; guard ↔ protective security officer / access control /
   security escort; HVAC ↔ chiller / boiler / steam / mechanical). Add it in the same change as item 3, so recall gains are measured together.
5. **Stop silently dropping matches past 500 by deadline** (janitorial 687, electrical 303, steel 72 never ranked).
6. **Guards:** ship B (agency-name filtering) with the "a typed phrase is never masked" test. Ship C's phrase requirement **only together with**
   items 3–4 for guard intent. C alone raises precision but leaves recall at 4 of 12.
7. **Products:** use item-level evidence for DIRECT (the DLA item noun "VALVE,", "SCREW,", the FSC group, NSN or part number), and show
   approved-source and brand-name restrictions on the card. 18 of 42 relevant electrical notices are approved-source only.
8. **Ranking last.** Revisit meaning order (v3) only after 1–5 change the candidate set. The top-20 failures for janitorial, steel and IT hardware
   are mostly retrieval failures, not ranking failures.

Before Snapshot 1, Agent 3 names **one** candidate SHA containing whichever of these ship. Agent 4 will not certify a candidate on AI
scores, on this in-sample benchmark, or with any business below 40% top-20 on the human holdout.
